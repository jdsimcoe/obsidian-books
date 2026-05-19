import {MarkdownView, TFile, type App, type Editor} from "obsidian";
import type {SearchableNoteResult} from "./noteSearchIndex";

export async function insertMirrorReference(app: App, result: SearchableNoteResult): Promise<void> {
	const markdownView = app.workspace.getActiveViewOfType(MarkdownView);
	const currentFile = markdownView?.file;
	const editor = markdownView?.editor;
	if (!currentFile || !editor) {
		throw new Error("Open a Markdown note before inserting research.");
	}

	const subpath = result.kind === "block"
		? `#^${await ensureBlockId(app, result, currentFile, editor)}`
		: "";
	const link = app.fileManager.generateMarkdownLink(result.file, currentFile.path, subpath);
	editor.replaceSelection(`!${link}`);
}

async function ensureBlockId(
	app: App,
	result: SearchableNoteResult,
	currentFile: TFile,
	editor: Editor,
): Promise<string> {
	if (result.blockId) {
		return result.blockId;
	}

	if (result.file.path === currentFile.path) {
		return ensureCurrentEditorBlockId(app, result, editor);
	}

	return ensureVaultBlockId(app, result);
}

async function ensureVaultBlockId(app: App, result: SearchableNoteResult): Promise<string> {
	const currentContents = await app.vault.read(result.file);
	const currentSlice = currentContents.slice(result.startOffset, result.endOffset);
	if (!currentSlice) {
		throw new Error("Could not find the selected block.");
	}

	const blockId = generateBlockId(result.file, currentContents);
	const updatedContents =
		currentContents.slice(0, result.startOffset)
		+ serializeLineWithBlockId(currentSlice, blockId)
		+ currentContents.slice(result.endOffset);

	await app.vault.modify(result.file, updatedContents);
	await waitForBlockId(app, result.file, blockId);
	return blockId;
}

async function ensureCurrentEditorBlockId(app: App, result: SearchableNoteResult, editor: Editor): Promise<string> {
	const start = editor.offsetToPos(result.startOffset);
	const end = editor.offsetToPos(result.endOffset);
	const currentSlice = editor.getRange(start, end);
	if (!currentSlice) {
		throw new Error("Could not find the selected block.");
	}

	const blockId = generateBlockId(result.file, editor.getValue());
	editor.replaceRange(serializeLineWithBlockId(currentSlice, blockId), start, end);
	await waitForBlockId(app, result.file, blockId);
	return blockId;
}

async function waitForBlockId(app: App, file: TFile, blockId: string): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const cache = app.metadataCache.getFileCache(file);
		if (cache?.blocks?.[blockId]) {
			return;
		}

		await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
	}
}

function serializeLineWithBlockId(lineText: string, blockId: string): string {
	const trailingWhitespace = lineText.match(/\s*$/u)?.[0] ?? "";
	const content = lineText
		.slice(0, lineText.length - trailingWhitespace.length)
		.replace(/\s+\^[A-Za-z0-9-]+$/u, "");
	return content ? `${content} ^${blockId}${trailingWhitespace}` : `^${blockId}${trailingWhitespace}`;
}

function generateBlockId(file: TFile, fileContents: string): string {
	const existingIds = new Set<string>();
	for (const match of fileContents.matchAll(/\^([A-Za-z0-9-]+)\b/gu)) {
		const blockId = match[1];
		if (blockId) {
			existingIds.add(blockId);
		}
	}

	for (let attempt = 0; attempt < 25; attempt += 1) {
		const bytes = new Uint8Array(3);
		window.crypto.getRandomValues(bytes);
		const candidate = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
		if (!existingIds.has(candidate)) {
			return candidate;
		}
	}

	return `${file.basename.toLowerCase().replace(/[^a-z0-9]+/gu, "").slice(0, 4)}${Date.now().toString(36).slice(-4)}`;
}
