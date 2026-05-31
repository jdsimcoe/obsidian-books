import {FuzzySuggestModal, Notice, Platform, Plugin, PluginSettingTab, Setting, type TFile, type WorkspaceLeaf} from "obsidian";
import {BookModeController} from "./bookModeController";
import {BookStore} from "./bookStore";
import {
	BOOK_SPINE_VIEW_TYPE,
	BOOKS_FOLDER,
	BOOKS_LIBRARY_VIEW_TYPE,
	BOOKS_SCRATCHPAD_VIEW_TYPE,
	BOOKS_SIDEBAR_VIEW_TYPE,
	SCRATCHPAD_FOLDER_NAME,
} from "./constants";
import {createManuscriptEditorExtension} from "./manuscriptEditorExtension";
import {decorateManuscriptReadingView} from "./manuscriptReadingDecorator";
import {ManuscriptStyler} from "./manuscriptStyler";
import {BookModal} from "./modals/bookModal";
import {BookPickerModal} from "./modals/bookPickerModal";
import {SectionModal} from "./modals/sectionModal";
import {BookEmbedNormalizer} from "./search/bookEmbedNormalizer";
import {BookQuoteSuggester} from "./search/bookQuoteSuggester";
import {NoteSearchIndex} from "./search/noteSearchIndex";
import type {BookRecord, BookSectionType} from "./types";
import {BookSpineView} from "./views/bookSpineView";
import {BooksLibraryView} from "./views/booksLibraryView";
import {BooksSidebarView} from "./views/booksSidebarView";
import {ScratchpadView} from "./views/scratchpadView";

interface BooksSettings {
	hideBooksFolder: boolean;
	hideScratchFromSearch: boolean;
}

const DEFAULT_SETTINGS: BooksSettings = {
	hideBooksFolder: true,
	hideScratchFromSearch: false,
};

// Obsidian's "Excluded files" stores regexes wrapped in slashes — and Bases honors
// that same filter, so anything excluded here also disappears from the scratchpad's
// card view. The Books pattern therefore SPARES the Scratchpad/ folders (negative
// lookahead) so the card view keeps working; hiding the snippets is opt-in.
const BOOKS_IGNORE_PATTERN = `/^${BOOKS_FOLDER}/(?!.*/${SCRATCHPAD_FOLDER_NAME}/)/`;
const SCRATCH_IGNORE_PATTERN = `/^${BOOKS_FOLDER}/.*/${SCRATCHPAD_FOLDER_NAME}//`;
// Patterns older builds may have written; reconciled out if no longer wanted.
const LEGACY_IGNORE_PATTERNS = [`/^${BOOKS_FOLDER}//`];

export default class BooksPlugin extends Plugin {
	bookStore: BookStore;
	noteSearchIndex: NoteSearchIndex;
	settings: BooksSettings = {...DEFAULT_SETTINGS};
	private recentBookIds: string[] = [];

	async onload(): Promise<void> {
		await this.loadSettings();

		this.bookStore = new BookStore(this.app);
		this.noteSearchIndex = new NoteSearchIndex(this.app);
		this.addChild(this.bookStore);
		this.addChild(this.noteSearchIndex);
		this.addChild(new ManuscriptStyler(this));
		this.addChild(new BookModeController(this));
		this.addChild(new BookEmbedNormalizer(this.app));

		this.addSettingTab(new BooksSettingTab(this));
		this.applyExclusions();

		this.registerEditorExtension(createManuscriptEditorExtension(this.app));
		this.registerEditorSuggest(new BookQuoteSuggester(this));
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
			id: "open-library",
			name: "Open library",
			callback: () => {
				void this.openBooksLibrary();
			},
		});

		this.addCommand({
			id: "open-spine",
			name: "Open book spine",
			callback: () => {
				void this.openBookSpineFromCommand();
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
			id: "open-research-sidebar",
			name: "Open research sidebar",
			callback: () => {
				void this.openBooksSidebar();
			},
		});

		this.app.workspace.onLayoutReady(() => {
			// Backfill older books: snippets.json → notes + a Bases card view.
			void this.bookStore.backfillScratchpads();
			if (Platform.isMobileApp) {
				return;
			}
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

	private async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<BooksSettings> | null;
		this.settings = {...DEFAULT_SETTINGS, ...(stored ?? {})};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// Reconcile the vault's excluded files with our toggles, so book content
	// stays out of search / quick switcher / graph / backlinks. We only touch our
	// own patterns and leave the rest of the list intact. The Bases card view
	// reads notes directly, so it is unaffected. Obsidian compiles the change on
	// the next reload.
	applyExclusions(): void {
		const vault = this.app.vault as unknown as {
			getConfig(key: string): unknown;
			setConfig(key: string, value: unknown): void;
		};
		const raw = vault.getConfig("userIgnoreFilters");
		const current = Array.isArray(raw)
			? raw.filter((value): value is string => typeof value === "string")
			: [];
		// Drop every pattern we manage (current + legacy), then re-add the wanted
		// ones — this also cleans up stale patterns from earlier builds.
		const ours = new Set([BOOKS_IGNORE_PATTERN, SCRATCH_IGNORE_PATTERN, ...LEGACY_IGNORE_PATTERNS]);
		const next = current.filter((value) => !ours.has(value));
		if (this.settings.hideBooksFolder) {
			next.push(BOOKS_IGNORE_PATTERN);
		}
		if (this.settings.hideScratchFromSearch) {
			next.push(SCRATCH_IGNORE_PATTERN);
		}
		if (JSON.stringify(next) === JSON.stringify(current)) {
			return;
		}
		vault.setConfig("userIgnoreFilters", next.length ? next : null);
	}

	// Reveal and focus the scratchpad for a book (spine entry point).
	async openScratchpad(bookId: string, focus = true): Promise<void> {
		const leaf = Platform.isMobileApp
			? this.app.workspace.getLeaf("tab")
			: await this.app.workspace.ensureSideLeaf(BOOKS_SCRATCHPAD_VIEW_TYPE, "right", {
				active: focus,
				reveal: true,
			});
		await leaf.setViewState({type: BOOKS_SCRATCHPAD_VIEW_TYPE, active: focus});
		if (leaf.view instanceof ScratchpadView) {
			await leaf.view.setBook(bookId);
		}
		if (Platform.isMobileApp) {
			void this.app.workspace.revealLeaf(leaf);
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
		if (Platform.isMobileApp) {
			const leaf = this.app.workspace.getLeaf("tab");
			await leaf.setViewState({type: BOOKS_LIBRARY_VIEW_TYPE, active: true});
			void this.app.workspace.revealLeaf(leaf);
			return;
		}

		await this.app.workspace.ensureSideLeaf(BOOKS_LIBRARY_VIEW_TYPE, "left", {active: true, reveal: true});
	}

	async openBookSpine(bookId: string): Promise<void> {
		// Match on the leaf's serialized state, not its view instance: background
		// tabs are deferred (Obsidian 1.7+) so `leaf.view` may be a placeholder
		// rather than a BookSpineView until the tab is activated.
		const existing = this.app.workspace
			.getLeavesOfType(BOOK_SPINE_VIEW_TYPE)
			.find((leaf) => leaf.getViewState().state?.bookId === bookId);
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
			.find((leaf) => leaf.getViewState().state?.bookId === bookId);
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
		if (Platform.isMobileApp) {
			const leaf = this.app.workspace.getLeaf("tab");
			await leaf.setViewState({type: BOOKS_SIDEBAR_VIEW_TYPE, active: true});
			void this.app.workspace.revealLeaf(leaf);
			return;
		}

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

	private async openBookSpineFromCommand(): Promise<void> {
		const current = await this.getCurrentBook();
		if (current) {
			await this.openBookSpine(current.manifest.id);
			return;
		}

		const books = await this.bookStore.listBooks();
		if (!books.length) {
			new Notice("Create a book first.");
			return;
		}

		new BookSpinePickerModal(this.app, books, (book) => {
			void this.openBookSpine(book.manifest.id);
		}).open();
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

		const spineLeaf: WorkspaceLeaf | undefined = this.app.workspace.getLeavesOfType(BOOK_SPINE_VIEW_TYPE)[0];
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

class BookSpinePickerModal extends FuzzySuggestModal<BookRecord> {
	private readonly books: BookRecord[];
	private readonly onChoose: (book: BookRecord) => void;

	constructor(app: BooksPlugin["app"], books: BookRecord[], onChoose: (book: BookRecord) => void) {
		super(app);
		this.books = books;
		this.onChoose = onChoose;
		this.setPlaceholder("Open book spine");
		this.emptyStateText = "No books found.";
	}

	getItems(): BookRecord[] {
		return this.books;
	}

	getItemText(book: BookRecord): string {
		return book.manifest.title;
	}

	onChooseItem(book: BookRecord): void {
		this.onChoose(book);
	}
}

class BooksSettingTab extends PluginSettingTab {
	private readonly plugin: BooksPlugin;

	constructor(plugin: BooksPlugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this.containerEl.empty();

		new Setting(this.containerEl)
			// "Books" is the literal folder name, not a stray capital.
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("Hide Books folder from search")
			.setDesc(
				"Keep the Books folder — chapters and canvases — out of search, the quick switcher, graph, "
				+ "and backlinks. Scratchpad notes are spared so their card view keeps working, and the "
				+ "library and spine are unaffected. Takes effect after a reload.",
			)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.hideBooksFolder);
				toggle.onChange((value) => {
					this.plugin.settings.hideBooksFolder = value;
					this.plugin.applyExclusions();
					void this.plugin.saveSettings();
				});
			});

		new Setting(this.containerEl)
			.setName("Hide scratchpad notes from search")
			.setDesc(
				"Also hide the scratchpad snippet notes. Heads up: Bases honors the same filter, so turning "
				+ "this on empties the scratchpad card view (the sidebar still works). Off by default. "
				+ "Takes effect after a reload.",
			)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.hideScratchFromSearch);
				toggle.onChange((value) => {
					this.plugin.settings.hideScratchFromSearch = value;
					this.plugin.applyExclusions();
					void this.plugin.saveSettings();
				});
			});
	}
}
