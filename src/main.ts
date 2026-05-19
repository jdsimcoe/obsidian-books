import {Notice, Plugin, type WorkspaceLeaf} from "obsidian";
import {BookStore} from "./bookStore";
import {BOOK_TOC_VIEW_TYPE, BOOKS_LIBRARY_VIEW_TYPE, BOOKS_SIDEBAR_VIEW_TYPE} from "./constants";
import {ManuscriptStyler} from "./manuscriptStyler";
import {BookModal} from "./modals/bookModal";
import {SectionModal} from "./modals/sectionModal";
import {NoteSearchIndex} from "./search/noteSearchIndex";
import type {BookRecord} from "./types";
import {BookTocView} from "./views/bookTocView";
import {BooksLibraryView} from "./views/booksLibraryView";
import {BooksSidebarView} from "./views/booksSidebarView";

export default class BooksPlugin extends Plugin {
	bookStore: BookStore;
	noteSearchIndex: NoteSearchIndex;

	onload(): void {
		this.bookStore = new BookStore(this.app);
		this.noteSearchIndex = new NoteSearchIndex(this.app);
		this.addChild(this.bookStore);
		this.addChild(this.noteSearchIndex);
		this.addChild(new ManuscriptStyler(this.app, this.bookStore));

		this.registerView(BOOKS_LIBRARY_VIEW_TYPE, (leaf) => new BooksLibraryView(leaf, this));
		this.registerView(BOOK_TOC_VIEW_TYPE, (leaf) => new BookTocView(leaf, this));
		this.registerView(BOOKS_SIDEBAR_VIEW_TYPE, (leaf) => new BooksSidebarView(leaf, this));

		this.addRibbonIcon("book-open", "Books", () => {
			void this.openBooksLibrary();
		});

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
		});
	}

	async openBooksLibrary(): Promise<void> {
		await this.app.workspace.ensureSideLeaf(BOOKS_LIBRARY_VIEW_TYPE, "left", {
			active: true,
			reveal: true,
		});
	}

	async openBookToc(bookId: string): Promise<void> {
		const leaf = this.getAuthoringLeaf();
		await leaf.setViewState({
			type: BOOK_TOC_VIEW_TYPE,
			active: true,
			state: {bookId},
		});
		void this.app.workspace.revealLeaf(leaf);
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
		new BookModal(this.app, (input) => {
			void (async () => {
				try {
					const book = await this.bookStore.createBook(input);
					await this.openBookToc(book.manifest.id);
					new Notice(`Created "${book.manifest.title}".`);
				} catch (error) {
					new Notice(error instanceof Error ? error.message : "Could not create book.");
				}
			})();
		}).open();
	}

	showCreateSectionModal(book: BookRecord | null): void {
		if (!book) {
			new Notice("Open a book before creating a section.");
			return;
		}

		new SectionModal(this.app, (input) => {
			void (async () => {
				try {
					const result = await this.bookStore.createSection({
						book,
						type: input.type,
						title: input.title,
					});
					await this.bookStore.openSection(result.book, result.section, {newTab: true});
					new Notice(`Created "${result.section.title}".`);
				} catch (error) {
					new Notice(error instanceof Error ? error.message : "Could not create section.");
				}
			})();
		}).open();
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

		const activeToc = this.app.workspace.getActiveViewOfType(BookTocView);
		if (activeToc) {
			const state = activeToc.getState();
			if (state.bookId) {
				return this.bookStore.getBook(state.bookId);
			}
		}

		const tocLeaf = this.app.workspace.getLeavesOfType(BOOK_TOC_VIEW_TYPE)[0] as WorkspaceLeaf | undefined;
		if (tocLeaf?.view instanceof BookTocView) {
			const state = tocLeaf.view.getState();
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
