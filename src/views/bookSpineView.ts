import {writeFileSync} from "fs";
import {homedir} from "os";
import {join} from "path";
import {dialog} from "@electron/remote";
import {ItemView, Modal, Notice, Setting, setIcon, TextComponent, type App, type ViewStateResult, type WorkspaceLeaf} from "obsidian";
import {BOOK_SPINE_VIEW_TYPE} from "../constants";
import type BooksPlugin from "../main";
import {BookModal} from "../modals/bookModal";
import type {BookEntry, BookNode, BookPart, BookRecord, CreateBookInput} from "../types";
import {sanitizeFileName} from "../utils/ids";
import {flattenEntries, isCanvasEntry, isPart} from "../utils/tree";

export interface BookSpineViewState extends Record<string, unknown> {
	bookId?: string;
}

type DragKind = "entry" | "part";

interface DragState {
	kind: DragKind;
	id: string;
}

interface DropSpec {
	partId: string | null;
	beforeId: string | null;
}

export class BookSpineView extends ItemView {
	private readonly plugin: BooksPlugin;
	private bookId: string | null = null;
	private book: BookRecord | null = null;
	private drag: DragState | null = null;
	private entryWordCounts = new Map<string, number>();
	private readonly collapsedParts = new Set<string>();
	private renderToken = 0;

	constructor(leaf: WorkspaceLeaf, plugin: BooksPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return BOOK_SPINE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.book?.manifest.title ?? "Book";
	}

	getIcon(): string {
		return "book-open";
	}

	getState(): BookSpineViewState {
		return {bookId: this.bookId ?? undefined};
	}

	async setState(state: BookSpineViewState, result: ViewStateResult): Promise<void> {
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
		this.contentEl.addClass("obsidian-books-view", "obsidian-books-spine-view");
		this.contentEl.removeClass("obsidian-books-spine-missing");
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

		const wordCounts = await this.plugin.bookStore.wordCountsByEntry(book);
		if (renderToken !== this.renderToken) {
			return;
		}
		this.entryWordCounts = wordCounts;

		this.renderCoverDisplay(book);
		this.renderTree(book);
	}

	private renderCoverDisplay(book: BookRecord): void {
		const coverEl = this.contentEl.createDiv({cls: "obsidian-books-header obsidian-books-cover"});
		const mainEl = coverEl.createDiv({cls: "obsidian-books-cover-main"});
		mainEl.createEl("h1", {text: book.manifest.title});
		mainEl.createDiv({
			cls: "obsidian-books-subtitle",
			text: `${book.manifest.genre || "Uncategorized"} / ${book.manifest.status || "Draft"}`,
		});
		if (book.manifest.description) {
			mainEl.createEl("p", {cls: "obsidian-books-cover-description", text: book.manifest.description});
		}

		const actionsEl = coverEl.createDiv({cls: "obsidian-books-header-actions"});
		const scratchpadButton = actionsEl.createEl("button", {
			cls: "clickable-icon obsidian-books-icon-button",
			attr: {type: "button", "aria-label": "Open scratchpad", title: "Open scratchpad"},
		});
		setIcon(scratchpadButton, "signature");
		scratchpadButton.addEventListener("click", () => void this.plugin.openScratchpad(book.manifest.id));

		const exportButton = actionsEl.createEl("button", {
			cls: "clickable-icon obsidian-books-icon-button",
			attr: {type: "button", "aria-label": "Compile book for export", title: "Compile book for export"},
		});
		setIcon(exportButton, "file-output");
		exportButton.addEventListener("click", () => void this.exportBook());

		const editButton = actionsEl.createEl("button", {
			cls: "clickable-icon obsidian-books-icon-button",
			attr: {type: "button", "aria-label": "Edit details", title: "Edit details"},
		});
		setIcon(editButton, "pencil");
		editButton.addEventListener("click", () => void this.editDetails(book));

		const addCanvasButton = actionsEl.createEl("button", {
			cls: "clickable-icon obsidian-books-icon-button",
			attr: {type: "button", "aria-label": "New canvas", title: "New canvas"},
		});
		setIcon(addCanvasButton, "layout-dashboard");
		addCanvasButton.addEventListener("click", () => void this.addCanvas(null));

		const addPartButton = actionsEl.createEl("button", {
			cls: "obsidian-books-primary-button",
			text: "Add section",
			attr: {type: "button"},
		});
		addPartButton.addEventListener("click", () => void this.addPart());

		const addButton = actionsEl.createEl("button", {
			cls: "mod-cta obsidian-books-primary-button",
			text: "New chapter",
			attr: {type: "button"},
		});
		addButton.addEventListener("click", () => this.plugin.showCreateSectionModal(book));
	}

	private async editDetails(book: BookRecord): Promise<void> {
		const genres = await this.plugin.bookStore.listGenres();
		new BookModal(this.plugin.app, genres, (input) => {
			void this.saveCover(book, input);
		}, {
			heading: "Edit book",
			submitText: "Save changes",
			initial: {
				title: book.manifest.title,
				genre: book.manifest.genre,
				status: book.manifest.status || "Draft",
				description: book.manifest.description,
			},
		}).open();
	}

	private async saveCover(book: BookRecord, input: CreateBookInput): Promise<void> {
		try {
			this.book = await this.plugin.bookStore.updateBookDetails(book, input);
			await this.render();
			new Notice("Book details updated.");
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not update book details.");
		}
	}

	private renderTree(book: BookRecord): void {
		const listEl = this.contentEl.createDiv({cls: "obsidian-books-section-list"});
		const nodes = book.manifest.nodes;
		if (!nodes.length) {
			this.renderEmptySections(listEl);
			return;
		}

		const order = new Map<string, number>();
		flattenEntries(nodes)
			.filter((entry) => !isCanvasEntry(entry))
			.forEach((entry, index) => order.set(entry.id, index + 1));

		this.renderHead(listEl, nodes);

		for (const node of nodes) {
			if (isPart(node)) {
				this.renderPart(listEl, book, node, order);
			} else {
				this.renderEntryRow(listEl, node, null, order);
			}
		}

		this.renderTail(listEl);
	}

	private renderPart(containerEl: HTMLElement, book: BookRecord, part: BookPart, order: Map<string, number>): void {
		const collapsed = this.collapsedParts.has(part.id);
		const partEl = containerEl.createDiv({cls: "obsidian-books-part"});
		if (collapsed) {
			partEl.addClass("is-collapsed");
		}

		const headerEl = partEl.createDiv({cls: "obsidian-books-part-header"});
		this.attachDnd(headerEl, {
			drag: {kind: "part", id: part.id},
			drop: (kind) => kind === "entry"
				? {partId: part.id, beforeId: null}
				: {partId: null, beforeId: part.id},
		});

		const toggleEl = headerEl.createDiv({cls: "obsidian-books-part-toggle"});
		setIcon(toggleEl, collapsed ? "chevron-right" : "chevron-down");
		toggleEl.addEventListener("click", (evt) => {
			evt.stopPropagation();
			if (collapsed) {
				this.collapsedParts.delete(part.id);
			} else {
				this.collapsedParts.add(part.id);
			}
			void this.render();
		});

		const mainEl = headerEl.createDiv({cls: "obsidian-books-part-header-main"});

		const handleEl = mainEl.createDiv({cls: "obsidian-books-drag-handle"});
		setIcon(handleEl, "grip-vertical");

		const bodyEl = mainEl.createDiv({cls: "obsidian-books-part-body"});
		bodyEl.createEl("h2", {text: part.title});
		const count = part.children.filter((child) => !isCanvasEntry(child)).length;
		bodyEl.createDiv({cls: "obsidian-books-part-count", text: `${count} chapter${count === 1 ? "" : "s"}`});

		const actionsEl = mainEl.createDiv({cls: "obsidian-books-section-actions"});
		this.addRowIconButton(actionsEl, "Add chapter", "plus", () => {
			this.plugin.showCreateSectionModal(book, "chapter", part.id);
		});
		this.addRowIconButton(actionsEl, "Add canvas", "layout-dashboard", () => {
			void this.addCanvas(part.id);
		});
		this.addRowIconButton(actionsEl, "Rename section", "pencil", () => {
			void this.renamePart(part);
		});
		this.addRowIconButton(actionsEl, "Remove section", "trash-2", () => {
			void this.removePart(part);
		});

		if (collapsed) {
			return;
		}

		const childrenEl = partEl.createDiv({cls: "obsidian-books-part-children"});
		if (!part.children.length) {
			const emptyEl = childrenEl.createDiv({cls: "obsidian-books-part-empty"});
			emptyEl.setText("Drop chapters here or add one.");
			this.attachDnd(emptyEl, {
				drop: (kind) => kind === "entry" ? {partId: part.id, beforeId: null} : null,
			});
			return;
		}

		for (const child of part.children) {
			this.renderEntryRow(childrenEl, child, part.id, order);
		}
	}

	private renderEntryRow(containerEl: HTMLElement, entry: BookEntry, partId: string | null, order: Map<string, number>): void {
		const isCanvas = isCanvasEntry(entry);
		const entryEl = containerEl.createDiv({cls: "obsidian-books-entry"});
		if (isCanvas) {
			entryEl.addClass("is-canvas");
		}
		const position = order.get(entry.id);
		entryEl.createDiv({cls: "obsidian-books-entry-number", text: position ? String(position) : ""});

		const rowEl = entryEl.createDiv({cls: "obsidian-books-section-row"});
		this.attachDnd(rowEl, {
			drag: {kind: "entry", id: entry.id},
			drop: (kind) => {
				if (kind === "part") {
					return partId === null ? {partId: null, beforeId: entry.id} : null;
				}
				return {partId, beforeId: entry.id};
			},
		});

		const handleEl = rowEl.createDiv({cls: "obsidian-books-drag-handle"});
		setIcon(handleEl, "grip-vertical");

		const bodyEl = rowEl.createDiv({cls: "obsidian-books-section-body"});
		bodyEl.createEl("h2", {text: entry.title});
		if (isCanvas) {
			bodyEl.createDiv({cls: "obsidian-books-format-chip", text: "CANVAS"});
		} else {
			const words = this.entryWordCounts.get(entry.id) ?? 0;
			bodyEl.createDiv({
				cls: "obsidian-books-entry-count",
				text: `${words.toLocaleString()} word${words === 1 ? "" : "s"}`,
			});
		}
		bodyEl.addEventListener("click", () => {
			void this.openEntry(entry);
		});

		const actionsEl = rowEl.createDiv({cls: "obsidian-books-section-actions"});
		this.addRowIconButton(actionsEl, "Rename", "pencil", () => {
			void this.renameEntry(entry);
		});
		this.addRowIconButton(actionsEl, "Remove from TOC", "trash-2", () => {
			void this.removeEntry(entry);
		});
	}

	// Drop zone above the first node, for placing an entry/part at the very top
	// (top level, above sections).
	private renderHead(containerEl: HTMLElement, nodes: BookNode[]): void {
		const firstId = nodes[0]?.id ?? null;
		const headEl = containerEl.createDiv({cls: "obsidian-books-drop-head"});
		this.attachDnd(headEl, {
			drop: () => ({partId: null, beforeId: firstId}),
		});
	}

	private renderTail(containerEl: HTMLElement): void {
		const tailEl = containerEl.createDiv({cls: "obsidian-books-drop-tail"});
		this.attachDnd(tailEl, {
			drop: () => ({partId: null, beforeId: null}),
		});
	}

	private attachDnd(rowEl: HTMLElement, opts: {drag?: DragState; drop?: (kind: DragKind) => DropSpec | null}): void {
		if (opts.drag) {
			const drag = opts.drag;
			rowEl.draggable = true;
			rowEl.addEventListener("dragstart", (evt) => {
				this.drag = drag;
				rowEl.addClass("is-dragging");
				this.contentEl.addClass("is-dragging");
				evt.stopPropagation();
			});
			rowEl.addEventListener("dragend", () => {
				this.drag = null;
				rowEl.removeClass("is-dragging");
				this.contentEl.removeClass("is-dragging");
			});
		}

		if (opts.drop) {
			const resolve = opts.drop;
			rowEl.addEventListener("dragover", (evt) => {
				if (!this.drag || !resolve(this.drag.kind)) {
					return;
				}
				evt.preventDefault();
				evt.stopPropagation();
				rowEl.addClass("is-drop-target");
			});
			rowEl.addEventListener("dragleave", () => rowEl.removeClass("is-drop-target"));
			rowEl.addEventListener("drop", (evt) => {
				rowEl.removeClass("is-drop-target");
				if (!this.drag) {
					return;
				}
				const drag = this.drag;
				const spec = resolve(drag.kind);
				if (!spec) {
					return;
				}
				evt.preventDefault();
				evt.stopPropagation();
				void this.applyDrop(drag, spec);
			});
		}
	}

	private async applyDrop(drag: DragState, spec: DropSpec): Promise<void> {
		if (!this.book) {
			return;
		}

		try {
			if (drag.kind === "entry") {
				if (spec.beforeId === drag.id) {
					return;
				}
				this.book = await this.plugin.bookStore.moveEntry(this.book, drag.id, {
					partId: spec.partId,
					beforeId: spec.beforeId,
				});
			} else {
				if (spec.partId !== null || spec.beforeId === drag.id) {
					return;
				}
				this.book = await this.plugin.bookStore.movePart(this.book, drag.id, spec.beforeId);
			}
			await this.render();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not move item.");
		}
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

	private renderEmptySections(containerEl: HTMLElement): void {
		const emptyEl = containerEl.createDiv({cls: "obsidian-books-blank-state obsidian-books-spine-empty"});
		const iconEl = emptyEl.createDiv({cls: "obsidian-books-blank-state-icon"});
		setIcon(iconEl, "book-open");
		emptyEl.createDiv({cls: "obsidian-books-blank-state-text", text: "No sections or chapters yet."});
	}

	private renderMissing(message: string): void {
		this.contentEl.addClass("obsidian-books-spine-missing");
		const emptyEl = this.contentEl.createDiv({cls: "obsidian-books-blank-state"});
		const iconEl = emptyEl.createDiv({cls: "obsidian-books-blank-state-icon"});
		setIcon(iconEl, "book-open");
		emptyEl.createDiv({cls: "obsidian-books-blank-state-text", text: message});
	}

	private async openEntry(entry: BookEntry): Promise<void> {
		if (!this.book) {
			return;
		}

		try {
			await this.plugin.bookStore.openEntry(this.book, entry, {newTab: true});
			if (isCanvasEntry(entry)) {
				// Reveal the scratchpad alongside the canvas so you can drag snippets in.
				await this.plugin.openScratchpad(this.book.manifest.id, false);
			}
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not open chapter.");
		}
	}

	private async exportBook(): Promise<void> {
		if (!this.book) {
			return;
		}
		const book = this.book;
		try {
			const content = await this.plugin.bookStore.compileBookMarkdown(book);
			const result = await dialog.showSaveDialog({
				title: "Export book",
				defaultPath: join(homedir(), "Downloads", `${sanitizeFileName(book.manifest.title)}.md`),
				filters: [{name: "Markdown", extensions: ["md"]}],
			});
			if (result.canceled || !result.filePath) {
				return;
			}
			writeFileSync(result.filePath, content, "utf8");
			new Notice(`Exported to ${result.filePath}`);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not export book.");
		}
	}

	private async addCanvas(partId: string | null): Promise<void> {
		if (!this.book) {
			return;
		}

		const title = await promptForTitle(this.plugin.app, {
			heading: "New canvas",
			label: "Canvas title",
			value: "",
			cta: "Create canvas",
		});
		if (!title.trim()) {
			return;
		}

		try {
			const result = await this.plugin.bookStore.createCanvas({
				book: this.book,
				title,
				partId: partId ?? undefined,
				atTop: partId === null,
			});
			this.book = result.book;
			await this.render();
			await this.openEntry(result.entry);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not create canvas.");
		}
	}

	private async addPart(): Promise<void> {
		if (!this.book) {
			return;
		}

		const title = await promptForTitle(this.plugin.app, {
			heading: "Add section",
			label: "Section title",
			value: "",
			cta: "Add section",
		});
		if (!title.trim()) {
			return;
		}

		try {
			this.book = await this.plugin.bookStore.createPart({book: this.book, title});
			await this.render();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not add section.");
		}
	}

	private async renamePart(part: BookPart): Promise<void> {
		if (!this.book) {
			return;
		}

		const nextTitle = await promptForTitle(this.plugin.app, {
			heading: "Rename section",
			label: "Section title",
			value: part.title,
			cta: "Rename",
		});
		if (!nextTitle.trim()) {
			return;
		}

		try {
			this.book = await this.plugin.bookStore.renamePart(this.book, part.id, nextTitle);
			await this.render();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not rename section.");
		}
	}

	private async removePart(part: BookPart): Promise<void> {
		if (!this.book) {
			return;
		}

		const confirmed = await confirmRemovePart(this.plugin.app, part);
		if (!confirmed) {
			return;
		}

		try {
			this.book = await this.plugin.bookStore.removePart(this.book, part.id);
			await this.render();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not remove section.");
		}
	}

	private async renameEntry(entry: BookEntry): Promise<void> {
		if (!this.book) {
			return;
		}

		const nextTitle = await promptForTitle(this.plugin.app, {
			heading: "Rename chapter",
			label: "Chapter title",
			value: entry.title,
			cta: "Rename",
		});
		if (!nextTitle.trim()) {
			return;
		}

		try {
			this.book = await this.plugin.bookStore.renameEntry(this.book, entry.id, nextTitle);
			await this.render();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not rename chapter.");
		}
	}

	private async removeEntry(entry: BookEntry): Promise<void> {
		if (!this.book) {
			return;
		}

		const action = await confirmRemoveSection(this.plugin.app, entry.title);
		if (action === "cancel") {
			return;
		}

		try {
			this.book = await this.plugin.bookStore.removeEntryFromSpine(this.book, entry.id, {
				trashFile: action === "trash-file",
			});
			await this.render();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not remove chapter.");
		}
	}
}

interface TitlePromptOptions {
	heading: string;
	label: string;
	value: string;
	cta: string;
}

function promptForTitle(app: App, options: TitlePromptOptions): Promise<string> {
	return new Promise((resolve) => {
		new TitlePromptModal(app, options, resolve).open();
	});
}

type RemoveSectionAction = "cancel" | "keep-file" | "trash-file";

function confirmRemoveSection(app: App, sectionTitle: string): Promise<RemoveSectionAction> {
	return new Promise((resolve) => {
		new RemoveSectionModal(app, sectionTitle, resolve).open();
	});
}

function confirmRemovePart(app: App, part: BookPart): Promise<boolean> {
	return new Promise((resolve) => {
		new RemovePartModal(app, part, resolve).open();
	});
}

class TitlePromptModal extends Modal {
	private input: TextComponent | null = null;
	private didSubmit = false;
	private readonly options: TitlePromptOptions;
	private readonly onResolve: (title: string) => void;

	constructor(app: App, options: TitlePromptOptions, onResolve: (title: string) => void) {
		super(app);
		this.options = options;
		this.onResolve = onResolve;
	}

	onOpen(): void {
		this.titleEl.setText(this.options.heading);
		this.contentEl.empty();

		new Setting(this.contentEl)
			.setName(this.options.label)
			.addText((component) => {
				this.input = component;
				component.setValue(this.options.value);
				component.inputEl.addEventListener("keydown", (evt) => {
					if (evt.key === "Enter") {
						evt.preventDefault();
						this.submit();
					}
				});
			});

		new Setting(this.contentEl)
			.addButton((button) => {
				button
					.setButtonText(this.options.cta)
					.setCta()
					.onClick(() => this.submit());
			});

		this.input?.inputEl.focus();
		this.input?.inputEl.select();
	}

	private submit(): void {
		this.didSubmit = true;
		this.onResolve(this.input?.getValue() ?? "");
		this.close();
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
		this.titleEl.setText("Remove chapter");
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

class RemovePartModal extends Modal {
	private didChoose = false;
	private readonly part: BookPart;
	private readonly onResolve: (confirmed: boolean) => void;

	constructor(app: App, part: BookPart, onResolve: (confirmed: boolean) => void) {
		super(app);
		this.part = part;
		this.onResolve = onResolve;
	}

	onOpen(): void {
		this.titleEl.setText("Remove section");
		this.contentEl.empty();
		const count = this.part.children.length;
		this.contentEl.createEl("p", {
			text: count
				? `Remove the section "${this.part.title}". Its ${count} chapter${count === 1 ? "" : "s"} stay in the book and move up to the top level.`
				: `Remove the empty section "${this.part.title}".`,
		});

		new Setting(this.contentEl)
			.addButton((button) => {
				button
					.setButtonText("Cancel")
					.onClick(() => {
						this.didChoose = true;
						this.onResolve(false);
						this.close();
					});
			})
			.addButton((button) => {
				button
					.setButtonText("Remove section")
					.setWarning()
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
