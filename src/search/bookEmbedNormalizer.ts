import {Component, MarkdownView, TFile, type App, type Editor, type MarkdownFileInfo} from "obsidian";
import {isBooksPath} from "../utils/paths";
import {buildBookQuoteInsertion} from "./insertBookQuote";
import type {SearchableNoteResult} from "./noteSearchIndex";

const EMBED_LINE_RE = /^\s*>?\s*!?\[\[([^\]]+#\^[^\]]+)\]\]\s*$/u;
const BLOCK_ID_RE = /^\^([A-Za-z0-9-]+)/u;

export class BookEmbedNormalizer extends Component {
	private readonly app: App;
	private isReplacing = false;
	private timer: number | null = null;
	private retryKey: string | null = null;
	private retryCount = 0;

	constructor(app: App) {
		super();
		this.app = app;
	}

	onload(): void {
		this.registerEvent(this.app.workspace.on("editor-change", () => {
			this.scheduleActiveEditorNormalization();
		}));
		this.registerEvent(this.app.workspace.on("file-open", () => {
			this.scheduleActiveEditorNormalization();
		}));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
			this.scheduleActiveEditorNormalization();
		}));
	}

	onunload(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private scheduleActiveEditorNormalization(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
		}
		this.timer = window.setTimeout(() => {
			this.timer = null;
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view?.file) {
				void this.normalizeEditor(view.editor, view);
			}
		}, 250);
	}

	private async normalizeEditor(editor: Editor, info: MarkdownView | MarkdownFileInfo): Promise<void> {
		if (this.isReplacing || !info.file || !isBooksPath(info.file.path)) {
			return;
		}

		const lineNumber = this.findEmbedLine(editor);
		if (lineNumber === null) {
			this.retryKey = null;
			this.retryCount = 0;
			return;
		}

		const lineText = editor.getLine(lineNumber);
		const result = await this.resultFromEmbedLine(lineText, info.file);
		if (editor.getLine(lineNumber) !== lineText) {
			return;
		}
		if (!result) {
			const key = `${info.file.path}:${lineText}`;
			this.retryCount = this.retryKey === key ? this.retryCount + 1 : 1;
			this.retryKey = key;
			if (this.retryCount < 8) {
				this.scheduleActiveEditorNormalization();
			}
			return;
		}

		const insertion = await buildBookQuoteInsertion(this.app, result, info.file);
		this.retryKey = null;
		this.retryCount = 0;
		this.isReplacing = true;
		try {
			editor.replaceRange(insertion, {line: lineNumber, ch: 0}, {line: lineNumber, ch: lineText.length});
		} finally {
			this.isReplacing = false;
		}
	}

	private findEmbedLine(editor: Editor): number | null {
		const lineCount = editor.lineCount();
		for (let lineNumber = 0; lineNumber < lineCount; lineNumber += 1) {
			if (EMBED_LINE_RE.test(editor.getLine(lineNumber))) {
				return lineNumber;
			}
		}
		return null;
	}

	private async resultFromEmbedLine(lineText: string, currentFile: TFile): Promise<SearchableNoteResult | null> {
		const match = lineText.match(EMBED_LINE_RE);
		if (!match) {
			return null;
		}

		const embedTarget = match[1];
		if (!embedTarget) {
			return null;
		}

		const target = parseEmbedTarget(embedTarget);
		if (!target.blockId) {
			return null;
		}

		const file = this.app.metadataCache.getFirstLinkpathDest(target.linkpath, currentFile.path);
		if (!(file instanceof TFile) || file.extension !== "md") {
			return null;
		}

		const contents = await this.app.vault.cachedRead(file);
		const range = blockRangeForId(this.app, file, contents, target.blockId);
		if (!range) {
			return null;
		}

		const raw = contents.slice(range.startOffset, range.endOffset);
		return {
			kind: "block",
			file,
			blockId: target.blockId,
			displayText: displayTextForBlock(raw) || file.basename,
			searchText: "",
			pathText: parentPathLabel(file.path),
			startOffset: range.startOffset,
			endOffset: range.endOffset,
			mtime: file.stat.mtime,
		};
	}
}

interface EmbedTarget {
	linkpath: string;
	blockId: string | null;
}

interface BlockRange {
	startOffset: number;
	endOffset: number;
}

function parseEmbedTarget(value: string): EmbedTarget {
	const [withoutAlias = ""] = value.split("|", 1);
	const hashIndex = withoutAlias.indexOf("#");
	const linkpath = hashIndex >= 0 ? withoutAlias.slice(0, hashIndex) : withoutAlias;
	const subpath = hashIndex >= 0 ? withoutAlias.slice(hashIndex + 1) : "";
	const blockId = subpath.match(BLOCK_ID_RE)?.[1] ?? null;
	return {linkpath, blockId};
}

function blockRangeForId(app: App, file: TFile, contents: string, blockId: string): BlockRange | null {
	const block = app.metadataCache.getFileCache(file)?.blocks?.[blockId];
	if (block) {
		return {
			startOffset: block.position.start.offset,
			endOffset: block.position.end.offset,
		};
	}

	const blockPattern = new RegExp(`(?:^|\\n)([^\\n]*\\s\\^${escapeRegExp(blockId)}\\s*)`, "u");
	const match = contents.match(blockPattern);
	if (!match || match.index === undefined) {
		return null;
	}

	const line = match[1] ?? "";
	const startOffset = match.index + (match[0].startsWith("\n") ? 1 : 0);
	return {startOffset, endOffset: startOffset + line.length};
}

function displayTextForBlock(value: string): string {
	return value
		.replace(/\s+\^[A-Za-z0-9-]+\s*$/u, "")
		.replace(/^\s*>\s?/gmu, "")
		.replace(/^\s*[-*+]\s+/gmu, "")
		.replace(/\s+/gu, " ")
		.trim();
}

function parentPathLabel(path: string): string {
	const slashIndex = path.lastIndexOf("/");
	return slashIndex < 0 ? "/" : `${path.slice(0, slashIndex + 1)}`;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
