import {Component, MarkdownView, TFile, type App} from "obsidian";
import {BOOKS_FOLDER} from "./constants";
import type BooksPlugin from "./main";
import {isBooksPath} from "./utils/paths";

const MANUSCRIPT_CLASS = "obsidian-books-manuscript-file";

export class ManuscriptStyler extends Component {
	private readonly plugin: BooksPlugin;
	private readonly app: App;

	constructor(plugin: BooksPlugin) {
		super();
		this.plugin = plugin;
		this.app = plugin.app;
	}

	onload(): void {
		const sync = () => this.syncLeafClasses();
		this.registerEvent(this.app.workspace.on("file-open", sync));
		this.registerEvent(this.app.workspace.on("layout-change", sync));
		this.registerEvent(this.app.vault.on("rename", sync));
		this.app.workspace.onLayoutReady(sync);
		this.registerDomEvent(activeDocument, "click", (evt) => this.handleBreadcrumbClick(evt), {capture: true});
	}

	onunload(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView) {
				leaf.view.containerEl.removeClass(MANUSCRIPT_CLASS);
			}
		}
	}

	private syncLeafClasses(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (!(leaf.view instanceof MarkdownView)) {
				continue;
			}

			const file = leaf.view.file;
			const isManuscript = Boolean(file && isBooksPath(file.path));
			leaf.view.containerEl.toggleClass(MANUSCRIPT_CLASS, isManuscript);
		}
	}

	private handleBreadcrumbClick(evt: MouseEvent): void {
		const target = evt.target;
		if (!isElementLike(target)) {
			return;
		}

		const crumb = target.closest(".view-header-breadcrumb");
		if (!isElementLike(crumb)) {
			return;
		}

		const view = this.findOwningManuscriptView(crumb);
		const file = view?.file;
		if (!file || !isBooksPath(file.path)) {
			return;
		}

		const header = crumb.closest(".view-header") ?? view.containerEl;
		const crumbs = Array.from(header.querySelectorAll(".view-header-breadcrumb"));
		const index = crumbs.indexOf(crumb);

		evt.preventDefault();
		evt.stopImmediatePropagation();
		void this.navigateBreadcrumb(file, index, crumbs.length);
	}

	private findOwningManuscriptView(el: Element): MarkdownView | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView && leaf.view.containerEl.contains(el)) {
				return leaf.view;
			}
		}

		return null;
	}

	private async navigateBreadcrumb(file: TFile, index: number, crumbCount: number): Promise<void> {
		const folderParts = file.path.split("/").slice(0, -1);
		const isFileCrumb = crumbCount > folderParts.length && index >= folderParts.length;
		const crumbPath = isFileCrumb ? file.path : folderParts.slice(0, index + 1).join("/");

		if (crumbPath === BOOKS_FOLDER) {
			await this.plugin.openBooksLibrary();
			return;
		}

		const book = await this.plugin.bookStore.getBookForPath(file.path);
		if (book) {
			await this.plugin.openBookSpine(book.manifest.id);
		}
	}
}

function isElementLike(value: unknown): value is Element {
	return Boolean(value && typeof value === "object" && "closest" in value);
}
