import {DropdownComponent, Modal, Setting, TextComponent, type App} from "obsidian";
import type {BookSectionType} from "../types";

export interface SectionModalInput {
	type: BookSectionType;
	title: string;
}

const TITLE_DEFAULTS: Record<BookSectionType, string> = {
	chapter: "",
	intro: "Introduction",
	interlude: "",
	appendix: "Appendix",
	backmatter: "Back matter",
};

export class SectionModal extends Modal {
	private titleInput: TextComponent | null = null;
	private typeInput: DropdownComponent | null = null;
	private userEditedTitle = false;
	private readonly initialType: BookSectionType;
	private readonly onSubmit: (input: SectionModalInput) => void;

	constructor(app: App, onSubmit: (input: SectionModalInput) => void, initialType: BookSectionType = "chapter") {
		super(app);
		this.onSubmit = onSubmit;
		this.initialType = initialType;
	}

	onOpen(): void {
		this.modalEl.addClass("obsidian-books-modal");
		this.titleEl.setText("Create section");
		this.contentEl.empty();

		new Setting(this.contentEl)
			.setName("Type")
			.addDropdown((component) => {
				this.typeInput = component;
				component
					.addOption("chapter", "Chapter")
					.addOption("intro", "Intro")
					.addOption("interlude", "Interlude")
					.addOption("appendix", "Appendix")
					.addOption("backmatter", "Back matter")
					.setValue(this.initialType)
					.onChange((value) => {
						if (this.userEditedTitle) return;
						this.titleInput?.setValue(TITLE_DEFAULTS[value as BookSectionType] ?? "");
					});
			});

		new Setting(this.contentEl)
			.setName("Title")
			.addText((component) => {
				this.titleInput = component;
				component.setPlaceholder("Chapter 1");
				component.setValue(TITLE_DEFAULTS[this.initialType] ?? "");
				component.inputEl.addEventListener("input", () => {
					this.userEditedTitle = true;
				});
			});

		new Setting(this.contentEl)
			.addButton((button) => {
				button
					.setButtonText("Create section")
					.setCta()
					.onClick(() => this.submit());
			});

		this.titleInput?.inputEl.focus();
	}

	private submit(): void {
		const type = this.typeInput?.getValue() as BookSectionType | undefined;
		this.onSubmit({
			type: type ?? "chapter",
			title: this.titleInput?.getValue() ?? "",
		});
		this.close();
	}
}
