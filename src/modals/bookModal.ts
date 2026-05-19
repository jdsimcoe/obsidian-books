import {Modal, Setting, TextAreaComponent, TextComponent, type App} from "obsidian";
import type {CreateBookInput} from "../types";

export class BookModal extends Modal {
	private titleInput: TextComponent | null = null;
	private genreInput: TextComponent | null = null;
	private statusInput: TextComponent | null = null;
	private descriptionInput: TextAreaComponent | null = null;
	private readonly onSubmit: (input: CreateBookInput) => void;

	constructor(app: App, onSubmit: (input: CreateBookInput) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		this.titleEl.setText("Create book");
		this.contentEl.empty();

		new Setting(this.contentEl)
			.setName("Title")
			.addText((component) => {
				this.titleInput = component;
				component.setPlaceholder("The work of fire");
			});

		new Setting(this.contentEl)
			.setName("Genre")
			.addText((component) => {
				this.genreInput = component;
				component.setPlaceholder("Essay collection, fiction, memoir");
			});

		new Setting(this.contentEl)
			.setName("Status")
			.addText((component) => {
				this.statusInput = component;
				component.setValue("Draft");
			});

		new Setting(this.contentEl)
			.setName("Description")
			.addTextArea((component) => {
				this.descriptionInput = component;
				component.inputEl.rows = 4;
				component.setPlaceholder("A short working description.");
			});

		new Setting(this.contentEl)
			.addButton((button) => {
				button
					.setButtonText("Create book")
					.setCta()
					.onClick(() => this.submit());
			});

		this.titleInput?.inputEl.focus();
	}

	private submit(): void {
		this.onSubmit({
			title: this.titleInput?.getValue() ?? "",
			genre: this.genreInput?.getValue() ?? "",
			status: this.statusInput?.getValue() ?? "Draft",
			description: this.descriptionInput?.getValue() ?? "",
		});
		this.close();
	}
}
