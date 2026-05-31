import {MarkdownView, TFile, type App} from "obsidian";
import type {SearchableNoteResult} from "./noteSearchIndex";

const SOURCE_URL_KEYS = ["sourceURL", "sourceUrl", "source_url", "url", "URL"];
const SOURCE_TITLE_KEYS = ["sourceTitle", "source", "title"];
const SOURCE_AUTHOR_KEYS = ["author", "byline"];
const SOURCE_DATE_KEYS = ["datePublished", "publishedDate", "publishedAt", "published", "sourceDate", "date"];
const SOURCE_SITE_KEYS = ["siteName", "site", "publication", "publisher", "website"];

export async function buildBookQuoteInsertion(app: App, result: SearchableNoteResult, currentFile: TFile): Promise<string> {
	const quoteText = await quoteTextForResult(app, result);
	const footnoteId = await nextNumericFootnoteId(app, currentFile);
	const citation = citationText(app, result, currentFile);
	const quote = quoteText
		.split(/\r?\n/u)
		.map((line) => `> ${line}`)
		.join("\n");

	return `${quote}[^${footnoteId}]\n\n[^${footnoteId}]: ${citation}`;
}

async function quoteTextForResult(app: App, result: SearchableNoteResult): Promise<string> {
	if (result.kind === "block") {
		const contents = await app.vault.cachedRead(result.file);
		const raw = contents.slice(result.startOffset, result.endOffset);
		return cleanQuoteText(raw) || result.displayText;
	}

	return result.displayText;
}

function citationText(app: App, result: SearchableNoteResult, currentFile: TFile): string {
	const frontmatter = app.metadataCache.getFileCache(result.file)?.frontmatter;
	const sourceUrl = firstFrontmatterString(frontmatter, SOURCE_URL_KEYS);
	const sourceTitle = firstFrontmatterString(frontmatter, SOURCE_TITLE_KEYS) ?? result.file.basename;
	const author = firstFrontmatterString(frontmatter, SOURCE_AUTHOR_KEYS);
	const date = firstFrontmatterString(frontmatter, SOURCE_DATE_KEYS);
	const siteName = firstFrontmatterString(frontmatter, SOURCE_SITE_KEYS);
	const noteLink = app.fileManager.generateMarkdownLink(
		result.file,
		currentFile.path,
		result.blockId ? `#^${result.blockId}` : "",
		sourceTitle,
	);

	if (sourceUrl) {
		return formatApaWebCitation({
			author,
			date,
			siteName,
			title: sourceTitle,
			url: sourceUrl,
		});
	}

	return noteLink.endsWith(".") ? noteLink : `${noteLink}.`;
}

function firstFrontmatterString(frontmatter: Record<string, unknown> | undefined, keys: string[]): string | null {
	if (!frontmatter) {
		return null;
	}

	for (const key of keys) {
		const value = frontmatter[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}

	return null;
}

interface ApaWebCitationInput {
	author: string | null;
	date: string | null;
	siteName: string | null;
	title: string;
	url: string;
}

function formatApaWebCitation(input: ApaWebCitationInput): string {
	const date = formatApaDate(input.date);
	const title = italicizeMarkdown(input.title);
	const siteName = input.siteName && !sameText(input.siteName, input.author)
		? ` ${input.siteName}.`
		: "";

	if (input.author) {
		return `${formatApaAuthor(input.author)} (${date}). ${title}.${siteName} ${input.url}`;
	}

	return `${title}. (${date}).${siteName} ${input.url}`;
}

function formatApaDate(value: string | null): string {
	if (!value) {
		return "n.d.";
	}

	const normalized = value.trim();
	if (/^\d{4}$/u.test(normalized)) {
		return normalized;
	}

	const date = parseDate(normalized);
	if (!date) {
		return normalized;
	}

	const month = new Intl.DateTimeFormat("en-US", {month: "long", timeZone: "UTC"}).format(date);
	return `${date.getUTCFullYear()}, ${month} ${date.getUTCDate()}`;
}

function parseDate(value: string): Date | null {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function formatApaAuthor(value: string): string {
	const trimmed = value.trim();
	if (trimmed.includes(",") || /\b(?:Inc|LLC|Press|University|Institute|Center|Centre|Team|Staff)\b/u.test(trimmed)) {
		return ensureTrailingPeriod(trimmed);
	}

	const names = trimmed.split(/\s*(?:;|&|\band\b)\s*/u).filter(Boolean);
	if (names.length === 0 || names.length > 3) {
		return ensureTrailingPeriod(trimmed);
	}

	const formatted = names.map(formatPersonName).join(", ");
	return ensureTrailingPeriod(formatted);
}

function formatPersonName(value: string): string {
	const parts = value.trim().split(/\s+/u);
	if (parts.length < 2 || parts.length > 3) {
		return value.trim();
	}

	const last = parts[parts.length - 1];
	const initials = parts
		.slice(0, -1)
		.map((part) => `${part.replace(/[^\p{L}\p{N}]/gu, "")[0]?.toUpperCase() ?? ""}.`)
		.join(" ");
	return `${last}, ${initials}`;
}

function italicizeMarkdown(value: string): string {
	return `*${value.replace(/([*_\\])/gu, "\\$1")}*`;
}

function sameText(left: string, right: string | null): boolean {
	return right !== null && left.trim().toLowerCase() === right.trim().toLowerCase();
}

function ensureTrailingPeriod(value: string): string {
	return /[.!?]$/u.test(value) ? value : `${value}.`;
}

function cleanQuoteText(value: string): string {
	return value
		.replace(/\s+\^[A-Za-z0-9-]+\s*$/u, "")
		.replace(/^\s*>\s?/gmu, "")
		.replace(/^\s*[-*+]\s+/gmu, "")
		.trim();
}

async function nextNumericFootnoteId(app: App, currentFile: TFile): Promise<string> {
	const text = await currentDocumentText(app, currentFile);
	let max = 0;
	for (const match of text.matchAll(/\[\^(\d+)\]/gu)) {
		const value = Number(match[1]);
		if (Number.isInteger(value)) {
			max = Math.max(max, value);
		}
	}
	return String(max + 1);
}

async function currentDocumentText(app: App, currentFile: TFile): Promise<string> {
	const activeView = app.workspace.getActiveViewOfType(MarkdownView);
	if (activeView?.file?.path === currentFile.path) {
		return activeView.editor.getValue();
	}
	return app.vault.cachedRead(currentFile);
}
