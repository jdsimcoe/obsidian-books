export type BookSectionType = "intro" | "chapter" | "interlude" | "appendix" | "backmatter";

export interface BookSection {
	id: string;
	type: BookSectionType;
	title: string;
	file: string;
	createdAt: string;
	updatedAt: string;
}

export interface BookManifest {
	schemaVersion: number;
	id: string;
	title: string;
	genre: string;
	description: string;
	status: string;
	overviewFile: string;
	sections: BookSection[];
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
}
