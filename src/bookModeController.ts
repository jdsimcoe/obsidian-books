import {Component, type WorkspaceLeaf} from "obsidian";
import {BOOK_SPINE_VIEW_TYPE, BOOKS_LIBRARY_VIEW_TYPE} from "./constants";
import type BooksPlugin from "./main";
import {isBooksPath} from "./utils/paths";

const FILE_EXPLORER_VIEW_TYPE = "file-explorer";

type Mode = "book" | "file";

// Keeps the left sidebar in step with the active tab: book notes / the book spine
// put you in "Books mode" (Books library tab + the book's summary), normal notes
// put you in "Files mode" (file explorer tab). Only fires on mode transitions and
// never forces a collapsed sidebar open or steals editor focus.
export class BookModeController extends Component {
	private readonly plugin: BooksPlugin;
	private currentMode: Mode | null = null;
	private applying = false;

	constructor(plugin: BooksPlugin) {
		super();
		this.plugin = plugin;
	}

	onload(): void {
		this.registerEvent(this.plugin.app.workspace.on("active-leaf-change", (leaf) => {
			void this.handleActiveLeaf(leaf);
		}));
	}

	private async handleActiveLeaf(leaf: WorkspaceLeaf | null): Promise<void> {
		if (this.applying || !leaf) {
			return;
		}

		const resolved = this.resolveContext(leaf);
		if (!resolved) {
			return;
		}

		this.applying = true;
		try {
			let shuffled = false;

			// Ensure the book's spine is open whenever a book chapter is
			// active, re-launching it if it was closed. Done first, while the
			// chapter is still the active leaf, so the tab lands in the main area.
			if (resolved.mode === "book") {
				let bookId = resolved.bookId ?? null;
				if (resolved.bookFilePath) {
					const book = await this.plugin.bookStore.getBookForPath(resolved.bookFilePath);
					if (book) {
						bookId = book.manifest.id;
						if (await this.plugin.ensureBookSpineTab(bookId)) {
							shuffled = true;
						}
					}
				}
				if (bookId) {
					// Track most-recently-used books for the scratchpad picker.
					this.plugin.markBookActive(bookId);
				}
			}

			// Switch the left sidebar, but only when the mode actually changes.
			if (resolved.mode !== this.currentMode) {
				this.currentMode = resolved.mode;
				this.activateSidebar(resolved.mode === "book" ? BOOKS_LIBRARY_VIEW_TYPE : FILE_EXPLORER_VIEW_TYPE);
				shuffled = true;
			}

			// Restore the editor as the active, focused leaf after any shuffle.
			if (shuffled) {
				this.plugin.app.workspace.setActiveLeaf(leaf, {focus: true});
			}
		} finally {
			this.applying = false;
		}
	}

	private resolveContext(leaf: WorkspaceLeaf): {mode: Mode; bookFilePath?: string; bookId?: string} | null {
		const state = leaf.getViewState();
		if (state.type === BOOK_SPINE_VIEW_TYPE) {
			return {mode: "book", bookId: (state.state as {bookId?: string} | undefined)?.bookId};
		}
		const filePath = (state.state as {file?: string} | undefined)?.file;
		if (typeof filePath !== "string") {
			return null;
		}
		return isBooksPath(filePath) ? {mode: "book", bookFilePath: filePath} : {mode: "file"};
	}

	// Switch the left sidebar's active tab without stealing focus or forcing a
	// collapsed sidebar open.
	private activateSidebar(viewType: string): void {
		const sidebarLeaf = this.plugin.app.workspace.getLeavesOfType(viewType)[0];
		if (!sidebarLeaf) {
			return;
		}
		const leftSplit = this.plugin.app.workspace.leftSplit;
		const wasCollapsed = leftSplit.collapsed;
		this.plugin.app.workspace.setActiveLeaf(sidebarLeaf, {focus: false});
		if (wasCollapsed && !leftSplit.collapsed) {
			leftSplit.collapse();
		}
	}
}
