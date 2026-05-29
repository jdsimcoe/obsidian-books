import {DropdownComponent, Modal, Setting, type App} from "obsidian";
import type {BookRecord} from "../types";

// Pick which book's scratchpad to save a snippet to. Books arrive pre-ordered
// (most-recently-used first), so the first option is the default.
export class BookPickerModal extends Modal {
	private readonly snippet: string;
	private readonly books: BookRecord[];
	private readonly onSubmit: (book: BookRecord) => Promise<void> | void;
	private selectedId: string;

	constructor(
		app: App,
		snippet: string,
		books: BookRecord[],
		onSubmit: (book: BookRecord) => Promise<void> | void,
	) {
		super(app);
		this.snippet = snippet;
		this.books = books;
		this.onSubmit = onSubmit;
		this.selectedId = books[0]?.manifest.id ?? "";
	}

	onOpen(): void {
		// Title row: "Save to scratchpad" with the book dropdown beside it.
		this.titleEl.empty();
		this.titleEl.addClass("obsidian-books-scratch-save-title");
		this.titleEl.createSpan({text: "Save to scratchpad"});
		const dropdown = new DropdownComponent(this.titleEl);
		for (const book of this.books) {
			dropdown.addOption(book.manifest.id, book.manifest.title);
		}
		dropdown.setValue(this.selectedId);
		dropdown.onChange((value) => {
			this.selectedId = value;
		});

		// Body: the quotation being saved.
		this.contentEl.empty();
		this.contentEl.createDiv({cls: "obsidian-books-scratch-save-quote", text: this.snippet});

		new Setting(this.contentEl).addButton((button) => {
			button
				.setButtonText("Save")
				.setCta()
				.onClick(() => {
					const book = this.books.find((candidate) => candidate.manifest.id === this.selectedId);
					this.close();
					if (book) {
						void Promise.resolve(this.onSubmit(book));
					}
				});
		});
	}
}
