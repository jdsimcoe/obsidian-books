import {Notice, Plugin, type TFile, type WorkspaceLeaf} from "obsidian";
import {BookModeController} from "./bookModeController";
import {BookStore} from "./bookStore";
import {BOOK_SPINE_VIEW_TYPE, BOOKS_LIBRARY_VIEW_TYPE, BOOKS_SCRATCHPAD_VIEW_TYPE, BOOKS_SIDEBAR_VIEW_TYPE} from "./constants";
import {createManuscriptEditorExtension} from "./manuscriptEditorExtension";
import {decorateManuscriptReadingView} from "./manuscriptReadingDecorator";
import {ManuscriptStyler} from "./manuscriptStyler";
import {BookModal} from "./modals/bookModal";
import {BookPickerModal} from "./modals/bookPickerModal";
import {SectionModal} from "./modals/sectionModal";
import {NoteSearchIndex} from "./search/noteSearchIndex";
import type {BookRecord, BookSectionType} from "./types";
import {BookSpineView, type BookSpineViewState} from "./views/bookSpineView";
import {BooksLibraryView} from "./views/booksLibraryView";
import {BooksSidebarView} from "./views/booksSidebarView";
import {ScratchpadView} from "./views/scratchpadView";

export default class BooksPlugin extends Plugin {
	bookStore: BookStore;
	noteSearchIndex: NoteSearchIndex;
	private recentBookIds: string[] = [];

	onload(): void {
		this.bookStore = new BookStore(this.app);
		this.noteSearchIndex = new NoteSearchIndex(this.app);
		this.addChild(this.bookStore);
		this.addChild(this.noteSearchIndex);
		this.addChild(new ManuscriptStyler(this));
		this.addChild(new BookModeController(this));

		this.registerEditorExtension(createManuscriptEditorExtension(this.app));
		this.registerMarkdownPostProcessor((el, ctx) => decorateManuscriptReadingView(el, ctx));

		this.registerView(BOOKS_LIBRARY_VIEW_TYPE, (leaf) => new BooksLibraryView(leaf, this));
		this.registerView(BOOK_SPINE_VIEW_TYPE, (leaf) => new BookSpineView(leaf, this));
		this.registerView(BOOKS_SIDEBAR_VIEW_TYPE, (leaf) => new BooksSidebarView(leaf, this));
		this.registerView(BOOKS_SCRATCHPAD_VIEW_TYPE, (leaf) => new ScratchpadView(leaf, this));

		this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => {
			const file = info.file;
			const selection = editor.getSelection();
			if (!file || !selection.trim()) {
				return;
			}
			menu.addItem((item) => {
				item
					.setTitle("Save to scratchpad")
					.setIcon("signature")
					.onClick(() => void this.saveSelectionToScratchpad(file, selection));
			});
		}));

		this.addCommand({
			id: "open-books-library",
			name: "Open library",
			callback: () => {
				void this.openBooksLibrary();
			},
		});

		this.addCommand({
			id: "create-book",
			name: "Create book",
			callback: () => this.showCreateBookModal(),
		});

		this.addCommand({
			id: "create-chapter",
			name: "Create chapter",
			callback: () => {
				void this.showCreateChapterForCurrentBook();
			},
		});

		this.addCommand({
			id: "open-books-sidebar",
			name: "Open research sidebar",
			callback: () => {
				void this.openBooksSidebar();
			},
		});

		this.app.workspace.onLayoutReady(() => {
			void this.app.workspace.ensureSideLeaf(BOOKS_LIBRARY_VIEW_TYPE, "left", {
				active: false,
				reveal: false,
			});
			void this.app.workspace.ensureSideLeaf(BOOKS_SCRATCHPAD_VIEW_TYPE, "right", {
				active: false,
				reveal: false,
			});
		});
	}

	// Reveal and focus the scratchpad for a book (spine entry point).
	async openScratchpad(bookId: string, focus = true): Promise<void> {
		const leaf = await this.app.workspace.ensureSideLeaf(BOOKS_SCRATCHPAD_VIEW_TYPE, "right", {
			active: focus,
			reveal: true,
		});
		if (leaf.view instanceof ScratchpadView) {
			await leaf.view.setBook(bookId);
		}
	}

	// Record that a book was just active, for most-recently-used ordering.
	markBookActive(bookId: string): void {
		this.recentBookIds = [bookId, ...this.recentBookIds.filter((id) => id !== bookId)];
	}

	private recentBooks(books: BookRecord[]): BookRecord[] {
		const rank = new Map(this.recentBookIds.map((id, index) => [id, index] as const));
		return [...books].sort((a, b) => {
			const ra = rank.get(a.manifest.id) ?? Number.MAX_SAFE_INTEGER;
			const rb = rank.get(b.manifest.id) ?? Number.MAX_SAFE_INTEGER;
			return ra !== rb ? ra - rb : a.manifest.title.localeCompare(b.manifest.title);
		});
	}

	// Save a selection to a scratchpad: directly for a book chapter, or via a
	// book picker (most-recent first) from any other note.
	private async saveSelectionToScratchpad(file: TFile, selection: string): Promise<void> {
		try {
			const ownBook = await this.bookStore.getBookForPath(file.path);
			if (ownBook) {
				await this.bookStore.addSnippet(ownBook, selection, file.name);
				new Notice(`Saved to ${ownBook.manifest.title} scratchpad.`);
				return;
			}

			const books = this.recentBooks(await this.bookStore.listBooks());
			if (!books.length) {
				new Notice("Create a book first to save to its scratchpad.");
				return;
			}
			new BookPickerModal(this.app, selection, books, async (book) => {
				await this.bookStore.addSnippet(book, selection, file.name);
				new Notice(`Saved to ${book.manifest.title} scratchpad.`);
			}).open();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not save snippet.");
		}
	}

	async openBooksLibrary(): Promise<void> {
		await this.app.workspace.ensureSideLeaf(BOOKS_LIBRARY_VIEW_TYPE, "left", {
			active: true,
			reveal: true,
		});
	}

	async openBookSpine(bookId: string): Promise<void> {
		// Match on the leaf's serialized state, not its view instance: background
		// tabs are deferred (Obsidian 1.7+) so `leaf.view` may be a placeholder
		// rather than a BookSpineView until the tab is activated.
		const existing = this.app.workspace
			.getLeavesOfType(BOOK_SPINE_VIEW_TYPE)
			.find((leaf) => (leaf.getViewState().state as BookSpineViewState | undefined)?.bookId === bookId);
		if (existing) {
			// setActiveLeaf brings the tab forward and loads it if deferred.
			// Avoid revealLeaf here: on an already-open tab it triggers Obsidian's
			// yellow "flash to locate" highlight.
			this.app.workspace.setActiveLeaf(existing, {focus: true});
			return;
		}

		const leaf = this.getAuthoringLeaf();
		await leaf.setViewState({
			type: BOOK_SPINE_VIEW_TYPE,
			active: true,
			state: {bookId},
		});
		void this.app.workspace.revealLeaf(leaf);
	}

	// Ensure the book's spine exists as a background tab without stealing
	// focus. Returns true if a new tab was created. Used in "Books mode" so the
	// summary is available beside the chapter you're in.
	async ensureBookSpineTab(bookId: string): Promise<boolean> {
		const existing = this.app.workspace
			.getLeavesOfType(BOOK_SPINE_VIEW_TYPE)
			.find((leaf) => (leaf.getViewState().state as BookSpineViewState | undefined)?.bookId === bookId);
		if (existing) {
			return false;
		}

		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({
			type: BOOK_SPINE_VIEW_TYPE,
			active: false,
			state: {bookId},
		});
		return true;
	}

	async openBooksSidebar(): Promise<void> {
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice("Could not open the books sidebar.");
			return;
		}

		await leaf.setViewState({type: BOOKS_SIDEBAR_VIEW_TYPE, active: true});
		void this.app.workspace.revealLeaf(leaf);
	}

	showCreateBookModal(): void {
		void (async () => {
			const genres = await this.bookStore.listGenres();
			new BookModal(this.app, genres, (input) => {
				void (async () => {
					try {
						const book = await this.bookStore.createBook(input);
						await this.openBookSpine(book.manifest.id);
						new Notice(`Created "${book.manifest.title}".`);
					} catch (error) {
						new Notice(error instanceof Error ? error.message : "Could not create book.");
					}
				})();
			}).open();
		})();
	}

	showCreateSectionModal(book: BookRecord | null, initialType: BookSectionType = "chapter", partId?: string): void {
		if (!book) {
			new Notice("Open a book before creating a chapter.");
			return;
		}

		new SectionModal(this.app, (input) => {
			void (async () => {
				try {
					const result = await this.bookStore.createEntry({
						book,
						type: input.type,
						title: input.title,
						partId,
					});
					await this.bookStore.openEntry(result.book, result.entry, {newTab: true});
					new Notice(`Created "${result.entry.title}".`);
				} catch (error) {
					new Notice(error instanceof Error ? error.message : "Could not create chapter.");
				}
			})();
		}, initialType).open();
	}

	private async showCreateChapterForCurrentBook(): Promise<void> {
		const book = await this.getCurrentBook();
		this.showCreateSectionModal(book);
	}

	private async getCurrentBook(): Promise<BookRecord | null> {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			const book = await this.bookStore.getBookForPath(activeFile.path);
			if (book) {
				return book;
			}
		}

		const activeSpine = this.app.workspace.getActiveViewOfType(BookSpineView);
		if (activeSpine) {
			const state = activeSpine.getState();
			if (state.bookId) {
				return this.bookStore.getBook(state.bookId);
			}
		}

		const spineLeaf = this.app.workspace.getLeavesOfType(BOOK_SPINE_VIEW_TYPE)[0] as WorkspaceLeaf | undefined;
		if (spineLeaf?.view instanceof BookSpineView) {
			const state = spineLeaf.view.getState();
			if (state.bookId) {
				return this.bookStore.getBook(state.bookId);
			}
		}

		const books = await this.bookStore.listBooks();
		return books.length === 1 ? books[0] ?? null : null;
	}

	getAuthoringLeaf(): WorkspaceLeaf {
		return this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit)
			?? this.app.workspace.getLeaf("tab");
	}
}
