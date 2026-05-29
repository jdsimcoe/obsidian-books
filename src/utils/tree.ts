import type {BookEntry, BookNode, BookPart} from "../types";

export function isPart(node: BookNode): node is BookPart {
	return node.kind === "part";
}

export function isEntry(node: BookNode): node is BookEntry {
	return node.kind === "entry";
}

export function flattenEntries(nodes: BookNode[]): BookEntry[] {
	const entries: BookEntry[] = [];
	for (const node of nodes) {
		if (isPart(node)) {
			entries.push(...node.children);
		} else {
			entries.push(node);
		}
	}
	return entries;
}

export function countEntries(nodes: BookNode[]): number {
	return flattenEntries(nodes).length;
}

export function isCanvasEntry(entry: BookEntry): boolean {
	return entry.format === "canvas";
}

// Markdown chapters only (canvases excluded) — used for chapter counts.
export function countChapters(nodes: BookNode[]): number {
	return flattenEntries(nodes).filter((entry) => !isCanvasEntry(entry)).length;
}

export function cloneNodes(nodes: BookNode[]): BookNode[] {
	return nodes.map((node) => {
		if (isPart(node)) {
			return {...node, children: node.children.map((child) => ({...child}))};
		}
		return {...node};
	});
}

export interface EntryLocation {
	entry: BookEntry;
	part: BookPart | null;
}

export function findEntry(nodes: BookNode[], id: string): EntryLocation | null {
	for (const node of nodes) {
		if (isEntry(node)) {
			if (node.id === id) {
				return {entry: node, part: null};
			}
			continue;
		}
		const child = node.children.find((entry) => entry.id === id);
		if (child) {
			return {entry: child, part: node};
		}
	}
	return null;
}

export function findPart(nodes: BookNode[], id: string): BookPart | null {
	for (const node of nodes) {
		if (isPart(node) && node.id === id) {
			return node;
		}
	}
	return null;
}

export function removeEntry(nodes: BookNode[], id: string): BookEntry | null {
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!node) {
			continue;
		}
		if (isEntry(node)) {
			if (node.id === id) {
				nodes.splice(index, 1);
				return node;
			}
			continue;
		}
		const childIndex = node.children.findIndex((entry) => entry.id === id);
		if (childIndex !== -1) {
			const [removed] = node.children.splice(childIndex, 1);
			return removed ?? null;
		}
	}
	return null;
}

export interface InsertTarget {
	partId: string | null;
	beforeId?: string | null;
}

export function insertEntry(nodes: BookNode[], entry: BookEntry, target: InsertTarget): void {
	if (target.partId) {
		const part = findPart(nodes, target.partId);
		if (!part) {
			nodes.push(entry);
			return;
		}
		insertIntoList(part.children, entry, target.beforeId ?? null);
		return;
	}
	insertIntoList(nodes, entry, target.beforeId ?? null);
}

function insertIntoList(list: BookNode[], entry: BookEntry, beforeId: string | null): void {
	if (!beforeId) {
		list.push(entry);
		return;
	}
	const index = list.findIndex((node) => node.id === beforeId);
	if (index === -1) {
		list.push(entry);
		return;
	}
	list.splice(index, 0, entry);
}
