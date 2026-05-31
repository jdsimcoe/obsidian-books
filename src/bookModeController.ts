import {Component, type WorkspaceLeaf} from "obsidian";
import {BOOK_SPINE_VIEW_TYPE, BOOKS_LIBRARY_VIEW_TYPE, BOOKS_SCRATCHPAD_VIEW_TYPE} from "./constants";
import type BooksPlugin from "./main";
import {isBooksPath} from "./utils/paths";

const FILE_EXPLORER_VIEW_TYPE = "file-explorer";

type Mode = "book" | "file";

// Keeps the sidebars in step with the active tab: book notes / the book spine
// put you in "Books mode" (Books library tab on the left, the book's scratchpad
// on the right), normal notes put you in "Files mode" (file explorer tab). Only
// fires on mode transitions and never forces a collapsed sidebar open or steals
// editor focus.
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

			// Switch the sidebars, but only when the mode actually changes.
			if (resolved.mode !== this.currentMode) {
				this.currentMode = resolved.mode;
				const {workspace} = this.plugin.app;
				if (resolved.mode === "book") {
					this.activateSidebar(BOOKS_LIBRARY_VIEW_TYPE, workspace.leftSplit);
					// Bring the book's scratchpad forward in the right sidebar too.
					this.activateSidebar(BOOKS_SCRATCHPAD_VIEW_TYPE, workspace.rightSplit);
				} else {
					this.activateSidebar(FILE_EXPLORER_VIEW_TYPE, workspace.leftSplit);
					// Leaving a book: hand the right sidebar back to its first tab.
					this.activateFirstRightTab();
				}
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

	// Switch a sidebar's active tab without stealing focus or forcing a
	// collapsed sidebar open.
	private activateSidebar(viewType: string, split: {collapsed: boolean; collapse(): void}): void {
		const sidebarLeaf = this.plugin.app.workspace.getLeavesOfType(viewType)[0];
		if (!sidebarLeaf) {
			return;
		}
		const wasCollapsed = split.collapsed;
		this.plugin.app.workspace.setActiveLeaf(sidebarLeaf, {focus: false});
		if (wasCollapsed && !split.collapsed) {
			split.collapse();
		}
	}

	// Bring the right sidebar's leftmost tab forward (the default view shown
	// before the scratchpad was surfaced). Same gentle rules: no focus steal,
	// no forcing a collapsed sidebar open.
	private activateFirstRightTab(): void {
		const workspace = this.plugin.app.workspace;
		const scratchpad = workspace.getLeavesOfType(BOOKS_SCRATCHPAD_VIEW_TYPE)[0];
		const group = (scratchpad as unknown as {parent?: {children?: WorkspaceLeaf[]}} | undefined)?.parent;
		const firstLeaf = group?.children?.[0];
		if (!firstLeaf || firstLeaf === scratchpad) {
			return;
		}
		const rightSplit = workspace.rightSplit;
		const wasCollapsed = rightSplit.collapsed;
		workspace.setActiveLeaf(firstLeaf, {focus: false});
		if (wasCollapsed && !rightSplit.collapsed) {
			rightSplit.collapse();
		}
	}
}
