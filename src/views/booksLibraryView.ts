import {ItemView, Notice, setIcon, type WorkspaceLeaf} from "obsidian";
import {BOOKS_LIBRARY_VIEW_TYPE} from "../constants";
import type BooksPlugin from "../main";
import type {BookRecord} from "../types";

type LibraryMode = "grid" | "list";

export class BooksLibraryView extends ItemView {
	private readonly plugin: BooksPlugin;
	private mode: LibraryMode = "list";
	private query = "";

	constructor(leaf: WorkspaceLeaf, plugin: BooksPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return BOOKS_LIBRARY_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Books";
	}

	getIcon(): string {
		return "book-open";
	}

	onOpen(): Promise<void> {
		this.register(this.plugin.bookStore.onChange(() => {
			void this.render();
		}));
		return this.render();
	}

	async render(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("obsidian-books-view", "obsidian-books-library-view");

		const headerEl = this.contentEl.createDiv({cls: "obsidian-books-header"});
		const titleWrapEl = headerEl.createDiv();
		titleWrapEl.createEl("h1", {text: "Books"});
		titleWrapEl.createDiv({
			cls: "obsidian-books-subtitle",
			text: "Long-form manuscripts in your vault.",
		});

		const actionsEl = headerEl.createDiv({cls: "obsidian-books-header-actions"});
		const searchEl = actionsEl.createEl("input", {
			cls: "obsidian-books-search",
			attr: {
				type: "search",
				placeholder: "Search books",
				"aria-label": "Search books",
			},
		});
		searchEl.value = this.query;
		searchEl.addEventListener("input", () => {
			this.query = searchEl.value;
			void this.renderBooks();
		});

		const modeButton = actionsEl.createEl("button", {
			cls: "clickable-icon obsidian-books-icon-button",
			attr: {
				type: "button",
				"aria-label": this.mode === "grid" ? "Show list" : "Show grid",
				title: this.mode === "grid" ? "Show list" : "Show grid",
			},
		});
		setIcon(modeButton, this.mode === "grid" ? "list" : "layout-grid");
		modeButton.addEventListener("click", () => {
			this.mode = this.mode === "grid" ? "list" : "grid";
			void this.render();
		});

		const createButton = actionsEl.createEl("button", {
			cls: "mod-cta obsidian-books-primary-button",
			text: "New book",
			attr: {type: "button"},
		});
		createButton.addEventListener("click", () => this.plugin.showCreateBookModal());

		this.contentEl.createDiv({cls: "obsidian-books-library-results"});
		await this.renderBooks();
	}

	private async renderBooks(): Promise<void> {
		const resultsEl = this.contentEl.querySelector(".obsidian-books-library-results");
		if (!(resultsEl instanceof HTMLElement)) {
			return;
		}

		resultsEl.empty();
		const books = await this.plugin.bookStore.listBooks();
		const filteredBooks = filterBooks(books, this.query);
		resultsEl.toggleClass("is-list", this.mode === "list");
		resultsEl.toggleClass("is-grid", this.mode === "grid");

		if (!filteredBooks.length) {
			const emptyEl = resultsEl.createDiv({cls: "obsidian-books-empty"});
			emptyEl.createEl("h2", {text: books.length ? "No matching books" : "No books yet"});
			emptyEl.createEl("p", {
				text: books.length ? "Try a different search." : "Create your first book to start a manuscript folder.",
			});
			return;
		}

		for (const book of filteredBooks) {
			this.renderBookCard(resultsEl, book);
		}
	}

	private renderBookCard(containerEl: HTMLElement, book: BookRecord): void {
		const cardEl = containerEl.createDiv({cls: "obsidian-books-card"});
		cardEl.tabIndex = 0;
		cardEl.addEventListener("click", () => {
			void this.plugin.openBookToc(book.manifest.id);
		});
		cardEl.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				void this.plugin.openBookToc(book.manifest.id);
			}
		});

		const metaEl = cardEl.createDiv({cls: "obsidian-books-card-meta"});
		metaEl.createSpan({text: book.manifest.genre || "Uncategorized"});
		metaEl.createSpan({text: book.manifest.status || "Draft"});

		cardEl.createEl("h2", {text: book.manifest.title});
		if (book.manifest.description) {
			cardEl.createEl("p", {text: book.manifest.description});
		}

		const footerEl = cardEl.createDiv({cls: "obsidian-books-card-footer"});
		footerEl.createSpan({text: `${book.manifest.sections.length} section${book.manifest.sections.length === 1 ? "" : "s"}`});

		const overviewButton = footerEl.createEl("button", {
			cls: "clickable-icon obsidian-books-icon-button",
			attr: {
				type: "button",
				"aria-label": "Open overview",
				title: "Open overview",
			},
		});
		setIcon(overviewButton, "file-text");
		overviewButton.addEventListener("click", (evt) => {
			evt.stopPropagation();
			void (async () => {
				try {
					await this.plugin.bookStore.openOverview(book);
				} catch (error) {
					new Notice(error instanceof Error ? error.message : "Could not open overview.");
				}
			})();
		});
	}
}

function filterBooks(books: BookRecord[], query: string): BookRecord[] {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return books;
	}

	return books.filter((book) => {
		const haystack = [
			book.manifest.title,
			book.manifest.genre,
			book.manifest.description,
			book.manifest.status,
		].join(" ").toLowerCase();
		return haystack.includes(normalizedQuery);
	});
}
