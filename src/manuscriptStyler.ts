import {Component, MarkdownView, type App} from "obsidian";
import {BookStore} from "./bookStore";
import {isBooksPath} from "./utils/paths";

const MANUSCRIPT_CLASS = "obsidian-books-manuscript-file";
const READABLE_TITLE_CLASS = "obsidian-books-readable-inline-title";

interface ReadableManuscriptChrome {
	bookTitle: string;
	fileTitle: string;
}

export class ManuscriptStyler extends Component {
	private readonly app: App;
	private readonly bookStore: BookStore;
	private syncToken = 0;

	constructor(app: App, bookStore: BookStore) {
		super();
		this.app = app;
		this.bookStore = bookStore;
	}

	onload(): void {
		const sync = () => {
			void this.syncLeafClasses();
		};
		this.registerEvent(this.app.workspace.on("file-open", sync));
		this.registerEvent(this.app.workspace.on("layout-change", sync));
		this.registerEvent(this.app.metadataCache.on("changed", sync));
		this.registerEvent(this.app.vault.on("modify", sync));
		this.registerEvent(this.app.vault.on("rename", sync));
		this.app.workspace.onLayoutReady(sync);
	}

	onunload(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView) {
				leaf.view.containerEl.removeClass(MANUSCRIPT_CLASS);
				this.clearReadableChrome(leaf.view);
			}
		}
	}

	private async syncLeafClasses(): Promise<void> {
		const syncToken = this.syncToken + 1;
		this.syncToken = syncToken;
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (!(leaf.view instanceof MarkdownView)) {
				continue;
			}

			const view = leaf.view;
			const file = leaf.view.file;
			if (!file || !isBooksPath(file.path)) {
				view.containerEl.removeClass(MANUSCRIPT_CLASS);
				this.clearReadableChrome(view);
				continue;
			}

			const chrome = await this.getReadableChrome(file.path);
			if (syncToken !== this.syncToken) {
				return;
			}

			view.containerEl.addClass(MANUSCRIPT_CLASS);
			this.applyReadableChrome(view, chrome);
			window.requestAnimationFrame(() => this.applyReadableChrome(view, chrome));
			window.setTimeout(() => this.applyReadableChrome(view, chrome), 100);
		}
	}

	private async getReadableChrome(path: string): Promise<ReadableManuscriptChrome> {
		const book = await this.bookStore.getBookForPath(path);
		const file = this.app.vault.getFileByPath(path);
		const frontmatter = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : null;
		const fallbackTitle = file?.basename ?? path.split("/").pop()?.replace(/\.md$/u, "") ?? "Untitled";
		if (!book) {
			return {
				bookTitle: String(frontmatter?.bookTitle ?? "Books"),
				fileTitle: String(frontmatter?.title ?? frontmatter?.sectionTitle ?? fallbackTitle),
			};
		}

		if (path.endsWith(`/${book.manifest.overviewFile}`)) {
			return {
				bookTitle: book.manifest.title,
				fileTitle: book.manifest.title,
			};
		}

		const relativePath = path.slice(book.folderPath.length + 1);
		const section = book.manifest.sections.find((candidate) => candidate.file === relativePath);
		return {
			bookTitle: book.manifest.title,
			fileTitle: section?.title
				?? String(frontmatter?.title ?? frontmatter?.sectionTitle ?? fallbackTitle),
		};
	}

	private applyReadableChrome(view: MarkdownView, chrome: ReadableManuscriptChrome): void {
		const inlineTitleEl = view.containerEl.querySelector(".inline-title");
		if (inlineTitleEl instanceof HTMLElement) {
			inlineTitleEl.addClass(READABLE_TITLE_CLASS);
			inlineTitleEl.setAttr("data-obsidian-books-title", chrome.fileTitle);
			inlineTitleEl.setAttr("aria-label", chrome.fileTitle);
		}

		const breadcrumbs = Array.from(view.containerEl.querySelectorAll(".view-header-breadcrumb"))
			.filter((breadcrumb): breadcrumb is HTMLElement => breadcrumb instanceof HTMLElement);
		const labels = breadcrumbs.length > 2
			? ["Books", chrome.bookTitle, chrome.fileTitle]
			: [chrome.bookTitle, chrome.fileTitle];
		breadcrumbs.forEach((breadcrumb, index) => {
			const label = labels[index];
			if (label) {
				breadcrumb.setText(label);
			}
		});
	}

	private clearReadableChrome(view: MarkdownView): void {
		const inlineTitleEl = view.containerEl.querySelector(`.${READABLE_TITLE_CLASS}`);
		if (inlineTitleEl instanceof HTMLElement) {
			inlineTitleEl.removeClass(READABLE_TITLE_CLASS);
			inlineTitleEl.removeAttribute("data-obsidian-books-title");
			inlineTitleEl.removeAttribute("aria-label");
		}
	}
}
