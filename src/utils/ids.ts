export function sanitizeFileName(value: string, fallback = "Untitled"): string {
	const cleaned = value
		.replace(/[\\/:*?"<>|#^[\]]/gu, " ")
		.replace(/\s+/gu, " ")
		.replace(/^[.\s]+|[.\s]+$/gu, "")
		.trim();
	return cleaned || fallback;
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
