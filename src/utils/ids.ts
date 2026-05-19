export function slugify(value: string, fallback = "untitled"): string {
	const slug = value
		.trim()
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/gu, "")
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
	return slug || fallback;
}

export function filePrefixFromSlug(slug: string): string {
	return slug.replace(/-/gu, "_");
}

export function createId(prefix: string): string {
	const bytes = new Uint8Array(4);
	window.crypto.getRandomValues(bytes);
	const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${prefix}-${suffix}`;
}

export function nowIso(): string {
	return new Date().toISOString();
}
