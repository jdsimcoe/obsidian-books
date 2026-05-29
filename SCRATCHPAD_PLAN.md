# Scratchpad — plan

A per-book scratchpad for stashing snippets while drafting, and dragging them back into the manuscript later.

Mark up anything inline — I've left questions as comments at the open decisions. Reply in the comment threads or just edit the text.

---

## What it does

- **Save to scratchpad** — right-click a selection in a book chapter → "Save to scratchpad". The snippet is stored on the current book's scratchpad.
- **Sidebar view** — a panel listing the book's snippets, modeled on Obsidian's backlinks/linked-mentions panel: header row of icons, a search box, then the list. A `+` button creates a blank snippet.
- **Drag back in** — drag a snippet from the panel into the editor to insert its text.
- **Search** — filter the snippets in the panel by text.
- **Scoped per book** — each book has its own scratchpad; the panel always shows the active book's.
- **Follows the book** — opening a book surfaces the scratchpad (see auto-activation below); the tab uses a "scribble" icon.

---

## Storage

Each book gets a scratchpad file alongside `book.json`:

```
Books/The Eternal Now/
  book.json
  scratchpad.json   ← snippets for this book
  Overview.md
```

```jsonc
// scratchpad.json
{
  "schemaVersion": 1,
  "snippets": [
    {
      "id": "snip-9f2a",
      "text": "The future has not yet been written…",
      "sourceFile": "Overview.md",   // chapter it was saved from (optional)
      "createdAt": "2026-05-29T17:50:00.000Z"
    }
  ]
}
```

{==scratchpad.json (structured) vs a human-readable Scratchpad.md==}{>>Decision 1 — storage format. I lean JSON: clean for ordered snippets, search, drag payloads, and it won't show up as a chapter/note in your vault. The tradeoff is you can't hand-edit it as Markdown. Alternative: a `Scratchpad.md` with each snippet as a `---`-separated block — editable as a note, but messier to parse and it shows up in search/graph. Which do you want?<<}{id="c1" by="AI" at="2026-05-29T17:59:03.000Z"}

{==sourceFile (provenance)==}{>>Decision 2 — keep a reference to the chapter a snippet came from? Cheap to store, lets the panel show "from Overview" and could support a "jump to source" later. Say no if you'd rather snippets be context-free.<<}{id="c2" by="AI" at="2026-05-29T17:59:03.000Z"}

---

## Snippet model

Plain text/Markdown captured verbatim. Dragging one in inserts its text at the drop point.

{==inserts its text at the drop point==}{>>Decision 3 — drag-in behavior. Default: insert the raw text exactly as saved (Markdown preserved). Options I could add: wrap as a blockquote, or insert as a callout. Raw text is simplest and least surprising — good as the default?<<}{id="c3" by="AI" at="2026-05-29T17:59:03.000Z"}

---

## Sidebar view

A new view, `obsidian-books-scratchpad`, **distinct from the existing "research sidebar"** (that one searches the whole vault and inserts transclusions — different job).

{==distinct from the existing "research sidebar"==}{>>Decision 4 — confirm these stay separate. The research sidebar = vault-wide note search → mirror-embed. The scratchpad = this book's saved snippets → drag/insert text. I think separate views is right; flag if you'd rather merge them into one tabbed panel.<<}{id="c4" by="AI" at="2026-05-29T17:59:03.000Z"}

Layout (mirrors the linked-mentions panel):

```
┌─────────────────────────────┐
│  [search]              [ + ] │   header: search toggle + create
│  Search…                     │   search box (when toggled)
│  ─────────────────────────── │
│  ▏ The future has not yet…   │   snippet (draggable)
│  ▏ A book about living in…   │
└─────────────────────────────┘
```

- **Right sidebar**, like backlinks / linked-mentions.
- **Scribble icon** on the tab (Obsidian lucide options: `scribble`, `pencil-line`, `notebook-pen`, `signature`).
- Each snippet row is `draggable`; drag payload = the snippet text. Row actions: insert-at-cursor (`+`) and delete.

{==Right sidebar==}{>>Decision 5 — your screenshots are the right sidebar (linked mentions / tags), so I'll put it there. OK?<<}{id="c5" by="AI" at="2026-05-29T17:59:03.000Z"}

{==Scribble icon==}{>>Decision 6 — pick an icon: `scribble`, `pencil-line`, `notebook-pen`, or `signature`. I'll default to `notebook-pen` if you don't have a preference.<<}{id="c6" by="AI" at="2026-05-29T17:59:03.000Z"}

---

## Book scoping & auto-activation

The scratchpad view is a single panel that tracks the **active book** (like backlinks track the active file). The `BookModeController` already knows when you're in a book chapter or spine — I'll extend it so entering "Books mode" also points the scratchpad at that book.

{==entering "Books mode" also points the scratchpad at that book==}{>>Decision 7 — how assertive should "activated when you open a book" be? Consistent with the left-sidebar behavior we just built, I'd switch the right-sidebar tab to the scratchpad behind the scenes without force-opening a collapsed right sidebar or stealing focus. Or do you want opening a book to actively pop the right sidebar open to the scratchpad? (More in-your-face.)<<}{id="c7" by="AI" at="2026-05-29T17:59:03.000Z"}

---

## Spine entry point

A button on the spine (TOC) header — e.g. next to "Add section" / "New chapter" — that reveals/focuses the scratchpad for that book.

{==A button on the spine==}{>>Decision 8 — icon-only button (scribble) in the spine header, or a labeled "Scratchpad" button? I'll default to an icon button to match the existing header controls.<<}{id="c8" by="AI" at="2026-05-29T17:59:03.000Z"}

---

## Build phases

I'd ship this incrementally so you can react at each step:

1. **Storage** — `scratchpad.json` read/write in `BookStore` (`addSnippet`, `listSnippets`, `removeSnippet`, `updateSnippet`), per-book.
2. **Sidebar view** — register the scratchpad view + scribble icon; render the active book's snippets with search + `+` create + delete.
3. **Save to scratchpad** — editor context-menu item on a selection in a book chapter.
4. **Drag back in** — draggable rows → drop text into the editor; plus an insert-at-cursor button.
5. **Follows the book** — `BookModeController` points the scratchpad at the active book; spine header entry point.

{>>Anything missing, or a phase you'd want reordered / dropped for a first cut? Also fine to tell me "just build phases 1–3 first."<<}{id="c9" by="AI" at="2026-05-29T17:59:03.000Z"}
