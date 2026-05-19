import {Component, prepareSimpleSearch, TFile, type App, type CachedMetadata} from "obsidian";
import {BOOKS_FOLDER} from "../constants";

export interface SearchableNoteResult {
	kind: "note" | "block";
	file: TFile;
	displayText: string;
	searchText: string;
	pathText: string;
	startOffset: number;
	endOffset: number;
	blockId?: string;
	mtime: number;
}

export class NoteSearchIndex extends Component {
	private readonly app: App;
	private cachePromise: Promise<SearchableNoteResult[]> | null = null;
	private isDirty = true;

	constructor(app: App) {
		super();
		this.app = app;
	}

	onload(): void {
		const invalidate = () => {
			this.isDirty = true;
			this.cachePromise = null;
		};

		this.registerEvent(this.app.metadataCache.on("changed", invalidate));
		this.registerEvent(this.app.vault.on("modify", invalidate));
		this.registerEvent(this.app.vault.on("rename", invalidate));
		this.registerEvent(this.app.vault.on("delete", invalidate));
	}

	async recent(limit = 12): Promise<SearchableNoteResult[]> {
		const files = this.app.vault.getMarkdownFiles()
			.filter((file) => !isBookFile(file))
			.sort((left, right) => right.stat.mtime - left.stat.mtime)
			.slice(0, limit);

		return files.map((file) => fileToResult(file));
	}

	async search(query: string, limit = 40): Promise<SearchableNoteResult[]> {
		const normalizedQuery = query.trim();
		if (!normalizedQuery) {
			return this.recent(limit);
		}

		const search = prepareSimpleSearch(normalizedQuery);
		const candidates = await this.getCandidates();
		const matches: Array<{result: SearchableNoteResult; score: number}> = [];
		for (const result of candidates) {
			const match = search(result.searchText);
			if (!match) {
				continue;
			}

			matches.push({result, score: match.score});
		}

		return matches
			.sort((left, right) => {
				return right.score - left.score
					|| right.result.mtime - left.result.mtime
					|| left.result.displayText.localeCompare(right.result.displayText);
			})
			.slice(0, limit)
			.map((match) => match.result);
	}

	private async getCandidates(): Promise<SearchableNoteResult[]> {
		if (!this.isDirty && this.cachePromise) {
			return this.cachePromise;
		}

		this.isDirty = false;
		this.cachePromise = this.buildCandidates();
		return this.cachePromise;
	}

	private async buildCandidates(): Promise<SearchableNoteResult[]> {
		const files = this.app.vault.getMarkdownFiles().filter((file) => !isBookFile(file));
		const resultSets = await Promise.all(files.map(async (file) => {
			const blocks = await this.collectBlocks(file);
			return [fileToResult(file), ...blocks];
		}));
		return resultSets.flat();
	}

	private async collectBlocks(file: TFile): Promise<SearchableNoteResult[]> {
		const contents = await this.app.vault.cachedRead(file);
		const cache = this.app.metadataCache.getFileCache(file);
		const blockRanges = getSortedBlockRanges(cache);
		const results: SearchableNoteResult[] = [];
		let lineStart = 0;
		let blockRangeIndex = 0;
		while (lineStart <= contents.length) {
			const newlineIndex = contents.indexOf("\n", lineStart);
			const lineEnd = newlineIndex >= 0 ? newlineIndex : contents.length;
			const rawLine = contents.slice(lineStart, lineEnd);
			const displayText = normalizeDisplayText(rawLine);
			if (displayText) {
				while (
					blockRangeIndex < blockRanges.length
					&& isBeforeLine(blockRanges[blockRangeIndex], lineStart)
				) {
					blockRangeIndex += 1;
				}

				results.push({
					kind: "block",
					file,
					blockId: extractLineBlockId(rawLine) ?? findContainingBlockId(blockRanges, lineStart, lineEnd, blockRangeIndex),
					displayText,
					searchText: `${file.basename} ${file.path} ${displayText}`.toLowerCase(),
					pathText: parentPathLabel(file.path),
					startOffset: lineStart,
					endOffset: lineEnd,
					mtime: file.stat.mtime,
				});
			}

			if (newlineIndex < 0) {
				break;
			}
			lineStart = lineEnd + 1;
		}

		return results;
	}
}

export function isBookFile(file: TFile): boolean {
	return file.path === BOOKS_FOLDER || file.path.startsWith(`${BOOKS_FOLDER}/`);
}

function fileToResult(file: TFile): SearchableNoteResult {
	return {
		kind: "note",
		file,
		displayText: file.basename,
		searchText: `${file.basename} ${file.path}`.toLowerCase(),
		pathText: parentPathLabel(file.path),
		startOffset: 0,
		endOffset: 0,
		mtime: file.stat.mtime,
	};
}

interface BlockRange {
	blockId: string;
	startOffset: number;
	endOffset: number;
}

function getSortedBlockRanges(cache: CachedMetadata | null): BlockRange[] {
	if (!cache?.blocks) {
		return [];
	}

	return Object.entries(cache.blocks)
		.map(([blockId, block]) => {
			return {
				blockId,
				startOffset: block.position.start.offset,
				endOffset: block.position.end.offset,
			};
		})
		.sort((left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset);
}

function findContainingBlockId(
	blockRanges: BlockRange[],
	lineStart: number,
	lineEnd: number,
	startIndex: number,
): string | undefined {
	for (let index = startIndex; index < blockRanges.length; index += 1) {
		const range = blockRanges[index];
		if (!range || range.startOffset > lineStart) {
			break;
		}
		if (lineEnd <= range.endOffset) {
			return range.blockId;
		}
	}

	return undefined;
}

function isBeforeLine(range: BlockRange | undefined, lineStart: number): boolean {
	return Boolean(range && range.endOffset < lineStart);
}

function normalizeDisplayText(lineText: string): string {
	if (/^\s*#{1,6}\s+/u.test(lineText) || /^\s*---\s*$/u.test(lineText)) {
		return "";
	}

	const normalized = lineText
		.replace(/\s+\^[A-Za-z0-9-]+\s*$/u, "")
		.replace(/!\[\[([^\]]+)\]\]/gu, "$1")
		.replace(/\[\[([^\]]+)\]\]/gu, "$1")
		.replace(/^[>\-*+]\s+/u, "")
		.replace(/`+/gu, "")
		.replace(/\*\*/gu, "")
		.replace(/__/gu, "")
		.replace(/[_*~]+/gu, "")
		.replace(/\s+/gu, " ")
		.trim();

	if (!/[\p{L}\p{N}]/u.test(normalized)) {
		return "";
	}

	return normalized;
}

function extractLineBlockId(lineText: string): string | undefined {
	const match = lineText.match(/\s\^([A-Za-z0-9-]+)\s*$/u);
	return match?.[1];
}

function parentPathLabel(path: string): string {
	const slashIndex = path.lastIndexOf("/");
	return slashIndex < 0 ? "/" : `${path.slice(0, slashIndex + 1)}`;
}
