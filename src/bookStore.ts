import {Component, normalizePath, parseYaml, TAbstractFile, TFile, TFolder, type App, type WorkspaceLeaf} from "obsidian";
import {
	BOOK_BASE_FILE_NAME,
	BOOK_FILE_NAME,
	BOOK_SCHEMA_VERSION,
	BOOKS_FOLDER,
	SCRATCH_NOTE_TYPE,
	SCRATCHPAD_FILE_NAME,
	SCRATCHPAD_FOLDER_NAME,
} from "./constants";
import type {
	BookEntry,
	BookManifest,
	BookNode,
	BookPart,
	BookRecord,
	BookSectionType,
	CreateBookInput,
	CreateCanvasInput,
	CreatePartInput,
	CreateSectionInput,
	ScratchSnippet,
	Scratchpad,
} from "./types";
import {serializeFrontmatter} from "./utils/frontmatter";
import {createId, nowIso, sanitizeFileName} from "./utils/ids";
import {ensureNestedFolder, uniquePath} from "./utils/paths";
import {
	cloneNodes,
	findEntry,
	findPart,
	flattenEntries,
	insertEntry,
	isPart,
	removeEntry,
	type InsertTarget,
} from "./utils/tree";

const SECTION_TYPES: BookSectionType[] = ["intro", "chapter", "interlude", "appendix", "backmatter"];
const EMPTY_CANVAS = "{\n\t\"nodes\": [],\n\t\"edges\": []\n}\n";

// A short, file-safe label from a snippet's first line (used as the note name /
// the card title in the Bases view).
function snippetTitle(text: string): string {
	const firstLine = text.trim().split(/\r?\n/u, 1)[0] ?? "";
	const condensed = firstLine.replace(/\s+/gu, " ").trim();
	return condensed.length > 60 ? `${condensed.slice(0, 60).trim()}…` : condensed;
}

export class BookStore extends Component {
	private readonly app: App;
	private listeners = new Set<() => void>();
	private readonly suppressRenamePaths = new Set<string>();

	constructor(app: App) {
		super();
		this.app = app;
	}

	onload(): void {
		const notify = () => this.notifyChanged();
		this.registerEvent(this.app.vault.on("create", notify));
		this.registerEvent(this.app.vault.on("modify", notify));
		this.registerEvent(this.app.vault.on("delete", notify));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
			void this.handleRename(file, oldPath);
		}));
	}

	private async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
		this.notifyChanged();
		if (!(file instanceof TFile)) {
			return;
		}

		if (this.suppressRenamePaths.delete(oldPath)) {
			return;
		}

		const book = await this.getBookForPath(oldPath);
		if (!book || file.path.slice(0, book.folderPath.length + 1) !== `${book.folderPath}/`) {
			return;
		}

		const oldRelative = oldPath.slice(book.folderPath.length + 1);
		const newRelative = file.path.slice(book.folderPath.length + 1);
		if (oldRelative === newRelative) {
			return;
		}

		const match = flattenEntries(book.manifest.nodes).find((entry) => entry.file === oldRelative);
		if (!match) {
			return;
		}

		const nodes = cloneNodes(book.manifest.nodes);
		const location = findEntry(nodes, match.id);
		if (location) {
			location.entry.file = newRelative;
			location.entry.title = file.basename;
			location.entry.updatedAt = nowIso();
		}
		const updated = await this.updateBookManifest(book, {nodes});
		await this.refreshEntryFrontmatter(updated);
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

	async listGenres(): Promise<string[]> {
		const books = await this.listBooks();
		const genres = new Set<string>();
		for (const book of books) {
			const genre = book.manifest.genre.trim();
			if (genre) {
				genres.add(genre);
			}
		}

		return Array.from(genres).sort((left, right) => left.localeCompare(right));
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
		const slug = await this.uniqueBookSlug(sanitizeFileName(title, "Book"));
		const folderPath = normalizePath(`${BOOKS_FOLDER}/${slug}`);
		await ensureNestedFolder(this.app, folderPath);

		const timestamp = nowIso();
		const manifest: BookManifest = {
			schemaVersion: BOOK_SCHEMA_VERSION,
			id: createId("book"),
			title,
			genre: input.genre.trim(),
			description: input.description.trim(),
			status: input.status.trim() || "Draft",
			nodes: [],
			createdAt: timestamp,
			updatedAt: timestamp,
		};

		const manifestPath = normalizePath(`${folderPath}/${BOOK_FILE_NAME}`);
		await this.writeManifest(manifestPath, manifest);
		const record: BookRecord = {folderPath, manifestPath, slug, manifest};
		await this.ensureScratchpadBase(record);
		this.notifyChanged();
		return record;
	}

	async updateBookDetails(book: BookRecord, input: CreateBookInput): Promise<BookRecord> {
		const title = input.title.trim();
		if (!title) {
			throw new Error("Book title is required.");
		}

		const current = await this.getBook(book.manifest.id);
		if (!current) {
			throw new Error("Book not found.");
		}

		const updated = await this.updateBookManifest(current, {
			title,
			genre: input.genre.trim(),
			description: input.description.trim(),
			status: input.status.trim() || "Draft",
		});
		await this.refreshEntryFrontmatter(updated);
		return updated;
	}

	async deleteBook(book: BookRecord): Promise<void> {
		const folder = this.app.vault.getAbstractFileByPath(book.folderPath);
		if (!(folder instanceof TFolder)) {
			throw new Error("Book folder not found.");
		}

		await this.app.fileManager.trashFile(folder);
		this.notifyChanged();
	}

	async createEntry(input: CreateSectionInput): Promise<{book: BookRecord; entry: BookEntry; file: TFile}> {
		const title = input.title.trim();
		if (!title) {
			throw new Error("Chapter title is required.");
		}

		const book = await this.getBook(input.book.manifest.id);
		if (!book) {
			throw new Error("Book not found.");
		}

		const timestamp = nowIso();
		const entry: BookEntry = {
			kind: "entry",
			id: createId("entry"),
			type: input.type,
			title,
			file: await this.uniqueSectionFile(book, title),
			createdAt: timestamp,
			updatedAt: timestamp,
		};

		const nodes = cloneNodes(book.manifest.nodes);
		insertEntry(nodes, entry, {partId: input.partId ?? null});
		const nextManifest: BookManifest = {...book.manifest, nodes, updatedAt: timestamp};

		const filePath = normalizePath(`${book.folderPath}/${entry.file}`);
		const order = flattenEntries(nodes).findIndex((candidate) => candidate.id === entry.id) + 1;
		const markdown = this.serializeEntry(nextManifest, entry, order, this.partTitleForEntry(nodes, entry.id));
		const created = await this.app.vault.create(filePath, markdown);
		await this.writeManifest(book.manifestPath, nextManifest);
		this.notifyChanged();
		return {
			book: {...book, manifest: nextManifest},
			entry,
			file: created,
		};
	}

	async createCanvas(input: CreateCanvasInput): Promise<{book: BookRecord; entry: BookEntry; file: TFile}> {
		const title = input.title.trim() || "Canvas";
		const book = await this.getBook(input.book.manifest.id);
		if (!book) {
			throw new Error("Book not found.");
		}

		const timestamp = nowIso();
		const entry: BookEntry = {
			kind: "entry",
			id: createId("entry"),
			type: "chapter",
			title,
			file: await this.uniqueCanvasFile(book, title),
			format: "canvas",
			createdAt: timestamp,
			updatedAt: timestamp,
		};

		const nodes = cloneNodes(book.manifest.nodes);
		if (input.partId) {
			insertEntry(nodes, entry, {partId: input.partId});
		} else if (input.atTop) {
			nodes.unshift(entry);
		} else {
			insertEntry(nodes, entry, {partId: null});
		}
		const nextManifest: BookManifest = {...book.manifest, nodes, updatedAt: timestamp};

		const filePath = normalizePath(`${book.folderPath}/${entry.file}`);
		const created = await this.app.vault.create(filePath, EMPTY_CANVAS);
		await this.writeManifest(book.manifestPath, nextManifest);
		this.notifyChanged();
		return {
			book: {...book, manifest: nextManifest},
			entry,
			file: created,
		};
	}

	async createPart(input: CreatePartInput): Promise<BookRecord> {
		const title = input.title.trim() || "Untitled section";
		const current = await this.getBook(input.book.manifest.id);
		if (!current) {
			throw new Error("Book not found.");
		}

		const timestamp = nowIso();
		const part: BookPart = {
			kind: "part",
			id: createId("part"),
			title,
			children: [],
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		const nodes = [...cloneNodes(current.manifest.nodes), part];
		return this.updateBookManifest(current, {nodes});
	}

	async renameEntry(book: BookRecord, entryId: string, title: string): Promise<BookRecord> {
		const trimmedTitle = title.trim();
		if (!trimmedTitle) {
			throw new Error("Chapter title is required.");
		}

		const current = await this.getBook(book.manifest.id);
		if (!current) {
			throw new Error("Book not found.");
		}

		const location = findEntry(current.manifest.nodes, entryId);
		if (!location) {
			return current;
		}

		const newFile = await this.renameEntryFile(current, location.entry, trimmedTitle);
		const nodes = cloneNodes(current.manifest.nodes);
		const target = findEntry(nodes, entryId);
		if (target) {
			target.entry.title = trimmedTitle;
			target.entry.file = newFile;
			target.entry.updatedAt = nowIso();
		}
		const updated = await this.updateBookManifest(current, {nodes});
		await this.refreshEntryFrontmatter(updated);
		return updated;
	}

	async renamePart(book: BookRecord, partId: string, title: string): Promise<BookRecord> {
		const trimmedTitle = title.trim() || "Untitled section";
		const current = await this.getBook(book.manifest.id);
		if (!current) {
			throw new Error("Book not found.");
		}

		const nodes = cloneNodes(current.manifest.nodes);
		const part = findPart(nodes, partId);
		if (!part) {
			return current;
		}

		part.title = trimmedTitle;
		part.updatedAt = nowIso();
		const updated = await this.updateBookManifest(current, {nodes});
		await this.refreshEntryFrontmatter(updated);
		return updated;
	}

	private async renameEntryFile(book: BookRecord, entry: BookEntry, title: string): Promise<string> {
		const oldPath = normalizePath(`${book.folderPath}/${entry.file}`);
		const file = this.app.vault.getAbstractFileByPath(oldPath);
		if (!(file instanceof TFile)) {
			return entry.file;
		}

		const extension = entry.format === "canvas" ? "canvas" : "md";
		const desired = `${sanitizeFileName(title)}.${extension}`;
		if (desired === entry.file) {
			return entry.file;
		}

		const newPath = await uniquePath(this.app, `${book.folderPath}/${desired}`);
		this.suppressRenamePaths.add(oldPath);
		await this.app.fileManager.renameFile(file, newPath);
		return newPath.slice(book.folderPath.length + 1);
	}

	async removeEntryFromSpine(book: BookRecord, entryId: string, options?: {trashFile?: boolean}): Promise<BookRecord> {
		const current = await this.getBook(book.manifest.id);
		if (!current) {
			throw new Error("Book not found.");
		}

		const nodes = cloneNodes(current.manifest.nodes);
		const removed = removeEntry(nodes, entryId);
		const updated = await this.updateBookManifest(current, {nodes});
		if (options?.trashFile && removed) {
			const file = this.app.vault.getAbstractFileByPath(normalizePath(`${current.folderPath}/${removed.file}`));
			if (file instanceof TFile) {
				await this.app.fileManager.trashFile(file);
			}
		}
		await this.refreshEntryFrontmatter(updated);
		return updated;
	}

	async removePart(book: BookRecord, partId: string): Promise<BookRecord> {
		const current = await this.getBook(book.manifest.id);
		if (!current) {
			throw new Error("Book not found.");
		}

		const nodes = cloneNodes(current.manifest.nodes);
		const index = nodes.findIndex((node) => node.kind === "part" && node.id === partId);
		if (index === -1) {
			return current;
		}

		const part = nodes[index] as BookPart;
		nodes.splice(index, 1, ...part.children);
		const updated = await this.updateBookManifest(current, {nodes});
		await this.refreshEntryFrontmatter(updated);
		return updated;
	}

	async moveEntry(book: BookRecord, entryId: string, target: InsertTarget): Promise<BookRecord> {
		const current = await this.getBook(book.manifest.id);
		if (!current) {
			throw new Error("Book not found.");
		}

		const nodes = cloneNodes(current.manifest.nodes);
		const removed = removeEntry(nodes, entryId);
		if (!removed) {
			return current;
		}

		insertEntry(nodes, removed, target);
		const updated = await this.updateBookManifest(current, {nodes});
		await this.refreshEntryFrontmatter(updated);
		return updated;
	}

	async movePart(book: BookRecord, partId: string, beforeNodeId: string | null): Promise<BookRecord> {
		const current = await this.getBook(book.manifest.id);
		if (!current) {
			throw new Error("Book not found.");
		}

		const nodes = cloneNodes(current.manifest.nodes);
		const index = nodes.findIndex((node) => node.kind === "part" && node.id === partId);
		if (index === -1) {
			return current;
		}

		const [part] = nodes.splice(index, 1);
		if (!part) {
			return current;
		}
		let insertAt = nodes.length;
		if (beforeNodeId) {
			const target = nodes.findIndex((node) => node.id === beforeNodeId);
			if (target !== -1) {
				insertAt = target;
			}
		}
		nodes.splice(insertAt, 0, part);
		return this.updateBookManifest(current, {nodes});
	}

	async openEntry(book: BookRecord, entry: BookEntry, options?: {newTab?: boolean}): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(`${book.folderPath}/${entry.file}`));
		if (!(file instanceof TFile)) {
			throw new Error("Chapter file not found.");
		}

		// If the entry is already open in a tab, focus it instead of opening a
		// duplicate. Check every leaf (not just markdown) so canvases match too,
		// and match on serialized state so deferred (background) tabs match.
		const open: WorkspaceLeaf[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			if ((leaf.getViewState().state as {file?: string} | undefined)?.file === file.path) {
				open.push(leaf);
			}
		});
		const [openLeaf] = open;
		if (openLeaf) {
			this.app.workspace.setActiveLeaf(openLeaf, {focus: true});
			return;
		}

		const leaf = options?.newTab ? this.app.workspace.getLeaf("tab") : this.getAuthoringLeaf();
		await leaf.openFile(file);
		if (options?.newTab) {
			this.app.workspace.setActiveLeaf(leaf, {focus: true});
		}
	}

	async countWords(book: BookRecord): Promise<number> {
		const counts = await this.wordCountsByEntry(book);
		let total = 0;
		for (const count of counts.values()) {
			total += count;
		}
		return total;
	}

	// Snippets live as one note per snippet under <book>/Scratchpad, so a Bases
	// card view can read them (Bases can only query notes, never raw JSON).
	async listSnippets(book: BookRecord): Promise<ScratchSnippet[]> {
		const folder = this.app.vault.getAbstractFileByPath(this.scratchpadFolderPath(book));
		if (!(folder instanceof TFolder)) {
			return [];
		}
		const snippets: ScratchSnippet[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === "md") {
				const snippet = await this.readSnippetNote(child);
				if (snippet) {
					snippets.push(snippet);
				}
			}
		}
		return snippets.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
	}

	async addSnippet(book: BookRecord, text: string, sourceFile?: string): Promise<ScratchSnippet> {
		const snippet = await this.writeSnippetNote(book, text, sourceFile, nowIso());
		await this.ensureScratchpadBase(book);
		this.notifyChanged();
		return snippet;
	}

	async removeSnippet(book: BookRecord, id: string): Promise<void> {
		const normalized = normalizePath(id);
		if (!normalized.startsWith(`${this.scratchpadFolderPath(book)}/`)) {
			return;
		}
		const file = this.app.vault.getAbstractFileByPath(normalized);
		if (file instanceof TFile) {
			await this.app.fileManager.trashFile(file);
		}
		this.notifyChanged();
	}

	// Create or return the per-book Bases file. Self-contained: it filters by
	// the snippet note `type` and `book` id, so renaming the folder won't break it.
	async ensureScratchpadBase(book: BookRecord): Promise<TFile | null> {
		const basePath = normalizePath(`${book.folderPath}/${BOOK_BASE_FILE_NAME}`);
		if (!await this.app.vault.adapter.exists(basePath)) {
			await this.app.vault.create(basePath, this.scratchpadBaseContent(book));
		}
		const file = this.app.vault.getAbstractFileByPath(basePath);
		return file instanceof TFile ? file : null;
	}

	// One-time backfill for books that predate this feature: convert the old
	// scratchpad.json into notes and make sure the Bases file exists.
	async backfillScratchpads(): Promise<void> {
		for (const book of await this.listBooks()) {
			await this.migrateScratchpadJson(book);
			await this.ensureScratchpadBase(book);
		}
	}

	private scratchpadFolderPath(book: BookRecord): string {
		return normalizePath(`${book.folderPath}/${SCRATCHPAD_FOLDER_NAME}`);
	}

	private async writeSnippetNote(
		book: BookRecord,
		text: string,
		sourceFile: string | undefined,
		createdAt: string,
	): Promise<ScratchSnippet> {
		const folderPath = this.scratchpadFolderPath(book);
		await ensureNestedFolder(this.app, folderPath);
		const baseName = sanitizeFileName(snippetTitle(text), "Snippet");
		const notePath = await uniquePath(this.app, `${folderPath}/${baseName}.md`);
		const frontmatter = serializeFrontmatter({
			type: SCRATCH_NOTE_TYPE,
			book: book.manifest.id,
			text,
			...(sourceFile ? {source: sourceFile} : {}),
			created: createdAt,
		});
		await this.app.vault.create(notePath, frontmatter);
		return {
			id: notePath,
			text,
			createdAt,
			...(sourceFile ? {sourceFile} : {}),
		};
	}

	private async readSnippetNote(file: TFile): Promise<ScratchSnippet | null> {
		let frontmatter: Record<string, unknown> = {};
		try {
			const content = await this.app.vault.cachedRead(file);
			const match = /^---\n([\s\S]*?)\n---/u.exec(content);
			if (match) {
				frontmatter = (parseYaml(match[1] ?? "") as Record<string, unknown> | null) ?? {};
			}
		} catch {
			return null;
		}
		const text = typeof frontmatter.text === "string" ? frontmatter.text : "";
		if (!text.trim()) {
			return null;
		}
		const source = typeof frontmatter.source === "string" ? frontmatter.source : undefined;
		const created = typeof frontmatter.created === "string"
			? frontmatter.created
			: new Date(file.stat.ctime).toISOString();
		return {
			id: file.path,
			text,
			createdAt: created,
			...(source ? {sourceFile: source} : {}),
		};
	}

	private async migrateScratchpadJson(book: BookRecord): Promise<void> {
		const jsonPath = normalizePath(`${book.folderPath}/${SCRATCHPAD_FILE_NAME}`);
		if (!await this.app.vault.adapter.exists(jsonPath)) {
			return;
		}
		const folder = this.app.vault.getAbstractFileByPath(this.scratchpadFolderPath(book));
		const alreadyMigrated = folder instanceof TFolder
			&& folder.children.some((child) => child instanceof TFile && child.extension === "md");
		if (!alreadyMigrated) {
			try {
				const parsed = JSON.parse(await this.app.vault.adapter.read(jsonPath)) as Partial<Scratchpad>;
				const snippets = Array.isArray(parsed.snippets) ? parsed.snippets : [];
				for (const snippet of snippets) {
					if (snippet && typeof snippet.text === "string" && snippet.text.trim()) {
						await this.writeSnippetNote(book, snippet.text, snippet.sourceFile, snippet.createdAt ?? nowIso());
					}
				}
			} catch (error) {
				console.error(`Books: could not migrate ${jsonPath}`, error);
				return;
			}
		}
		try {
			await this.app.vault.adapter.remove(jsonPath);
		} catch (error) {
			console.error(`Books: could not remove ${jsonPath}`, error);
		}
	}

	private scratchpadBaseContent(book: BookRecord): string {
		return [
			"properties:",
			"  property.text:",
			"    displayName: Snippet",
			"  property.source:",
			"    displayName: Source",
			"  property.created:",
			"    displayName: Saved",
			"views:",
			"  - type: cards",
			"    name: Scratchpad",
			"    filters:",
			"      and:",
			`        - type == "${SCRATCH_NOTE_TYPE}"`,
			`        - book == ${JSON.stringify(book.manifest.id)}`,
			"    order:",
			"      - text",
			"      - source",
			"      - created",
			"    sort:",
			"      - property: created",
			"        direction: DESC",
			"",
		].join("\n");
	}

	// Concatenate the whole book into one clean-manuscript Markdown string (spine
	// order, frontmatter stripped, titled headings, page breaks between
	// chapters). Canvases are skipped (not prose). Returns the text — the caller
	// decides where to write it (e.g. an export outside the vault).
	async compileBookMarkdown(book: BookRecord): Promise<string> {
		const blocks: string[] = [];
		const titleBlock = book.manifest.description
			? `# ${book.manifest.title}\n\n${book.manifest.description}`
			: `# ${book.manifest.title}`;
		blocks.push(titleBlock);

		for (const node of book.manifest.nodes) {
			if (isPart(node)) {
				blocks.push(`# ${node.title}`);
				for (const child of node.children) {
					if (child.format === "canvas") {
						continue;
					}
					blocks.push(`## ${child.title}\n\n${await this.readChapterBody(book, child)}`);
				}
			} else if (node.format !== "canvas") {
				blocks.push(`# ${node.title}\n\n${await this.readChapterBody(book, node)}`);
			}
		}

		const pageBreak = '\n\n<div style="page-break-after: always;"></div>\n\n';
		return `${blocks.join(pageBreak)}\n`;
	}

	private async readChapterBody(book: BookRecord, entry: BookEntry): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(`${book.folderPath}/${entry.file}`));
		if (!(file instanceof TFile)) {
			return "";
		}
		const raw = await this.app.vault.cachedRead(file);
		return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
	}

	async wordCountsByEntry(book: BookRecord): Promise<Map<string, number>> {
		const counts = new Map<string, number>();
		await Promise.all(flattenEntries(book.manifest.nodes).map(async (entry) => {
			if (entry.format === "canvas") {
				counts.set(entry.id, 0);
				return;
			}
			const file = this.app.vault.getAbstractFileByPath(normalizePath(`${book.folderPath}/${entry.file}`));
			counts.set(entry.id, file instanceof TFile ? countManuscriptWords(await this.app.vault.cachedRead(file)) : 0);
		}));
		return counts;
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

	private async uniqueSectionFile(book: BookRecord, title: string): Promise<string> {
		const base = sanitizeFileName(title);
		const path = await uniquePath(this.app, `${book.folderPath}/${base}.md`);
		return path.slice(book.folderPath.length + 1);
	}

	private async uniqueCanvasFile(book: BookRecord, title: string): Promise<string> {
		const base = sanitizeFileName(title);
		const path = await uniquePath(this.app, `${book.folderPath}/${base}.canvas`);
		return path.slice(book.folderPath.length + 1);
	}

	private async updateBookManifest(
		book: BookRecord,
		updates: Partial<Pick<BookManifest, "nodes" | "title" | "genre" | "description" | "status">>,
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

	private partTitleForEntry(nodes: BookNode[], entryId: string): string | null {
		const location = findEntry(nodes, entryId);
		return location?.part?.title ?? null;
	}

	private async refreshEntryFrontmatter(book: BookRecord): Promise<void> {
		const entries = flattenEntries(book.manifest.nodes);
		await Promise.all(entries.map(async (entry, index) => {
			if (entry.format === "canvas") {
				return; // canvas files have no frontmatter to mirror
			}
			const file = this.app.vault.getAbstractFileByPath(normalizePath(`${book.folderPath}/${entry.file}`));
			if (!(file instanceof TFile)) {
				return;
			}

			const partTitle = this.partTitleForEntry(book.manifest.nodes, entry.id);
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				const data = frontmatter as Record<string, unknown>;
				data.title = entry.title;
				data.bookId = book.manifest.id;
				data.bookTitle = book.manifest.title;
				if (partTitle) {
					data.sectionTitle = partTitle;
				} else {
					delete data.sectionTitle;
				}
				data.chapterId = entry.id;
				data.chapterType = entry.type;
				data.chapterTitle = entry.title;
				data.chapterOrder = index + 1;
				data.genre = book.manifest.genre;
				delete data.sectionId;
				delete data.sectionType;
				delete data.sectionOrder;
				delete data.partTitle;
			});
		}));
	}

	private async readManifest(path: string): Promise<BookManifest> {
		const raw = await this.app.vault.adapter.read(path);
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return {
			schemaVersion: BOOK_SCHEMA_VERSION,
			id: typeof parsed.id === "string" ? parsed.id : createId("book"),
			title: typeof parsed.title === "string" ? parsed.title : "Untitled book",
			genre: typeof parsed.genre === "string" ? parsed.genre : "",
			description: typeof parsed.description === "string" ? parsed.description : "",
			status: typeof parsed.status === "string" ? parsed.status : "Draft",
			nodes: this.normalizeNodes(parsed),
			createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : nowIso(),
			updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
		};
	}

	private normalizeNodes(parsed: Record<string, unknown>): BookNode[] {
		if (Array.isArray(parsed.nodes)) {
			return this.normalizeNodeList(parsed.nodes);
		}
		if (Array.isArray(parsed.sections)) {
			return parsed.sections
				.map((section) => this.normalizeEntry(section))
				.filter((entry): entry is BookEntry => entry !== null);
		}
		return [];
	}

	private normalizeNodeList(list: unknown[]): BookNode[] {
		const nodes: BookNode[] = [];
		for (const raw of list) {
			if (!raw || typeof raw !== "object") {
				continue;
			}

			const record = raw as Record<string, unknown>;
			if (record.kind === "part") {
				const children = Array.isArray(record.children)
					? record.children
						.map((child) => this.normalizeEntry(child))
						.filter((entry): entry is BookEntry => entry !== null)
					: [];
				nodes.push({
					kind: "part",
					id: typeof record.id === "string" ? record.id : createId("part"),
					title: typeof record.title === "string" ? record.title : "Untitled section",
					children,
					createdAt: typeof record.createdAt === "string" ? record.createdAt : nowIso(),
					updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : nowIso(),
				});
				continue;
			}

			const entry = this.normalizeEntry(record);
			if (entry) {
				nodes.push(entry);
			}
		}
		return nodes;
	}

	private normalizeEntry(raw: unknown): BookEntry | null {
		if (!raw || typeof raw !== "object") {
			return null;
		}

		const record = raw as Record<string, unknown>;
		if (typeof record.id !== "string" || typeof record.file !== "string") {
			return null;
		}

		const timestamp = nowIso();
		const isCanvas = record.format === "canvas" || record.file.endsWith(".canvas");
		return {
			kind: "entry",
			id: record.id,
			type: this.normalizeType(record.type),
			title: typeof record.title === "string" ? record.title : record.file,
			file: record.file,
			format: isCanvas ? "canvas" : undefined,
			createdAt: typeof record.createdAt === "string" ? record.createdAt : timestamp,
			updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : timestamp,
		};
	}

	private normalizeType(value: unknown): BookSectionType {
		return SECTION_TYPES.includes(value as BookSectionType) ? value as BookSectionType : "chapter";
	}

	private async writeManifest(path: string, manifest: BookManifest): Promise<void> {
		await this.app.vault.adapter.write(path, `${JSON.stringify(manifest, null, "\t")}\n`);
	}

	private serializeEntry(manifest: BookManifest, entry: BookEntry, order: number, partTitle: string | null): string {
		const frontmatter: Record<string, string | number | boolean> = {
			title: entry.title,
			bookId: manifest.id,
			bookTitle: manifest.title,
		};
		if (partTitle) {
			frontmatter.sectionTitle = partTitle;
		}
		frontmatter.chapterId = entry.id;
		frontmatter.chapterType = entry.type;
		frontmatter.chapterTitle = entry.title;
		frontmatter.chapterOrder = order;
		frontmatter.genre = manifest.genre;
		return serializeFrontmatter(frontmatter);
	}
}

function countManuscriptWords(content: string): number {
	let text = content;
	text = text.replace(/^---\n[\s\S]*?\n---\n?/, ""); // frontmatter
	text = text.replace(/```[\s\S]*?```/g, " "); // fenced code
	text = text.replace(/`[^`]*`/g, " "); // inline code
	text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " "); // images
	text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // links -> text
	text = text.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1"); // wikilinks -> text
	text = text.replace(/[#>*_~`]+/g, " "); // markdown markers
	const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
	return words ? words.length : 0;
}
