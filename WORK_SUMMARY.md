# Books plugin work summary

## Overview

Built the initial MVP of **Books**, an Obsidian community plugin for authoring long-form books as Markdown files inside a vault-root `Books/` folder. The plugin is structured like the sibling `obsidian-mirror` plugin, with a small lifecycle-focused `src/main.ts`, feature modules under `src/`, bundled output through esbuild, and TypeScript/ESLint verification.

## Project scaffolding

- Added Obsidian plugin metadata and release files: `manifest.json`, `versions.json`, `package.json`, `package-lock.json`, `tsconfig.json`, `esbuild.config.mjs`, `eslint.config.mts`, and `version-bump.mjs`.
- Added `main.js` to `.gitignore` while still generating it locally with `npm run build` so Obsidian can load the plugin during vault development.
- Registered stable commands:
  - `open-books-library`
  - `create-book`
  - `create-chapter`
  - `open-books-sidebar`

## Storage and book model

- Implemented `BookStore` as the persistence layer.
- Books are stored at `Books/<book-slug>/`.
- Each book folder contains:
  - `book.json` as the source of truth for book metadata and section order.
  - `<book-slug>.md` as the overview note.
  - Section files using unique storage filenames such as `<book_slug>_<section_slug>.md`.
- Section Markdown files get Obsidian frontmatter including `title`, `bookId`, `bookTitle`, `sectionId`, `sectionType`, `sectionTitle`, `sectionOrder`, and `genre`.
- Reordering sections updates `book.json` and refreshes section frontmatter without renaming files.
- Removing sections supports two paths:
  - Remove from TOC only, keeping the Markdown file.
  - Remove from TOC and send the Markdown file to trash through Obsidian's `FileManager.trashFile()`.

## Views and UI

- Added a left-dock Books library view so Books behaves like File explorer/Search/Bookmarks instead of opening as a main document tab.
- The library supports search, list/grid toggle, book creation, compact left-pane styling, and opening each book's TOC in the main workspace.
- Added a main book TOC view with:
  - Book title, genre/status metadata, overview button, and new-section button.
  - Drag-to-reorder sections.
  - Open, rename, and remove controls per section.
  - New-tab opening for sections so the TOC remains available.
- Added render race protection to the TOC view so rapid vault events from create/remove/trash operations do not duplicate the rendered UI.
- Added a right research sidebar view for recent/searchable notes and Mirror-compatible embed insertion.

## Manuscript display and Mirror integration

- Added `ManuscriptStyler` to mark Markdown leaves under `Books/` and apply manuscript-specific behavior.
- Books files now keep unique storage filenames while displaying readable human titles in the editor title area.
- Header breadcrumbs for Books files are rewritten to readable labels such as `Books / The Eternal Now / Introduction` instead of slug/filename values.
- New section files no longer auto-insert a duplicate `# Section title`; the readable inline title is treated as the document title.
- Added manuscript CSS for typography and lighter Mirror embed styling so Mirror references can read more like footnote/citation material inside book chapters.

## Search and insertion

- Added `NoteSearchIndex` for lazy recent-note and block search outside the `Books/` folder.
- Added Mirror-compatible insertion:
  - Whole note: `![[path]]`
  - Block result: `![[path#^block-id]]`
- Missing block IDs are generated and written back to the source note before insertion.

## Verification

The current implementation has been checked with:

```bash
npm run lint
npm run build
```

Both commands pass.

## Current notes

- Obsidian needs the Books plugin reloaded after code/CSS changes so the rebuilt `main.js` and `styles.css` are picked up.
- Existing generated section files may still contain an old leading `# Section title` heading in their Markdown body. New sections no longer include that heading automatically.
