import {ItemView, Notice, setIcon, type WorkspaceLeaf} from "obsidian";
import {BOOKS_SIDEBAR_VIEW_TYPE} from "../constants";
import type BooksPlugin from "../main";
import {insertMirrorReference} from "../search/insertMirrorReference";
import type {SearchableNoteResult} from "../search/noteSearchIndex";

export class BooksSidebarView extends ItemView {
	private readonly plugin: BooksPlugin;
	private query = "";
	private renderToken = 0;

	constructor(leaf: WorkspaceLeaf, plugin: BooksPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return BOOKS_SIDEBAR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Book research";
	}

	getIcon(): string {
		return "search";
	}

	onOpen(): Promise<void> {
		return this.render();
	}

	async render(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("obsidian-books-sidebar");

		const headerEl = this.contentEl.createDiv({cls: "obsidian-books-sidebar-header"});
		headerEl.createEl("h2", {text: "Research"});
		const searchEl = headerEl.createEl("input", {
			cls: "obsidian-books-search",
			attr: {
				type: "search",
				placeholder: "Search notes",
				"aria-label": "Search notes",
			},
		});
		searchEl.value = this.query;
		searchEl.addEventListener("input", () => {
			this.query = searchEl.value;
			void this.renderResults();
		});

		this.contentEl.createDiv({cls: "obsidian-books-sidebar-results"});
		await this.renderResults();
	}

	private async renderResults(): Promise<void> {
		const token = this.renderToken + 1;
		this.renderToken = token;
		const resultsEl = this.contentEl.querySelector(".obsidian-books-sidebar-results");
		if (!(resultsEl instanceof HTMLElement)) {
			return;
		}

		resultsEl.empty();
		const results = await this.plugin.noteSearchIndex.search(this.query, 40);
		if (token !== this.renderToken) {
			return;
		}

		const title = this.query.trim() ? "Search results" : "Recent notes";
		resultsEl.createDiv({cls: "obsidian-books-sidebar-section-title", text: title});

		if (!results.length) {
			resultsEl.createDiv({cls: "obsidian-books-sidebar-empty", text: "No notes found."});
			return;
		}

		for (const result of results) {
			this.renderResult(resultsEl, result);
		}
	}

	private renderResult(containerEl: HTMLElement, result: SearchableNoteResult): void {
		const rowEl = containerEl.createDiv({cls: "obsidian-books-research-row"});

		const iconEl = rowEl.createDiv({cls: "obsidian-books-research-icon"});
		setIcon(iconEl, result.kind === "block" ? "quote" : "file-text");

		const bodyEl = rowEl.createDiv({cls: "obsidian-books-research-body"});
		bodyEl.createDiv({cls: "obsidian-books-research-title", text: result.displayText});
		bodyEl.createDiv({cls: "obsidian-books-research-path", text: result.pathText});

		const actionsEl = rowEl.createDiv({cls: "obsidian-books-research-actions"});
		const insertButton = actionsEl.createEl("button", {
			cls: "clickable-icon obsidian-books-icon-button",
			attr: {
				type: "button",
				"aria-label": "Insert mirror embed",
				title: "Insert mirror embed",
			},
		});
		setIcon(insertButton, "plus");
		insertButton.addEventListener("click", () => {
			void (async () => {
				try {
					await insertMirrorReference(this.plugin.app, result);
					new Notice("Inserted research embed.");
				} catch (error) {
					new Notice(error instanceof Error ? error.message : "Could not insert research embed.");
				}
			})();
		});

		const openButton = actionsEl.createEl("button", {
			cls: "clickable-icon obsidian-books-icon-button",
			attr: {
				type: "button",
				"aria-label": "Open note",
				title: "Open note",
			},
		});
		setIcon(openButton, "external-link");
		openButton.addEventListener("click", () => {
			void this.plugin.app.workspace.getLeaf(false).openFile(result.file);
		});
	}
}
