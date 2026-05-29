import {type MarkdownPostProcessorContext} from "obsidian";
import {analyzeManuscript, firstWordRange, hasTk, matchTk, type ManuscriptAnalysis} from "./manuscriptTypography";
import {isBooksPath} from "./utils/paths";

// Single-entry memo so repeated post-processor calls within one render don't
// re-analyze the same document text for every block.
let cachedText: string | null = null;
let cachedAnalysis: ManuscriptAnalysis | null = null;

function analyzeCached(text: string): ManuscriptAnalysis {
	if (cachedText === text && cachedAnalysis) {
		return cachedAnalysis;
	}
	cachedAnalysis = analyzeManuscript(text);
	cachedText = text;
	return cachedAnalysis;
}

export function decorateManuscriptReadingView(
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): void {
	if (!isBooksPath(ctx.sourcePath)) {
		return;
	}

	applyParagraphTreatment(el, ctx);
	highlightTk(el);
}

function applyParagraphTreatment(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
	const paragraph = el instanceof HTMLParagraphElement ? el : el.querySelector("p");
	if (!paragraph) {
		return;
	}

	const info = ctx.getSectionInfo(el);
	if (!info) {
		return;
	}

	const analysis = analyzeCached(info.text);
	const kind = analysis.paragraphKinds.get(info.lineStart);
	if (kind === "indent") {
		paragraph.addClass("obsidian-books-para-indent");
	} else if (kind === "chapter-open") {
		paragraph.addClass("obsidian-books-chapter-open");
	}

	if (analysis.smallCapsLines.has(info.lineStart)) {
		wrapFirstWordSmallCaps(paragraph);
	}
}

function wrapFirstWordSmallCaps(paragraph: HTMLElement): void {
	const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();
	while (node) {
		const textNode = node as Text;
		if (!textNode.parentElement?.closest("code, pre")) {
			const word = firstWordRange(textNode.nodeValue ?? "");
			if (word) {
				const range = document.createRange();
				range.setStart(textNode, word.start);
				range.setEnd(textNode, word.end);
				const span = document.createElement("span");
				span.className = "obsidian-books-smallcaps";
				range.surroundContents(span);
				return;
			}
		}
		node = walker.nextNode();
	}
}

function highlightTk(el: HTMLElement): void {
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();
	while (node) {
		const textNode = node as Text;
		const value = textNode.nodeValue ?? "";
		if (hasTk(value) && !textNode.parentElement?.closest("code, pre, .obsidian-books-tk-note")) {
			wrapTkNote(textNode);
			// Only the first TK per block opens a note; it captures the rest.
			return;
		}
		node = walker.nextNode();
	}
}

function wrapTkNote(textNode: Text): void {
	const value = textNode.nodeValue ?? "";
	const [first] = matchTk(value);
	if (!first) {
		return;
	}

	const parent = textNode.parentNode;
	if (!parent) {
		return;
	}

	const before = value.slice(0, first.start);
	const tkText = value.slice(first.start, first.end);
	const afterTk = value.slice(first.end);

	const container = document.createElement("span");
	container.className = "obsidian-books-tk-note";

	const tkSpan = document.createElement("span");
	tkSpan.className = "obsidian-books-tk";
	tkSpan.textContent = tkText;
	container.appendChild(tkSpan);
	if (afterTk) {
		container.appendChild(document.createTextNode(afterTk));
	}

	// Everything after this text node (rest of the line/paragraph) is part of
	// the note too.
	const following: ChildNode[] = [];
	for (let sibling = textNode.nextSibling; sibling; sibling = sibling.nextSibling) {
		following.push(sibling);
	}

	const fragment = document.createDocumentFragment();
	if (before) {
		fragment.appendChild(document.createTextNode(before));
	}
	fragment.appendChild(container);
	parent.replaceChild(fragment, textNode);

	for (const sibling of following) {
		container.appendChild(sibling);
	}
}
