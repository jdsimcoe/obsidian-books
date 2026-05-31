import {type Range} from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	type EditorView,
	type PluginValue,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import {MarkdownView, type App, type TFile} from "obsidian";
import {analyzeManuscript, firstWordsRange, matchTk} from "./manuscriptTypography";
import {isBooksPath} from "./utils/paths";

const INDENT_LINE = Decoration.line({class: "obsidian-books-para-indent"});
const CHAPTER_OPEN_LINE = Decoration.line({class: "obsidian-books-chapter-open"});
const DROPCAP_MARK = Decoration.mark({class: "obsidian-books-dropcap"});
const TK_NOTE_MARK = Decoration.mark({class: "obsidian-books-tk-note"});
const TK_MARK = Decoration.mark({class: "obsidian-books-tk"});
const SMALLCAPS_MARK = Decoration.mark({class: "obsidian-books-smallcaps"});
const QUOTE_INSET_LINE = Decoration.line({
	class: "obsidian-books-quote-line",
	attributes: {style: "padding-inline: 27px; text-indent: 0;"},
});
const INACTIVE_QUOTE_LINE = Decoration.line({class: "obsidian-books-quote-inactive"});
const QUOTE_HAS_NEXT_LINE = Decoration.line({class: "obsidian-books-quote-has-next"});
const QUOTE_LINE_RE = /^\s*>/;
const FOOTNOTE_DEFINITION_RE = /^\s*\[\^\d+\]:/u;
const FOOTNOTE_REF_RE = /\s*\[\^(\d+)\]/gu;

class FootnoteRefWidget extends WidgetType {
	constructor(private readonly id: string) {
		super();
	}

	eq(other: FootnoteRefWidget): boolean {
		return other.id === this.id;
	}

	toDOM(): HTMLElement {
		return createEl("sup", {
			cls: "obsidian-books-footnote-ref",
			text: this.id,
			attr: {"aria-label": `Footnote ${this.id}`},
		});
	}
}

// The editor view's bound file, even for the active editor (works regardless of
// whether the leaf's view is deferred — we match by DOM containment).
function owningManuscriptFile(app: App, view: EditorView): TFile | null {
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const candidate = leaf.view;
		if (candidate instanceof MarkdownView && candidate.containerEl.contains(view.dom)) {
			return candidate.file;
		}
	}
	return null;
}

function isManuscriptEditor(app: App, view: EditorView): boolean {
	const file = owningManuscriptFile(app, view);
	return file !== null && isBooksPath(file.path);
}

// Paragraph treatments rendered as CodeMirror decorations: first-line indent,
// chapter drop cap, small-caps section openers, and TK "to come" notes.
export function createManuscriptEditorExtension(app: App) {
	return ViewPlugin.fromClass(
		class implements PluginValue {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = this.buildDecorations(view);
			}

			update(update: ViewUpdate): void {
				if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged) {
					this.decorations = this.buildDecorations(update.view);
				}
			}

			private buildDecorations(view: EditorView): DecorationSet {
				if (!isManuscriptEditor(app, view)) {
					return Decoration.none;
				}

				const ranges: Range<Decoration>[] = [];
				const {doc} = view.state;
				const analysis = analyzeManuscript(doc.toString());

				for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
					const line = doc.line(lineNumber);
					const zeroBased = lineNumber - 1;

					if (QUOTE_LINE_RE.test(line.text)) {
						ranges.push(QUOTE_INSET_LINE.range(line.from));
						if (!selectionTouchesLine(view, line.from, line.to)) {
							ranges.push(INACTIVE_QUOTE_LINE.range(line.from));
						}
						const nextLine = lineNumber < doc.lines ? doc.line(lineNumber + 1) : null;
						if (nextLine && QUOTE_LINE_RE.test(nextLine.text)) {
							ranges.push(QUOTE_HAS_NEXT_LINE.range(line.from));
						}
					}

					const kind = analysis.paragraphKinds.get(zeroBased);
					if (kind === "indent") {
						ranges.push(INDENT_LINE.range(line.from));
					} else if (kind === "chapter-open") {
						ranges.push(CHAPTER_OPEN_LINE.range(line.from));
						if (line.length > 0) {
							// Square drop-cap tile on the first letter (overlaps the
							// small-caps mark; CodeMirror merges the classes).
							ranges.push(DROPCAP_MARK.range(line.from, line.from + 1));
						}
					}

					const number = analysis.paragraphNumbers.get(zeroBased);
					if (number !== undefined) {
						ranges.push(
							Decoration.line({
								class: "obsidian-books-para-number",
								attributes: {"data-books-paragraph": String(number)},
							}).range(line.from),
						);
					}

					if (analysis.smallCapsLines.has(zeroBased)) {
						const words = firstWordsRange(line.text, 4);
						if (words) {
							ranges.push(SMALLCAPS_MARK.range(line.from + words.start, line.from + words.end));
						}
					}

					if (!FOOTNOTE_DEFINITION_RE.test(line.text)) {
						for (const match of line.text.matchAll(FOOTNOTE_REF_RE)) {
							const id = match[1];
							if (id) {
								ranges.push(
									Decoration.replace({widget: new FootnoteRefWidget(id)})
										.range(line.from + match.index, line.from + match.index + match[0].length),
								);
							}
						}
					}

					if (!analysis.literalLines.has(zeroBased)) {
						const [first] = matchTk(line.text);
						if (first && line.from + first.start < line.to) {
							// The whole "to come" note: from TK to the end of the line.
							ranges.push(TK_NOTE_MARK.range(line.from + first.start, line.to));
							// The TK token itself, emphasized within the note.
							ranges.push(TK_MARK.range(line.from + first.start, line.from + first.end));
						}
					}
				}

				return Decoration.set(ranges, true);
			}
		},
		{
			decorations: (value) => value.decorations,
		},
	);
}

function selectionTouchesLine(view: EditorView, from: number, to: number): boolean {
	if (!view.hasFocus) {
		return false;
	}

	for (const range of view.state.selection.ranges) {
		if (range.empty) {
			if (range.from >= from && range.from <= to) {
				return true;
			}
			continue;
		}

		if (range.from <= to && range.to >= from) {
			return true;
		}
	}

	return false;
}
