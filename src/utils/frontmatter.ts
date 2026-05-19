export function serializeFrontmatter(data: Record<string, string | number | boolean>): string {
	const lines = ["---"];
	for (const [key, value] of Object.entries(data)) {
		lines.push(`${key}: ${formatYamlValue(value)}`);
	}
	lines.push("---", "");
	return `${lines.join("\n")}\n`;
}

function formatYamlValue(value: string | number | boolean): string {
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	if (!value) {
		return "\"\"";
	}

	return JSON.stringify(value);
}
