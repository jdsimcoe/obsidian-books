import {
	EditorSuggest,
	renderMatches,
	TFile,
	type Editor,
	type EditorPosition,
	type EditorSuggestContext,
	type EditorSuggestTriggerInfo,
} from "obsidian";
import type BooksPlugin from "../main";
import {isBooksPath} from "../utils/paths";
import {buildBookQuoteInsertion} from "./insertBookQuote";
import type {SearchableNoteResult} from "./noteSearchIndex";

export class BookQuoteSuggester extends EditorSuggest<SearchableNoteResult> {
	private readonly plugin: BooksPlugin;

	constructor(plugin: BooksPlugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.limit = 40;
		this.setInstructions([
			{command: "Enter", purpose: "Insert blockquote citation"},
			{command: "Esc", purpose: "Dismiss"},
		]);
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!file || !isBooksPath(file.path)) {
			return null;
		}

		const linePrefix = editor.getLine(cursor.line).slice(0, cursor.ch);
		const match = linePrefix.match(/^(\s*)@([^\n]*)$/u);
		if (!match) {
			return null;
		}

		const [, leadingWhitespace = "", query = ""] = match;
		return {
			start: {line: cursor.line, ch: leadingWhitespace.length},
			end: cursor,
			query,
		};
	}

	getSuggestions(context: EditorSuggestContext): Promise<SearchableNoteResult[]> {
		return this.plugin.noteSearchIndex.search(context.query, this.limit);
	}

	renderSuggestion(result: SearchableNoteResult, el: HTMLElement): void {
		el.addClass("obsidian-books-citation-suggestion");
		const titleEl = el.createDiv({cls: "obsidian-books-citation-suggestion-title"});
		const query = this.context?.query.trim().toLowerCase() ?? "";
		const matches = query ? simpleSubstringMatches(result.displayText.toLowerCase(), query) : null;
		if (matches) {
			renderMatches(titleEl, result.displayText, matches);
		} else {
			titleEl.setText(result.displayText);
		}
		el.createDiv({
			cls: "obsidian-books-citation-suggestion-path",
			text: `${result.kind === "block" ? "Block" : "Note"} / ${result.pathText}`,
		});
	}

	selectSuggestion(result: SearchableNoteResult): void {
		if (!this.context) {
			return;
		}

		void this.insertSuggestion(result);
	}

	private async insertSuggestion(result: SearchableNoteResult): Promise<void> {
		if (!this.context) {
			return;
		}

		const insertion = await buildBookQuoteInsertion(this.plugin.app, result, this.context.file);
		this.context.editor.replaceRange(insertion, this.context.start, this.context.end);
		this.close();
	}
}

function simpleSubstringMatches(text: string, query: string): [number, number][] | null {
	if (!query) {
		return null;
	}

	const start = text.indexOf(query);
	if (start < 0) {
		return null;
	}

	return [[start, start + query.length]];
}
