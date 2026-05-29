import {type Range} from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	type EditorView,
	type PluginValue,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
import {MarkdownView, type App, type TFile} from "obsidian";
import {analyzeManuscript, firstWordRange, matchTk} from "./manuscriptTypography";
import {isBooksPath} from "./utils/paths";

const INDENT_LINE = Decoration.line({class: "obsidian-books-para-indent"});
const CHAPTER_OPEN_LINE = Decoration.line({class: "obsidian-books-chapter-open"});
const TK_NOTE_MARK = Decoration.mark({class: "obsidian-books-tk-note"});
const TK_MARK = Decoration.mark({class: "obsidian-books-tk"});
const SMALLCAPS_MARK = Decoration.mark({class: "obsidian-books-smallcaps"});

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
				if (update.docChanged || update.viewportChanged) {
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

					const kind = analysis.paragraphKinds.get(zeroBased);
					if (kind === "indent") {
						ranges.push(INDENT_LINE.range(line.from));
					} else if (kind === "chapter-open") {
						ranges.push(CHAPTER_OPEN_LINE.range(line.from));
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
						const word = firstWordRange(line.text);
						if (word) {
							ranges.push(SMALLCAPS_MARK.range(line.from + word.start, line.from + word.end));
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
