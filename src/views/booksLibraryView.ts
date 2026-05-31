import {ItemView, Menu, Modal, Notice, SearchComponent, Setting, setIcon, type App, type WorkspaceLeaf} from "obsidian";
import {BOOKS_LIBRARY_VIEW_TYPE} from "../constants";
import type BooksPlugin from "../main";
import type {BookRecord} from "../types";
import {countChapters} from "../utils/tree";

type LibraryMode = "grid" | "list";

export class BooksLibraryView extends ItemView {
	private readonly plugin: BooksPlugin;
	private mode: LibraryMode = "list";
	private query = "";
	private searchVisible = false;
	private readonly wordCounts = new Map<string, number>();

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
		// Recompute word counts on a full render (also fired when a chapter is
		// modified, via the book store's vault listeners).
		this.wordCounts.clear();
		this.contentEl.empty();
		this.contentEl.addClass("obsidian-books-view", "obsidian-books-library-view");

		const navEl = this.contentEl.createDiv({cls: "obsidian-books-nav-header"});
		this.addNavButton(navEl, "New book", "plus", false, () => {
			this.plugin.showCreateBookModal();
		});
		this.addNavButton(navEl, "Search", "search", this.searchVisible, () => {
			this.searchVisible = !this.searchVisible;
			if (!this.searchVisible) {
				this.query = "";
			}
			void this.render();
		});
		this.addNavButton(
			navEl,
			this.mode === "grid" ? "Show as list" : "Show as grid",
			this.mode === "grid" ? "list" : "layout-grid",
			false,
			() => {
				this.mode = this.mode === "grid" ? "list" : "grid";
				void this.render();
			},
		);

		if (this.searchVisible) {
			const search = new SearchComponent(this.contentEl);
			search.setPlaceholder("Search...");
			search.setValue(this.query);
			search.onChange((value) => {
				this.query = value;
				void this.renderBooks();
			});
			search.inputEl.focus();
		}

		this.contentEl.createDiv({cls: "obsidian-books-library-results"});
		await this.renderBooks();
	}

	private addNavButton(
		containerEl: HTMLElement,
		label: string,
		icon: string,
		active: boolean,
		onClick: () => void,
	): void {
		const button = containerEl.createEl("button", {
			cls: "clickable-icon obsidian-books-icon-button",
			attr: {type: "button", "aria-label": label, title: label},
		});
		button.toggleClass("is-active", active);
		setIcon(button, icon);
		button.addEventListener("click", onClick);
	}

	private async renderBooks(): Promise<void> {
		const resultsEl = this.contentEl.querySelector<HTMLElement>(".obsidian-books-library-results");
		if (!resultsEl) {
			return;
		}

		resultsEl.empty();
		const books = await this.plugin.bookStore.listBooks();
		const filteredBooks = filterBooks(books, this.query);
		resultsEl.toggleClass("is-list", this.mode === "list");
		resultsEl.toggleClass("is-grid", this.mode === "grid");

		if (!filteredBooks.length) {
			const emptyEl = resultsEl.createDiv({cls: "obsidian-books-empty"});
			emptyEl.createEl("h2", {text: books.length ? "No matching books" : "No books found"});
			emptyEl.createEl("p", {
				text: books.length ? "Try a different search." : "Create your first book to start a manuscript folder.",
			});
			return;
		}

		await Promise.all(
			filteredBooks
				.filter((book) => !this.wordCounts.has(book.manifest.id))
				.map(async (book) => {
					this.wordCounts.set(book.manifest.id, await this.plugin.bookStore.countWords(book));
				}),
		);

		for (const book of filteredBooks) {
			if (this.mode === "list") {
				this.renderBookRow(resultsEl, book);
			} else {
				this.renderBookCard(resultsEl, book);
			}
		}
	}

	private renderBookCard(containerEl: HTMLElement, book: BookRecord): void {
		const cardEl = containerEl.createDiv({cls: "obsidian-books-card"});
		this.attachBookInteractions(cardEl, book);

		const metaEl = cardEl.createDiv({cls: "obsidian-books-card-meta"});
		metaEl.createSpan({text: book.manifest.genre || "Uncategorized"});
		metaEl.createSpan({text: book.manifest.status || "Draft"});

		cardEl.createEl("h2", {text: book.manifest.title});
		if (book.manifest.description) {
			cardEl.createEl("p", {text: book.manifest.description});
		}

		const footerEl = cardEl.createDiv({cls: "obsidian-books-card-footer"});
		footerEl.createSpan({
			text: `${chapterLabel(book)} · ${wordLabel(this.wordCounts.get(book.manifest.id) ?? 0)}`,
		});
	}

	private renderBookRow(containerEl: HTMLElement, book: BookRecord): void {
		const rowEl = containerEl.createDiv({cls: "obsidian-books-book-row"});
		this.attachBookInteractions(rowEl, book);

		const bodyEl = rowEl.createDiv({cls: "obsidian-books-book-row-body"});
		bodyEl.createDiv({cls: "obsidian-books-book-row-title", text: book.manifest.title});
		const metaParts = [
			chapterLabel(book),
			wordLabel(this.wordCounts.get(book.manifest.id) ?? 0),
		];
		bodyEl.createDiv({cls: "obsidian-books-book-row-meta", text: metaParts.join(" · ")});
	}

	private attachBookInteractions(el: HTMLElement, book: BookRecord): void {
		el.tabIndex = 0;
		el.addEventListener("click", () => {
			void this.plugin.openBookSpine(book.manifest.id);
		});
		el.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") {
				evt.preventDefault();
				void this.plugin.openBookSpine(book.manifest.id);
			}
		});
		el.addEventListener("contextmenu", (evt) => {
			evt.preventDefault();
			this.showBookMenu(evt, book);
		});
	}

	private showBookMenu(evt: MouseEvent, book: BookRecord): void {
		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle("Open")
				.setIcon("book-open")
				.onClick(() => {
					void this.plugin.openBookSpine(book.manifest.id);
				});
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle("Delete book")
				.setIcon("trash-2")
				.setWarning(true)
				.onClick(() => {
					void this.confirmDeleteBook(book);
				});
		});
		menu.showAtMouseEvent(evt);
	}

	private async confirmDeleteBook(book: BookRecord): Promise<void> {
		const confirmed = await confirmDeleteBook(this.plugin.app, book.manifest.title);
		if (!confirmed) {
			return;
		}

		try {
			await this.plugin.bookStore.deleteBook(book);
			new Notice(`Deleted "${book.manifest.title}".`);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not delete book.");
		}
	}
}

function chapterLabel(book: BookRecord): string {
	const count = countChapters(book.manifest.nodes);
	return `${count} chapter${count === 1 ? "" : "s"}`;
}

function wordLabel(count: number): string {
	return `${count.toLocaleString()} word${count === 1 ? "" : "s"}`;
}

function confirmDeleteBook(app: App, bookTitle: string): Promise<boolean> {
	return new Promise((resolve) => {
		new DeleteBookModal(app, bookTitle, resolve).open();
	});
}

class DeleteBookModal extends Modal {
	private didChoose = false;
	private readonly bookTitle: string;
	private readonly onResolve: (confirmed: boolean) => void;

	constructor(app: App, bookTitle: string, onResolve: (confirmed: boolean) => void) {
		super(app);
		this.bookTitle = bookTitle;
		this.onResolve = onResolve;
	}

	onOpen(): void {
		this.titleEl.setText("Delete book");
		this.contentEl.empty();
		this.contentEl.createEl("p", {
			text: `Move "${this.bookTitle}" and all of its sections to trash? This deletes the entire book folder.`,
		});

		new Setting(this.contentEl)
			.addButton((button) => {
				button.setButtonText("Cancel").onClick(() => {
					this.didChoose = true;
					this.onResolve(false);
					this.close();
				});
			})
			.addButton((button) => {
					button
						.setButtonText("Delete book")
						.setDestructive()
					.onClick(() => {
						this.didChoose = true;
						this.onResolve(true);
						this.close();
					});
			});
	}

	onClose(): void {
		if (!this.didChoose) {
			this.onResolve(false);
		}
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
