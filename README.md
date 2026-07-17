# Book of Eldrin Vane

A leather-bound "book" web component for a character sheet site. Opens from a
closed cover into a two-page spread and pages continuously through three
sections: Travels, Research, Others.

## Structure

```
index.html            the whole book — send people here
assets/
  styles.css           all visual styling
  book.js               loads data, renders pages, handles open/close + navigation
data/
  travels/
    manifest.json        ordered list of filenames in this section
    _template.json        copy this to start a new entry (not loaded by the site)
    001-....json           one entry = one page
  research/
    manifest.json
    _template.json
    001-....json
  others/
    manifest.json
    _template.json
    001-....json
```

Nothing is hardcoded in the JavaScript — the book renders whatever entries are
listed in each `manifest.json`. Order in the manifest is the order pages
appear in the book (Travels first, then Research, then Others).

## Adding a new entry

1. Copy the section's `_template.json`, rename it (anything ending in
   `.json`, e.g. `004-the-long-road-home.json`).
2. Fill in the fields. Field meanings by section:

   **Travels** — `date`, `text`.

   **Research** — `title`, `date`, `text`, and an optional `furtherStudies`
   note that renders in a highlighted block at the bottom of the page. Leave
   `furtherStudies` out (or empty) to omit that block.

   **Others** — `name`, `status`, `notes`, `debts`, and `continued`. `status`
   and `debts` are optional; `debts` renders as a highlighted block at the
   bottom. Leave `continued` as `false` for a person's first page.

   For paragraph breaks in any `text`/`notes` field, leave a blank line
   between paragraphs (in JSON that's `\n\n` inside the string).

3. Add the new filename to that section's `manifest.json`, in the position
   where it should appear.

### Text formatting

Inside any `text`/`notes`/`furtherStudies`/`debts` field you can use:

- `**bold**`
- `*italic*`
- `++underline++`
- `![alt text](path/to/image.jpg)` for an inline image — put image files
  under `assets/images/` and reference them with a relative path, e.g.
  `![the toll house ruin](assets/images/toll-house.jpg)`. Images are scaled
  to the page width automatically.

Anything else you type is treated as plain text (HTML is escaped, so raw
tags won't work).

### Long entries

The book paginates automatically — if an entry's text is too long for one
page, it flows onto as many additional pages as it needs, each with a
lighter "continued" header. You don't need to manually split content
across files for length reasons anymore.

The `furtherStudies` (Research) and `debts` (Others) callout blocks are
still moved onto a page as a whole (never split mid-block), so an
extremely long one of those could still overflow its page — keep those
fairly short.

The **Others** section's `"continued": true` field still exists and still
works, but it's now optional — it's only useful if you want to force a
manual page break at a specific point (e.g. for pacing) rather than letting
auto-pagination decide. See `data/others/002-mira-voss-part1.json` and
`003-mira-voss-part2.json` for an example of that manual style.

## Previewing locally

The page loads data with `fetch()`, which browsers block against `file://`
URLs. Run a tiny local server from the `book-site` folder instead:

```
# Python
python3 -m http.server 8000

# or Node
npx serve .
```

Then open `http://localhost:8000`.

## Deploying to GitHub Pages

1. Push this folder's contents to a GitHub repo (this folder itself as the
   repo root, or as a `/docs` folder — either works).
2. In the repo, go to Settings → Pages, and set the source to the branch
   and folder you pushed to.
3. GitHub will publish it at `https://<username>.github.io/<repo>/`. The
   `.nojekyll` file in this folder tells GitHub Pages to skip Jekyll
   processing, since none of these filenames need it.

## Customizing

- Book title, subtitle, and the cover monogram are plain text in
  `index.html` (`.cover-title`, `.cover-sub`, `.cover-sigil`) — edit
  directly, no data file needed.
- Section labels/order/folder names live in the `SECTIONS` array at the top
  of `assets/book.js`.
- Colors, fonts, and the leather/parchment textures are all in
  `assets/styles.css`; the grain and scuff textures themselves are painted
  onto `<canvas>` elements at runtime in `assets/book.js`
  (`paintNoise`/`paintScuff`), so there are no image assets to replace.
