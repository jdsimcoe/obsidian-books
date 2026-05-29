// Minimal typings for the bits of @electron/remote we use (provided by Obsidian
// desktop at runtime; not installed as a real dependency).
declare module "@electron/remote" {
	export const dialog: {
		showSaveDialog(options?: {
			title?: string;
			defaultPath?: string;
			buttonLabel?: string;
			filters?: {name: string; extensions: string[]}[];
		}): Promise<{canceled: boolean; filePath?: string}>;
	};
}
