import {AbstractInputSuggest, DropdownComponent, Modal, Setting, TextAreaComponent, TextComponent, type App} from "obsidian";
import type {CreateBookInput} from "../types";

export const STATUS_OPTIONS = ["Draft", "Revising", "Done"];

export interface BookModalOptions {
	heading?: string;
	submitText?: string;
	initial?: CreateBookInput;
}

export class BookModal extends Modal {
	private titleInput: TextComponent | null = null;
	private genreInput: TextComponent | null = null;
	private statusDropdown: DropdownComponent | null = null;
	private descriptionInput: TextAreaComponent | null = null;
	private readonly genres: string[];
	private readonly onSubmit: (input: CreateBookInput) => void;
	private readonly options: BookModalOptions;

	constructor(app: App, genres: string[], onSubmit: (input: CreateBookInput) => void, options: BookModalOptions = {}) {
		super(app);
		this.genres = genres;
		this.onSubmit = onSubmit;
		this.options = options;
	}

	onOpen(): void {
		const initial = this.options.initial;
		this.modalEl.addClass("obsidian-books-modal");
		this.titleEl.setText(this.options.heading ?? "Create book");
		this.contentEl.empty();

		new Setting(this.contentEl)
			.setName("Title")
			.addText((component) => {
				this.titleInput = component;
				component.setPlaceholder("The work of fire");
				if (initial) {
					component.setValue(initial.title);
				}
			});

		new Setting(this.contentEl)
			.setName("Genre")
			.addText((component) => {
				this.genreInput = component;
				component.setPlaceholder("Essay collection, fiction, memoir");
				if (initial) {
					component.setValue(initial.genre);
				}
				new GenreSuggest(this.app, component.inputEl, this.genres);
			});

		new Setting(this.contentEl)
			.setName("Status")
			.addDropdown((component) => {
				this.statusDropdown = component;
				const status = initial?.status?.trim();
				const options = status && !STATUS_OPTIONS.includes(status)
					? [...STATUS_OPTIONS, status]
					: STATUS_OPTIONS;
				for (const option of options) {
					component.addOption(option, option);
				}
				component.setValue(status || "Draft");
			});

		new Setting(this.contentEl)
			.setName("Description")
			.addTextArea((component) => {
				this.descriptionInput = component;
				component.inputEl.rows = 4;
				component.setPlaceholder("A short working description.");
				if (initial) {
					component.setValue(initial.description);
				}
			});

		new Setting(this.contentEl)
			.addButton((button) => {
				button
					.setButtonText(this.options.submitText ?? "Create book")
					.setCta()
					.onClick(() => this.submit());
			});

		this.titleInput?.inputEl.focus();
		this.titleInput?.inputEl.select();
	}

	private submit(): void {
		this.onSubmit({
			title: this.titleInput?.getValue() ?? "",
			genre: this.genreInput?.getValue() ?? "",
			status: this.statusDropdown?.getValue() ?? "Draft",
			description: this.descriptionInput?.getValue() ?? "",
		});
		this.close();
	}
}

export class GenreSuggest extends AbstractInputSuggest<string> {
	private readonly textInputEl: HTMLInputElement;
	private readonly genres: string[];

	constructor(app: App, textInputEl: HTMLInputElement, genres: string[]) {
		super(app, textInputEl);
		this.textInputEl = textInputEl;
		this.genres = genres;
	}

	protected getSuggestions(query: string): string[] {
		const normalized = query.trim().toLowerCase();
		if (!normalized) {
			return this.genres;
		}

		return this.genres.filter((genre) => genre.toLowerCase().includes(normalized));
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string): void {
		this.setValue(value);
		this.textInputEl.trigger("input");
		this.close();
	}
}
