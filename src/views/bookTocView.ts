import {ItemView, Modal, Notice, Setting, setIcon, TextComponent, type App, type ViewStateResult, type WorkspaceLeaf} from "obsidian";
import {BOOK_TOC_VIEW_TYPE} from "../constants";
import type BooksPlugin from "../main";
import type {BookRecord, BookSection} from "../types";

export interface BookTocViewState extends Record<string, unknown> {
	bookId?: string;
}

export class BookTocView extends ItemView {
	private readonly plugin: BooksPlugin;
	private bookId: string | null = null;
	private book: BookRecord | null = null;
	private dragIndex: number | null = null;
	private renderToken = 0;

	constructor(leaf: WorkspaceLeaf, plugin: BooksPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return BOOK_TOC_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.book?.manifest.title ?? "Book";
	}

	getIcon(): string {
		return "book-open";
	}

	getState(): BookTocViewState {
		return {bookId: this.bookId ?? undefined};
	}

	async setState(state: BookTocViewState, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		this.bookId = state.bookId ?? null;
		await this.render();
	}

	onOpen(): Promise<void> {
		this.register(this.plugin.bookStore.onChange(() => {
			void this.loadBook();
		}));
		return this.loadBook();
	}

	private async loadBook(): Promise<void> {
		await this.render();
	}

	private async render(): Promise<void> {
		const renderToken = this.renderToken + 1;
		this.renderToken = renderToken;
		this.contentEl.empty();
		this.contentEl.addClass("obsidian-books-view", "obsidian-books-toc-view");
		if (!this.bookId) {
			this.book = null;
			this.renderMissing("No book selected.");
			return;
		}

		const book = await this.plugin.bookStore.getBook(this.bookId);
		if (renderToken !== this.renderToken) {
			return;
		}

		this.book = book;
		if (!book) {
			this.renderMissing("Book not found.");
			return;
		}

		const headerEl = this.contentEl.createDiv({cls: "obsidian-books-header"});
		const titleWrapEl = headerEl.createDiv();
		titleWrapEl.createEl("h1", {text: book.manifest.title});
		titleWrapEl.createDiv({
			cls: "obsidian-books-subtitle",
			text: `${book.manifest.genre || "Uncategorized"} / ${book.manifest.status || "Draft"}`,
		});

		const actionsEl = headerEl.createDiv({cls: "obsidian-books-header-actions"});
		const overviewButton = actionsEl.createEl("button", {
			cls: "obsidian-books-secondary-button",
			text: "Overview",
			attr: {type: "button"},
		});
		overviewButton.addEventListener("click", () => {
			void this.openOverview();
		});

		const addButton = actionsEl.createEl("button", {
			cls: "mod-cta obsidian-books-primary-button",
			text: "New section",
			attr: {type: "button"},
		});
		addButton.addEventListener("click", () => this.plugin.showCreateSectionModal(book));

		const listEl = this.contentEl.createDiv({cls: "obsidian-books-section-list"});
		if (!book.manifest.sections.length) {
			const emptyEl = listEl.createDiv({cls: "obsidian-books-empty"});
			emptyEl.createEl("h2", {text: "No sections yet"});
			emptyEl.createEl("p", {text: "Create a chapter, intro, appendix, or back matter section."});
			return;
		}

		book.manifest.sections.forEach((section, index) => {
			this.renderSectionRow(listEl, section, index);
		});
	}

	private renderSectionRow(containerEl: HTMLElement, section: BookSection, index: number): void {
		const rowEl = containerEl.createDiv({cls: "obsidian-books-section-row"});
		rowEl.draggable = true;
		rowEl.addEventListener("dragstart", () => {
			this.dragIndex = index;
			rowEl.addClass("is-dragging");
		});
		rowEl.addEventListener("dragend", () => {
			this.dragIndex = null;
			rowEl.removeClass("is-dragging");
		});
		rowEl.addEventListener("dragover", (evt) => {
			evt.preventDefault();
		});
		rowEl.addEventListener("drop", (evt) => {
			evt.preventDefault();
			if (!this.book || this.dragIndex === null || this.dragIndex === index) {
				return;
			}

			void (async () => {
				try {
					if (!this.book || this.dragIndex === null) {
						return;
					}
					this.book = await this.plugin.bookStore.reorderSection(this.book, this.dragIndex, index);
					await this.render();
				} catch (error) {
					new Notice(error instanceof Error ? error.message : "Could not reorder section.");
				}
			})();
		});

		const handleEl = rowEl.createDiv({cls: "obsidian-books-drag-handle"});
		setIcon(handleEl, "grip-vertical");

		const bodyEl = rowEl.createDiv({cls: "obsidian-books-section-body"});
		bodyEl.createDiv({cls: "obsidian-books-section-kicker", text: `${index + 1}. ${formatSectionType(section.type)}`});
		bodyEl.createEl("h2", {text: section.title});
		bodyEl.createDiv({cls: "obsidian-books-section-file", text: section.file});
		bodyEl.addEventListener("click", () => {
			void this.openSection(section);
		});

		const actionsEl = rowEl.createDiv({cls: "obsidian-books-section-actions"});
		this.addRowIconButton(actionsEl, "Open", "external-link", () => {
			void this.openSection(section);
		});
		this.addRowIconButton(actionsEl, "Rename", "pencil", () => {
			void this.renameSection(section);
		});
		this.addRowIconButton(actionsEl, "Remove from TOC", "x", () => {
			void this.removeSection(section);
		});
	}

	private addRowIconButton(containerEl: HTMLElement, label: string, icon: string, onClick: () => void): void {
		const button = containerEl.createEl("button", {
			cls: "clickable-icon obsidian-books-icon-button",
			attr: {
				type: "button",
				"aria-label": label,
				title: label,
			},
		});
		setIcon(button, icon);
		button.addEventListener("click", (evt) => {
			evt.stopPropagation();
			onClick();
		});
	}

	private renderMissing(message: string): void {
		const emptyEl = this.contentEl.createDiv({cls: "obsidian-books-empty"});
		emptyEl.createEl("h2", {text: message});
		const button = emptyEl.createEl("button", {
			cls: "mod-cta obsidian-books-primary-button",
			text: "Open books",
			attr: {type: "button"},
		});
		button.addEventListener("click", () => {
			void this.plugin.openBooksLibrary();
		});
	}

	private async openOverview(): Promise<void> {
		if (!this.book) {
			return;
		}

		try {
			await this.plugin.bookStore.openOverview(this.book);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not open overview.");
		}
	}

	private async openSection(section: BookSection): Promise<void> {
		if (!this.book) {
			return;
		}

		try {
			await this.plugin.bookStore.openSection(this.book, section, {newTab: true});
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not open section.");
		}
	}

	private async renameSection(section: BookSection): Promise<void> {
		if (!this.book) {
			return;
		}

		const nextTitle = await promptForSectionTitle(this.plugin.app, section.title);
		if (!nextTitle.trim()) {
			return;
		}

		try {
			this.book = await this.plugin.bookStore.renameSection(this.book, section.id, nextTitle);
			await this.render();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not rename section.");
		}
	}

	private async removeSection(section: BookSection): Promise<void> {
		if (!this.book) {
			return;
		}

		const action = await confirmRemoveSection(this.plugin.app, section.title);
		if (action === "cancel") {
			return;
		}

		try {
			this.book = await this.plugin.bookStore.removeSectionFromToc(this.book, section.id, {
				trashFile: action === "trash-file",
			});
			await this.render();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not remove section.");
		}
	}
}

function formatSectionType(type: string): string {
	if (type === "backmatter") {
		return "Back matter";
	}

	return type.charAt(0).toUpperCase() + type.slice(1);
}

function promptForSectionTitle(app: App, currentTitle: string): Promise<string> {
	return new Promise((resolve) => {
		new RenameSectionModal(app, currentTitle, resolve).open();
	});
}

type RemoveSectionAction = "cancel" | "keep-file" | "trash-file";

function confirmRemoveSection(app: App, sectionTitle: string): Promise<RemoveSectionAction> {
	return new Promise((resolve) => {
		new RemoveSectionModal(app, sectionTitle, resolve).open();
	});
}

class RenameSectionModal extends Modal {
	private input: TextComponent | null = null;
	private didSubmit = false;
	private readonly currentTitle: string;
	private readonly onResolve: (title: string) => void;

	constructor(app: App, currentTitle: string, onResolve: (title: string) => void) {
		super(app);
		this.currentTitle = currentTitle;
		this.onResolve = onResolve;
	}

	onOpen(): void {
		this.titleEl.setText("Rename section");
		this.contentEl.empty();

		new Setting(this.contentEl)
			.setName("Section title")
			.addText((component) => {
				this.input = component;
				component.setValue(this.currentTitle);
			});

		new Setting(this.contentEl)
			.addButton((button) => {
				button
					.setButtonText("Rename")
					.setCta()
					.onClick(() => {
						this.didSubmit = true;
						this.onResolve(this.input?.getValue() ?? "");
						this.close();
					});
			});

		this.input?.inputEl.focus();
		this.input?.inputEl.select();
	}

	onClose(): void {
		if (!this.didSubmit) {
			this.onResolve("");
		}
	}
}

class RemoveSectionModal extends Modal {
	private didChoose = false;
	private readonly sectionTitle: string;
	private readonly onResolve: (action: RemoveSectionAction) => void;

	constructor(app: App, sectionTitle: string, onResolve: (action: RemoveSectionAction) => void) {
		super(app);
		this.sectionTitle = sectionTitle;
		this.onResolve = onResolve;
	}

	onOpen(): void {
		this.titleEl.setText("Remove section");
		this.contentEl.empty();
		this.contentEl.createEl("p", {
			text: `Remove "${this.sectionTitle}" from the TOC. You can keep the Markdown file in the book folder or move it to trash too.`,
		});

		new Setting(this.contentEl)
			.addButton((button) => {
				button
					.setButtonText("Cancel")
					.onClick(() => {
						this.didChoose = true;
						this.onResolve("cancel");
						this.close();
					});
			})
			.addButton((button) => {
				button
					.setButtonText("Remove")
					.onClick(() => {
						this.didChoose = true;
						this.onResolve("keep-file");
						this.close();
					});
			})
			.addButton((button) => {
				button
					.setButtonText("Remove file")
					.setWarning()
					.onClick(() => {
						this.didChoose = true;
						this.onResolve("trash-file");
						this.close();
					});
			});
	}

	onClose(): void {
		if (!this.didChoose) {
			this.onResolve("cancel");
		}
	}
}
