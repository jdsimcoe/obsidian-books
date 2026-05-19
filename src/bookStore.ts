import {Component, normalizePath, TFile, TFolder, type App} from "obsidian";
import {BOOK_FILE_NAME, BOOK_SCHEMA_VERSION, BOOKS_FOLDER} from "./constants";
import type {
	BookManifest,
	BookRecord,
	BookSection,
	BookSectionType,
	CreateBookInput,
	CreateSectionInput,
} from "./types";
import {serializeFrontmatter} from "./utils/frontmatter";
import {createId, filePrefixFromSlug, nowIso, slugify} from "./utils/ids";
import {ensureNestedFolder, uniquePath} from "./utils/paths";

export class BookStore extends Component {
	private readonly app: App;
	private listeners = new Set<() => void>();

	constructor(app: App) {
		super();
		this.app = app;
	}

	onload(): void {
		const notify = () => this.notifyChanged();
		this.registerEvent(this.app.vault.on("create", notify));
		this.registerEvent(this.app.vault.on("modify", notify));
		this.registerEvent(this.app.vault.on("rename", notify));
		this.registerEvent(this.app.vault.on("delete", notify));
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async listBooks(): Promise<BookRecord[]> {
		const booksFolder = this.app.vault.getAbstractFileByPath(BOOKS_FOLDER);
		if (!(booksFolder instanceof TFolder)) {
			return [];
		}

		const records: BookRecord[] = [];
		for (const child of booksFolder.children) {
			if (!(child instanceof TFolder)) {
				continue;
			}

			const manifestPath = normalizePath(`${child.path}/${BOOK_FILE_NAME}`);
			if (!await this.app.vault.adapter.exists(manifestPath)) {
				continue;
			}

			try {
				const manifest = await this.readManifest(manifestPath);
				records.push({
					folderPath: child.path,
					manifestPath,
					slug: child.name,
					manifest,
				});
			} catch (error) {
				console.error(`Books: could not read ${manifestPath}`, error);
			}
		}

		return records.sort((left, right) => {
			return left.manifest.title.localeCompare(right.manifest.title);
		});
	}

	async getBook(bookId: string): Promise<BookRecord | null> {
		const books = await this.listBooks();
		return books.find((book) => book.manifest.id === bookId) ?? null;
	}

	async getBookForPath(path: string): Promise<BookRecord | null> {
		if (!path.startsWith(`${BOOKS_FOLDER}/`)) {
			return null;
		}

		const [, slug] = path.split("/");
		if (!slug) {
			return null;
		}

		const manifestPath = normalizePath(`${BOOKS_FOLDER}/${slug}/${BOOK_FILE_NAME}`);
		if (!await this.app.vault.adapter.exists(manifestPath)) {
			return null;
		}

		try {
			return {
				folderPath: normalizePath(`${BOOKS_FOLDER}/${slug}`),
				manifestPath,
				slug,
				manifest: await this.readManifest(manifestPath),
			};
		} catch (error) {
			console.error(`Books: could not read ${manifestPath}`, error);
			return null;
		}
	}

	async createBook(input: CreateBookInput): Promise<BookRecord> {
		const title = input.title.trim();
		if (!title) {
			throw new Error("Book title is required.");
		}

		await ensureNestedFolder(this.app, BOOKS_FOLDER);
		const slug = await this.uniqueBookSlug(slugify(title, "book"));
		const folderPath = normalizePath(`${BOOKS_FOLDER}/${slug}`);
		await ensureNestedFolder(this.app, folderPath);

		const timestamp = nowIso();
		const overviewFile = `${slug}.md`;
		const manifest: BookManifest = {
			schemaVersion: BOOK_SCHEMA_VERSION,
			id: createId("book"),
			title,
			genre: input.genre.trim(),
			description: input.description.trim(),
			status: input.status.trim() || "Draft",
			overviewFile,
			sections: [],
			createdAt: timestamp,
			updatedAt: timestamp,
		};

		const overviewPath = normalizePath(`${folderPath}/${overviewFile}`);
		await this.app.vault.create(overviewPath, this.serializeOverview(manifest));
		const manifestPath = normalizePath(`${folderPath}/${BOOK_FILE_NAME}`);
		await this.writeManifest(manifestPath, manifest);
		this.notifyChanged();
		return {folderPath, manifestPath, slug, manifest};
	}

	async createSection(input: CreateSectionInput): Promise<{book: BookRecord; section: BookSection; file: TFile}> {
		const title = input.title.trim();
		if (!title) {
			throw new Error("Section title is required.");
		}

		const book = await this.getBook(input.book.manifest.id);
		if (!book) {
			throw new Error("Book not found.");
		}

		const timestamp = nowIso();
		const section: BookSection = {
			id: createId("section"),
			type: input.type,
			title,
			file: await this.uniqueSectionFile(book, input.type, title),
			createdAt: timestamp,
			updatedAt: timestamp,
		};

		const nextManifest: BookManifest = {
			...book.manifest,
			sections: [...book.manifest.sections, section],
			updatedAt: timestamp,
		};
		const filePath = normalizePath(`${book.folderPath}/${section.file}`);
		const sectionOrder = nextManifest.sections.length;
		const markdown = this.serializeSection(nextManifest, section, sectionOrder);
		const created = await this.app.vault.create(filePath, markdown);
		await this.writeManifest(book.manifestPath, nextManifest);
		this.notifyChanged();
		return {
			book: {...book, manifest: nextManifest},
			section,
			file: created,
		};
	}

	async reorderSection(book: BookRecord, fromIndex: number, toIndex: number): Promise<BookRecord> {
		const current = await this.getBook(book.manifest.id);
		if (!current) {
			throw new Error("Book not found.");
		}

		const sections = current.manifest.sections.slice();
		const [moved] = sections.splice(fromIndex, 1);
		if (!moved) {
			return current;
		}

		sections.splice(toIndex, 0, moved);
		const updated = await this.updateBookManifest(current, {sections});
		await this.refreshSectionFrontmatter(updated);
		return updated;
	}

	async renameSection(book: BookRecord, sectionId: string, title: string): Promise<BookRecord> {
		const trimmedTitle = title.trim();
		if (!trimmedTitle) {
			throw new Error("Section title is required.");
		}

		const current = await this.getBook(book.manifest.id);
		if (!current) {
			throw new Error("Book not found.");
		}

		const sections = current.manifest.sections.map((section) => {
			if (section.id !== sectionId) {
				return section;
			}

			return {
				...section,
				title: trimmedTitle,
				updatedAt: nowIso(),
			};
		});
		const updated = await this.updateBookManifest(current, {sections});
		await this.refreshSectionFrontmatter(updated);
		return updated;
	}

	async removeSectionFromToc(book: BookRecord, sectionId: string, options?: {trashFile?: boolean}): Promise<BookRecord> {
		const current = await this.getBook(book.manifest.id);
		if (!current) {
			throw new Error("Book not found.");
		}

		const removedSection = current.manifest.sections.find((section) => section.id === sectionId);
		const sections = current.manifest.sections.filter((section) => section.id !== sectionId);
		const updated = await this.updateBookManifest(current, {sections});
		if (options?.trashFile && removedSection) {
			const file = this.app.vault.getAbstractFileByPath(normalizePath(`${current.folderPath}/${removedSection.file}`));
			if (file instanceof TFile) {
				await this.app.fileManager.trashFile(file);
			}
		}
		await this.refreshSectionFrontmatter(updated);
		return updated;
	}

	async openSection(book: BookRecord, section: BookSection, options?: {newTab?: boolean}): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(`${book.folderPath}/${section.file}`));
		if (!(file instanceof TFile)) {
			throw new Error("Section file not found.");
		}

		const leaf = options?.newTab ? this.app.workspace.getLeaf("tab") : this.getAuthoringLeaf();
		await leaf.openFile(file);
		if (options?.newTab) {
			this.app.workspace.setActiveLeaf(leaf, {focus: true});
		}
	}

	async openOverview(book: BookRecord): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(`${book.folderPath}/${book.manifest.overviewFile}`));
		if (!(file instanceof TFile)) {
			throw new Error("Book overview file not found.");
		}

		await this.getAuthoringLeaf().openFile(file);
	}

	private getAuthoringLeaf() {
		return this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit)
			?? this.app.workspace.getLeaf("tab");
	}

	private notifyChanged(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}

	private async uniqueBookSlug(baseSlug: string): Promise<string> {
		for (let index = 1; index < 1000; index += 1) {
			const slug = index === 1 ? baseSlug : `${baseSlug}-${index}`;
			if (!await this.app.vault.adapter.exists(normalizePath(`${BOOKS_FOLDER}/${slug}`))) {
				return slug;
			}
		}

		throw new Error("Could not create a unique book folder.");
	}

	private async uniqueSectionFile(book: BookRecord, type: BookSectionType, title: string): Promise<string> {
		const bookPrefix = filePrefixFromSlug(book.slug);
		const titleSlug = filePrefixFromSlug(slugify(title, type));
		const path = await uniquePath(this.app, `${book.folderPath}/${bookPrefix}_${titleSlug}.md`);
		return path.slice(book.folderPath.length + 1);
	}

	private async updateBookManifest(
		book: BookRecord,
		updates: Partial<Pick<BookManifest, "sections" | "title" | "genre" | "description" | "status">>,
	): Promise<BookRecord> {
		const manifest: BookManifest = {
			...book.manifest,
			...updates,
			updatedAt: nowIso(),
		};
		await this.writeManifest(book.manifestPath, manifest);
		const updated = {...book, manifest};
		this.notifyChanged();
		return updated;
	}

	private async refreshSectionFrontmatter(book: BookRecord): Promise<void> {
		await Promise.all(book.manifest.sections.map(async (section, index) => {
			const file = this.app.vault.getAbstractFileByPath(normalizePath(`${book.folderPath}/${section.file}`));
			if (!(file instanceof TFile)) {
				return;
			}

			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				const data = frontmatter as Record<string, unknown>;
				data.title = section.title;
				data.bookId = book.manifest.id;
				data.bookTitle = book.manifest.title;
				data.sectionId = section.id;
				data.sectionType = section.type;
				data.sectionTitle = section.title;
				data.sectionOrder = index + 1;
				data.genre = book.manifest.genre;
			});
		}));
	}

	private async readManifest(path: string): Promise<BookManifest> {
		const raw = await this.app.vault.adapter.read(path);
		const parsed = JSON.parse(raw) as BookManifest;
		return {
			...parsed,
			sections: Array.isArray(parsed.sections) ? parsed.sections : [],
		};
	}

	private async writeManifest(path: string, manifest: BookManifest): Promise<void> {
		await this.app.vault.adapter.write(path, `${JSON.stringify(manifest, null, "\t")}\n`);
	}

	private serializeOverview(manifest: BookManifest): string {
		return `${serializeFrontmatter({
			title: manifest.title,
			bookId: manifest.id,
			bookTitle: manifest.title,
			genre: manifest.genre,
			status: manifest.status,
		})}${manifest.description ? `${manifest.description}\n` : ""}`;
	}

	private serializeSection(manifest: BookManifest, section: BookSection, sectionOrder: number): string {
		return `${serializeFrontmatter({
			title: section.title,
			bookId: manifest.id,
			bookTitle: manifest.title,
			sectionId: section.id,
			sectionType: section.type,
			sectionTitle: section.title,
			sectionOrder,
			genre: manifest.genre,
		})}`;
	}
}
