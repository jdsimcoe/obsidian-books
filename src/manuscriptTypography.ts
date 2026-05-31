// Shared, pure analysis of manuscript source text so that Reading mode
// (markdown post-processor) and Live Preview (CodeMirror extension) stay in
// perfect agreement about paragraph treatment and "TK" markers.

export type ParagraphKind = "chapter-open" | "indent";

export interface ManuscriptAnalysis {
	// Keyed by the 0-based source line index of every body line that needs a
	// treatment. A "section" is a run of consecutive non-blank body lines; the
	// first line of a section is flush (and not stored), each following line is
	// "indent", and the very first body line of the document is "chapter-open".
	// Blank lines and headings break a section, so the next body line starts a
	// new (flush) section.
	paragraphKinds: Map<number, ParagraphKind>;
	// 0-based source line index of each body paragraph -> its 1-based number down
	// the chapter. Every paragraph is numbered: section openers and the indented
	// continuation paragraphs within a section alike.
	paragraphNumbers: Map<number, number>;
	// 0-based source line index(es) whose opening words should be set in small
	// caps. Only the document's first body line (the chapter opener) qualifies;
	// other section openers stay normal.
	smallCapsLines: Set<number>;
	// 0-based source line indices that are frontmatter or fenced code (incl.
	// the fence markers themselves). TK highlighting is suppressed here.
	literalLines: Set<number>;
}

const HEADING_RE = /^\s{0,3}#{1,6}\s/;
const FENCE_RE = /^\s*(?:```|~~~)/;
const LIST_RE = /^\s*(?:[-*+]\s|\d+[.)]\s)/;
const QUOTE_RE = /^\s*>/;
const TABLE_RE = /^\s*\|/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const INDENTED_CODE_RE = /^(?: {4}|\t)/;
const TK_LEADING_RE = /^\s*TK(?:TK)*\b/;

export function analyzeManuscript(text: string): ManuscriptAnalysis {
	const lines = text.split("\n");
	const paragraphKinds = new Map<number, ParagraphKind>();
	const paragraphNumbers = new Map<number, number>();
	const smallCapsLines = new Set<number>();
	const literalLines = new Set<number>();

	let inFrontmatter = false;
	let inFence = false;
	let prevLineWasBody = false;
	let seenBody = false;
	let paragraphNumber = 0;

	for (let i = 0; i < lines.length; i += 1) {
		const raw = lines[i] ?? "";
		const trimmed = raw.trim();

		// Frontmatter only counts when the document opens with a fence on line 0.
		if (i === 0 && trimmed === "---") {
			inFrontmatter = true;
			literalLines.add(i);
			continue;
		}
		if (inFrontmatter) {
			literalLines.add(i);
			if (trimmed === "---" || trimmed === "...") {
				inFrontmatter = false;
			}
			continue;
		}

		// Fenced code blocks.
		if (FENCE_RE.test(raw)) {
			literalLines.add(i);
			inFence = !inFence;
			prevLineWasBody = false;
			continue;
		}
		if (inFence) {
			literalLines.add(i);
			prevLineWasBody = false;
			continue;
		}

		// A blank line ends the current section.
		if (trimmed === "") {
			prevLineWasBody = false;
			continue;
		}

		// Headings and other block constructs break the section but are not
		// body lines themselves.
		if (
			HEADING_RE.test(raw)
			|| LIST_RE.test(raw)
			|| QUOTE_RE.test(raw)
			|| TABLE_RE.test(raw)
			|| HR_RE.test(raw)
			|| INDENTED_CODE_RE.test(raw)
		) {
			prevLineWasBody = false;
			continue;
		}

		// A body line. Every paragraph (section opener and continuation alike)
		// gets a number.
		paragraphNumber += 1;
		paragraphNumbers.set(i, paragraphNumber);
		if (!prevLineWasBody) {
			if (!seenBody) {
				// The very first body line of the document gets the drop cap, and its
				// opening words are set in small caps (the drop-cap letter sits on
				// top). Other section openers stay normal.
				paragraphKinds.set(i, "chapter-open");
				if (!TK_LEADING_RE.test(raw)) {
					smallCapsLines.add(i);
				}
			}
		} else {
			// A continuing paragraph within the section: indent its first line.
			paragraphKinds.set(i, "indent");
		}
		seenBody = true;
		prevLineWasBody = true;
	}

	return {paragraphKinds, paragraphNumbers, smallCapsLines, literalLines};
}

const TK_PATTERN = "\\bTK(?:TK)*\\b";

export function hasTk(text: string): boolean {
	return new RegExp(TK_PATTERN).test(text);
}

export interface TkMatch {
	start: number;
	end: number;
}

export function matchTk(text: string): TkMatch[] {
	const regex = new RegExp(TK_PATTERN, "g");
	const matches: TkMatch[] = [];
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		matches.push({start: match.index, end: match.index + match[0].length});
		if (match.index === regex.lastIndex) {
			regex.lastIndex += 1;
		}
	}
	return matches;
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

// Range spanning the first `count` words of a line (letters/numbers) — or fewer if
// the line has fewer words — or null if there are none.
export function firstWordsRange(text: string, count: number): {start: number; end: number} | null {
	const regex = new RegExp(WORD_RE.source, "gu");
	let start = -1;
	let end = -1;
	let seen = 0;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		if (start === -1) {
			start = match.index;
		}
		end = match.index + match[0].length;
		seen += 1;
		if (seen >= count) {
			break;
		}
	}
	return start === -1 ? null : {start, end};
}
