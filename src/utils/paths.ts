import {normalizePath, TFolder, type App} from "obsidian";

export async function ensureFolder(app: App, path: string): Promise<TFolder> {
	const normalizedPath = normalizePath(path);
	const existing = app.vault.getAbstractFileByPath(normalizedPath);
	if (existing instanceof TFolder) {
		return existing;
	}

	await app.vault.createFolder(normalizedPath);
	const created = app.vault.getAbstractFileByPath(normalizedPath);
	if (!(created instanceof TFolder)) {
		throw new Error(`Could not create folder: ${normalizedPath}`);
	}

	return created;
}

export async function ensureNestedFolder(app: App, path: string): Promise<TFolder> {
	const parts = normalizePath(path).split("/").filter(Boolean);
	let current = "";
	let folder: TFolder | null = null;
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		folder = await ensureFolder(app, current);
	}

	if (!folder) {
		throw new Error("Folder path cannot be empty.");
	}

	return folder;
}

export async function uniquePath(app: App, path: string): Promise<string> {
	const normalizedPath = normalizePath(path);
	if (!await app.vault.adapter.exists(normalizedPath)) {
		return normalizedPath;
	}

	const dotIndex = normalizedPath.lastIndexOf(".");
	const base = dotIndex >= 0 ? normalizedPath.slice(0, dotIndex) : normalizedPath;
	const extension = dotIndex >= 0 ? normalizedPath.slice(dotIndex) : "";
	for (let index = 2; index < 1000; index += 1) {
		const candidate = `${base}-${index}${extension}`;
		if (!await app.vault.adapter.exists(candidate)) {
			return candidate;
		}
	}

	throw new Error(`Could not create a unique path for ${normalizedPath}`);
}

export function isBooksPath(path: string): boolean {
	return path === "Books" || path.startsWith("Books/");
}
