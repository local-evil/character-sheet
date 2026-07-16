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

### When an entry is too long for one page

The book does **not** auto-flow text onto a second page — if a page's text
would overflow, it fades out at the bottom and a warning is logged to the
browser console naming the file. When that happens, split the content
yourself into a second file:

- For **Others**, create a follow-up file (e.g.
  `005-mira-voss-part2.json`) with the same `name`, the remaining `notes`/
  `debts`, and `"continued": true`. This renders as a continuation page
  (no repeated avatar/status) and appears in the book wherever you place it
  in the manifest — typically right after the first part.
- For **Travels** or **Research**, just split into a second dated/titled
  entry the same way.

See `data/others/002-mira-voss-part1.json` and `003-mira-voss-part2.json`
for a working two-page example.

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
