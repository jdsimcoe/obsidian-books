export type BookSectionType = "intro" | "chapter" | "interlude" | "appendix" | "backmatter";

export type BookEntryFormat = "markdown" | "canvas";

export interface BookEntry {
	kind: "entry";
	id: string;
	type: BookSectionType;
	title: string;
	file: string;
	// Absent means a markdown chapter; "canvas" means an Obsidian .canvas file.
	format?: BookEntryFormat;
	createdAt: string;
	updatedAt: string;
}

export interface BookPart {
	kind: "part";
	id: string;
	title: string;
	children: BookEntry[];
	createdAt: string;
	updatedAt: string;
}

export type BookNode = BookPart | BookEntry;

export interface BookManifest {
	schemaVersion: number;
	id: string;
	title: string;
	genre: string;
	description: string;
	status: string;
	nodes: BookNode[];
	createdAt: string;
	updatedAt: string;
}

export interface BookRecord {
	folderPath: string;
	manifestPath: string;
	slug: string;
	manifest: BookManifest;
}

export interface CreateBookInput {
	title: string;
	genre: string;
	description: string;
	status: string;
}

export interface CreateSectionInput {
	book: BookRecord;
	type: BookSectionType;
	title: string;
	partId?: string;
}

export interface CreatePartInput {
	book: BookRecord;
	title: string;
}

export interface CreateCanvasInput {
	book: BookRecord;
	title: string;
	partId?: string;
	// When true (and no partId), the canvas is inserted at the top, above sections.
	atTop?: boolean;
}

export interface ScratchSnippet {
	id: string;
	text: string;
	sourceFile?: string;
	createdAt: string;
}

export interface Scratchpad {
	schemaVersion: number;
	snippets: ScratchSnippet[];
}
