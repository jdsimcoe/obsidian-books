import {
	ItemView,
	MarkdownView,
	Modal,
	Notice,
	Setting,
	setIcon,
	TextAreaComponent,
	type App,
	type WorkspaceLeaf,
} from "obsidian";
import {BOOK_SPINE_VIEW_TYPE, BOOKS_SCRATCHPAD_VIEW_TYPE} from "../constants";
import type BooksPlugin from "../main";
import type {BookRecord, ScratchSnippet} from "../types";
import {isBooksPath} from "../utils/paths";

export class ScratchpadView extends ItemView {
	private readonly plugin: BooksPlugin;
	private bookId: string | null = null;
	private query = "";
	private searchVisible = false;
	private renderToken = 0;

	constructor(leaf: WorkspaceLeaf, plugin: BooksPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return BOOKS_SCRATCHPAD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Scratchpad";
	}

	getIcon(): string {
		return "signature";
	}

	onOpen(): Promise<void> {
		this.registerEvent(this.plugin.bookStore.onChange(() => void this.render()));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => void this.syncBook()));
		this.registerEvent(this.app.workspace.on("file-open", () => void this.syncBook()));
		return this.syncBook(true);
	}

	// Point the scratchpad at a specific book (used by the spine entry point).
	async setBook(bookId: string): Promise<void> {
		this.bookId = bookId;
		await this.render();
	}

	// Track the book of the most recent main-area tab — a book chapter or a spine.
	// Focusing the scratchpad/another sidebar doesn't count (so clicking into the
	// panel never clears it), and a non-book note clears it (empty state).
	private async syncBook(force = false): Promise<void> {
		const leaf = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
		const bookId = leaf ? await this.bookIdForLeaf(leaf) : null;
		if (force || bookId !== this.bookId) {
			this.bookId = bookId;
			await this.render();
		}
	}

	private async bookIdForLeaf(leaf: WorkspaceLeaf): Promise<string | null> {
		const state = leaf.getViewState();
		if (state.type === BOOK_SPINE_VIEW_TYPE) {
			return (state.state as {bookId?: string} | undefined)?.bookId ?? null;
		}
		const filePath = (state.state as {file?: string} | undefined)?.file;
		if (typeof filePath === "string") {
			const book = await this.plugin.bookStore.getBookForPath(filePath);
			return book?.manifest.id ?? null;
		}
		return null;
	}

	private async render(): Promise<void> {
		const token = this.renderToken + 1;
		this.renderToken = token;
		this.contentEl.empty();
		this.contentEl.addClass("obsidian-books-scratchpad");

		const book = this.bookId ? await this.plugin.bookStore.getBook(this.bookId) : null;
		if (token !== this.renderToken) {
			return;
		}

		if (!book) {
			const emptyEl = this.contentEl.createDiv({cls: "obsidian-books-sidebar-empty"});
			emptyEl.appendText("Open a book to view its scratchpad.");
			emptyEl.createEl("br");
			emptyEl.appendText("Right-click to save snippets to your book scratchpad from anywhere.");
			return;
		}

		this.renderHeader(book);
		if (this.searchVisible) {
			const search = this.contentEl.createEl("input", {
				cls: "obsidian-books-search",
				attr: {type: "search", placeholder: "Search scratchpad", "aria-label": "Search scratchpad"},
			});
			search.value = this.query;
			search.addEventListener("input", () => {
				this.query = search.value;
				void this.renderList(book);
			});
			search.focus();
		}

		this.contentEl.createDiv({cls: "obsidian-books-scratchpad-list"});
		await this.renderList(book);
	}

	private renderHeader(book: BookRecord): void {
		const headerEl = this.contentEl.createDiv({cls: "obsidian-books-scratchpad-header"});
		headerEl.createDiv({cls: "obsidian-books-scratchpad-title", text: book.manifest.title});

		const actionsEl = headerEl.createDiv({cls: "obsidian-books-scratchpad-actions"});
		this.addIconButton(actionsEl, "Search", "search", this.searchVisible, () => {
			this.searchVisible = !this.searchVisible;
			if (!this.searchVisible) {
				this.query = "";
			}
			void this.render();
		});
		this.addIconButton(actionsEl, "New snippet", "plus", false, () => {
			new ScratchpadComposeModal(this.app, async (text) => {
				await this.plugin.bookStore.addSnippet(book, text);
			}).open();
		});
	}

	private async renderList(book: BookRecord): Promise<void> {
		const token = this.renderToken;
		const listEl = this.contentEl.querySelector<HTMLElement>(".obsidian-books-scratchpad-list");
		if (!listEl) {
			return;
		}
		listEl.empty();

		const snippets = await this.plugin.bookStore.listSnippets(book);
		if (token !== this.renderToken) {
			return;
		}

		const needle = this.query.trim().toLowerCase();
		const filtered = needle
			? snippets.filter((snippet) => snippet.text.toLowerCase().includes(needle))
			: snippets;

		if (!filtered.length) {
			listEl.createDiv({
				cls: "obsidian-books-sidebar-empty",
				text: snippets.length ? "No matching snippets." : "Nothing saved yet. Right-click a selection → Save to scratchpad.",
			});
			return;
		}

		for (const snippet of filtered) {
			this.renderSnippet(listEl, book, snippet);
		}
	}

	private renderSnippet(listEl: HTMLElement, book: BookRecord, snippet: ScratchSnippet): void {
		const rowEl = listEl.createDiv({cls: "obsidian-books-scratch-row", attr: {draggable: "true"}});
		rowEl.addEventListener("dragstart", (evt) => {
			evt.dataTransfer?.setData("text/plain", snippet.text);
			if (evt.dataTransfer) {
				evt.dataTransfer.effectAllowed = "copy";
			}
		});

		rowEl.createDiv({cls: "obsidian-books-scratch-text", text: snippet.text});

		const actionsEl = rowEl.createDiv({cls: "obsidian-books-scratch-actions"});
		this.addIconButton(actionsEl, "Insert at cursor", "corner-down-left", false, () => {
			this.insertSnippet(snippet);
		});
		this.addIconButton(actionsEl, "Delete snippet", "trash-2", false, () => {
			void this.plugin.bookStore.removeSnippet(book, snippet.id);
		});
	}

	private insertSnippet(snippet: ScratchSnippet): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (!view || !file || !isBooksPath(file.path)) {
			new Notice("Open a book chapter to insert a snippet.");
			return;
		}
		view.editor.replaceSelection(snippet.text);
	}

	private addIconButton(
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
}

class ScratchpadComposeModal extends Modal {
	private readonly onSubmit: (text: string) => Promise<void>;
	private input: TextAreaComponent | null = null;

	constructor(app: App, onSubmit: (text: string) => Promise<void>) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		this.titleEl.setText("New snippet");
		this.contentEl.empty();
		new Setting(this.contentEl).setName("Text").addTextArea((component) => {
			this.input = component;
			component.inputEl.rows = 6;
			component.inputEl.addClass("obsidian-books-scratch-input");
			component.setPlaceholder("Stash a line, a phrase, a thought…");
		});
		new Setting(this.contentEl).addButton((button) => {
			button
				.setButtonText("Save")
				.setCta()
				.onClick(() => {
					const text = this.input?.getValue().trim() ?? "";
					if (!text) {
						this.close();
						return;
					}
					void (async () => {
						try {
							await this.onSubmit(text);
						} catch (error) {
							new Notice(error instanceof Error ? error.message : "Could not save snippet.");
						}
					})();
					this.close();
				});
		});
		this.input?.inputEl.focus();
	}
}
