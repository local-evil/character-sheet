/* -------------------------------------------------------------------
   Book of Eldrin Vane — data-driven book renderer
   Sections are configured below. Each section folder needs a
   manifest.json (an ordered array of filenames) plus one JSON file
   per entry. See the README and each folder's _template.json for
   the exact fields expected.
------------------------------------------------------------------- */

/* To add a new section: add one entry here (plus its data folder). Its
   index-tab color, page ordering, and vertical slot along the book's edge
   are all derived automatically from this array -- nothing else to touch. */
const SECTIONS = [
  { key: 'travels',  label: 'Travels',  folder: 'data/travels',  tabColor: 'linear-gradient(160deg, #cdeaf3 0%, #82bcd4 55%, #5a93ac 100%)' },
  { key: 'research', label: 'Research', folder: 'data/research', tabColor: 'linear-gradient(160deg, #c6acdf 0%, #8a63b3 55%, #6b4694 100%)' },
  { key: 'others',   label: 'Others',   folder: 'data/others',   tabColor: 'linear-gradient(160deg, #eecf87 0%, #c9a24a 55%, #a6812f 100%)' }
];

// Fixed vertical slots for the section index tabs, in array order -- each
// section keeps the same slot always, whether its tab is on the left or
// right edge.
const TAB_SLOT_TOP = 64;
const TAB_SLOT_GAP = 48;

let pages = [];
let spreadStart = 0;
let isOpen = false;
let ready = false;
let allResultsBySection = [];
let sectionCovers = [];
let widthTimer = null;

const book = document.getElementById('book');
const coverEl = document.getElementById('coverEl');
const toggleBtn = document.getElementById('toggleBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const counterEl = document.getElementById('counter');
const sectionTabsEl = document.getElementById('sectionTabs');
const sectionLabelsEl = document.getElementById('sectionLabels');
const coverHintEl = document.querySelector('.cover-hint');
const measureHeaderEl = document.getElementById('measureHeader');
const measureBodyEl = document.getElementById('measureBody');

/* ---------- helpers ---------- */

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* Lightweight inline markup, applied after escaping so raw HTML in the
   source data can never leak through: **bold**, *italic*, ++underline++,
   ![alt](src) for an inline image. */
function inlineFormat(escaped) {
  return escaped
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img class="inline-img" src="$2" alt="$1">')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\+\+([^+]+)\+\+/g, '<u>$1</u>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function formatParagraph(raw) {
  return `<p>${inlineFormat(escapeHtml(raw)).replace(/\n/g, '<br>')}</p>`;
}

function splitParagraphsRaw(text) {
  if (!text) return [];
  return text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
}

function extractImageSrcs(text) {
  if (!text) return [];
  const out = [];
  const re = /!\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

/* ---------- data loading ---------- */

async function loadSection(section) {
  try {
    const manifestRes = await fetch(`${section.folder}/manifest.json`);
    if (!manifestRes.ok) throw new Error(`manifest.json not found for "${section.key}"`);
    const filenames = await manifestRes.json();
    const entries = [];
    for (const filename of filenames) {
      try {
        const res = await fetch(`${section.folder}/${filename}`);
        if (!res.ok) { console.warn(`Could not load ${section.folder}/${filename}`); continue; }
        const data = await res.json();
        entries.push({ type: section.key, sectionLabel: section.label, filename, data });
      } catch (err) {
        console.warn(`Error loading ${section.folder}/${filename}`, err);
      }
    }
    return entries;
  } catch (err) {
    console.warn(`Could not load section "${section.key}" — is manifest.json present?`, err);
    return [];
  }
}

/* The book's title, subtitle, eyebrow line, and cover monogram all live in
   data/book.json so they're editable without touching HTML. */
async function loadBookConfig() {
  try {
    const res = await fetch('data/book.json');
    if (!res.ok) throw new Error('data/book.json not found');
    return await res.json();
  } catch (err) {
    console.warn('Could not load data/book.json — using defaults', err);
    return {};
  }
}

function applyBookConfig(config) {
  const eyebrowEl = document.getElementById('coverEyebrow');
  const titleEl = document.getElementById('coverTitle');
  const subEl = document.getElementById('coverSub');
  const sigilEl = document.getElementById('coverSigil');
  if (eyebrowEl) eyebrowEl.textContent = config.eyebrow || 'The Ties That Bind';
  if (titleEl) titleEl.textContent = config.title || 'Eldrin Vane';
  if (subEl) subEl.textContent = config.subtitle || 'A Personal Record';
  if (sigilEl) sigilEl.textContent = config.sigil || 'EV';
}

/* Each section's title page comes from folder/_cover.json (just a
   "title" field) so it's editable the same way as any entry; if the file
   is missing, the section's own label is used instead. */
async function loadSectionCover(section) {
  try {
    const res = await fetch(`${section.folder}/_cover.json`);
    if (!res.ok) throw new Error('_cover.json not found');
    const data = await res.json();
    return { title: data.title || section.label };
  } catch (err) {
    return { title: section.label };
  }
}

/* ---------- entry -> content blocks ---------- */

/* Each entry becomes a header (shown once) plus an ordered list of body
   blocks. Blocks of kind 'p' are plain paragraphs that the paginator is
   allowed to split mid-paragraph (at a word boundary) if a single one is
   too tall for an empty page. Blocks of kind 'html' (the further-studies /
   debts callouts) are moved as a whole to whichever page has room. */

function buildEntrySpec(entry) {
  const d = entry.data;

  if (entry.type === 'travels') {
    return {
      header: `<div class="page-eyebrow">Travels</div><div class="page-meta">${escapeHtml(d.date)}</div><div class="page-divider"></div>`,
      contHeader: `<div class="page-eyebrow">Travels &mdash; continued</div><div class="page-divider"></div>`,
      blocks: splitParagraphsRaw(d.text).map(text => ({ kind: 'p', text }))
    };
  }

  if (entry.type === 'research') {
    const blocks = splitParagraphsRaw(d.text).map(text => ({ kind: 'p', text }));
    if (d.furtherStudies) {
      blocks.push({
        kind: 'html',
        html: `<div class="page-bottom"><div class="page-bottom-label">Further studies</div><div class="page-bottom-text">${inlineFormat(escapeHtml(d.furtherStudies))}</div></div>`
      });
    }
    const titleHtml = `<h2 class="page-title">${escapeHtml(d.title || 'Untitled')}</h2>`;
    return {
      header: `<div class="page-eyebrow">Research</div>${titleHtml}<div class="page-meta">${escapeHtml(d.date)}</div><div class="page-divider"></div>`,
      contHeader: `<div class="page-eyebrow">Research &mdash; continued</div>${titleHtml}<div class="page-divider"></div>`,
      blocks
    };
  }

  // others
  const initials = (d.name || '?').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  const blocks = splitParagraphsRaw(d.notes).map(text => ({ kind: 'p', text }));
  if (d.debts) {
    blocks.push({
      kind: 'html',
      html: `<div class="page-bottom"><div class="page-bottom-label">Debts</div><div class="page-bottom-text">${inlineFormat(escapeHtml(d.debts))}</div></div>`
    });
  }
  const contHeader = `<div class="page-eyebrow">Others &mdash; continued</div><h2 class="page-title">${escapeHtml(d.name || '')}</h2><div class="page-divider"></div>`;
  const fullHeader = `
    <div class="page-eyebrow">Others</div>
    <div class="rel-head">
      <div class="avatar">${initials}</div>
      <div>
        <h2 class="page-title">${escapeHtml(d.name || 'Unnamed')}</h2>
        ${d.status ? `<span class="page-tag">${escapeHtml(d.status)}</span>` : ''}
      </div>
    </div>
    <div class="page-divider"></div>`;
  return { header: d.continued ? contHeader : fullHeader, contHeader, blocks };
}

function blockHtml(block) {
  return block.kind === 'html' ? block.html : formatParagraph(block.text);
}

/* Binary-searches how many words of a paragraph fit in whatever room is
   left on the page, using the real measurer so it accounts for the active
   font/width. forceAtLeastOne guarantees forward progress when the page is
   otherwise completely empty (there's nowhere else for that word to go);
   when there's already other content on the page, coming up empty just
   means this paragraph carries over to the next page whole. */
function splitOversizedParagraph(text, fits, forceAtLeastOne) {
  const words = text.split(/\s+/);
  let lo = 1, hi = words.length, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(formatParagraph(words.slice(0, mid).join(' ')))) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (best === 0 && forceAtLeastOne) best = 1;
  if (best === 0) return { fitText: '', remainderText: text };
  return { fitText: words.slice(0, best).join(' '), remainderText: words.slice(best).join(' ') };
}

/* ---------- pagination ---------- */

function paginateEntry(entry) {
  const spec = buildEntrySpec(entry);
  const out = [];
  let remaining = spec.blocks.slice();
  let header = spec.header;

  while (true) {
    measureHeaderEl.innerHTML = header;
    let accHtml = '';
    let fitCount = 0;
    let splitRemainderBlock = null;

    for (let idx = 0; idx < remaining.length; idx++) {
      const block = remaining[idx];
      const candidateHtml = accHtml + blockHtml(block);
      measureBodyEl.innerHTML = candidateHtml;
      const overflow = measureBodyEl.scrollHeight > measureBodyEl.clientHeight + 1;

      if (!overflow) {
        accHtml = candidateHtml;
        fitCount = idx + 1;
        continue;
      }

      // This block doesn't fit as a whole in whatever room is left. If
      // it's a paragraph, fill the remaining space with as much of it as
      // fits and carry the rest to the next page -- so a \n\n paragraph
      // break behaves like one (the next paragraph just continues packing
      // onto the same page) instead of jumping to a fresh page just
      // because the *whole* next paragraph didn't fit.
      if (block.kind === 'p') {
        const prefix = accHtml;
        const { fitText, remainderText } = splitOversizedParagraph(block.text, html => {
          measureBodyEl.innerHTML = prefix + html;
          return measureBodyEl.scrollHeight <= measureBodyEl.clientHeight + 1;
        }, idx === 0);
        if (fitText) {
          accHtml = prefix + formatParagraph(fitText);
          fitCount = idx + 1;
          if (remainderText) splitRemainderBlock = { kind: 'p', text: remainderText };
        }
        // else: nothing of it fits here -- falls through and carries the
        // whole paragraph to the next page.
      } else if (idx === 0) {
        // an atomic block (e.g. a huge debts note) alone on an empty page
        // still doesn't fit -- accept the overflow rather than loop forever
        accHtml = candidateHtml;
        fitCount = 1;
      }
      break;
    }

    out.push({ headerHtml: header, bodyHtml: accHtml });
    const carryOver = remaining.slice(fitCount);
    remaining = splitRemainderBlock ? [splitRemainderBlock, ...carryOver] : carryOver;
    if (remaining.length === 0) break;
    header = spec.contHeader;
  }

  return out.map(p => ({
    headerHtml: p.headerHtml,
    bodyHtml: p.bodyHtml,
    type: entry.type,
    sectionLabel: entry.sectionLabel,
    filename: entry.filename
  }));
}

async function preloadImages(entries) {
  const srcs = new Set();
  entries.forEach(e => {
    const d = e.data;
    [d.text, d.notes, d.furtherStudies, d.debts].forEach(t => extractImageSrcs(t).forEach(s => srcs.add(s)));
  });
  await Promise.all([...srcs].map(src => new Promise(resolve => {
    const img = new Image();
    img.onload = resolve;
    img.onerror = resolve; // a broken image reference shouldn't block pagination
    img.src = src;
  })));
}

/* Every section opens on a title page -- just its name, centered -- which
   is also its "first page" for the index-marker peek (see
   tabPositionState()). It's a fixed one-off, not run through the
   paragraph paginator, since there's nothing to fit. */
function buildSectionCoverPage(section, coverData) {
  return {
    type: section.key,
    sectionLabel: section.label,
    filename: `${section.folder}/_cover.json`,
    isSectionCover: true,
    coverTitle: coverData.title
  };
}

function paginateAllSections(resultsBySection, covers) {
  pages = [];
  resultsBySection.forEach((entries, i) => {
    pages.push(buildSectionCoverPage(SECTIONS[i], covers[i]));
    entries.forEach(entry => { pages.push(...paginateEntry(entry)); });
  });
}

/* ---------- rendering ---------- */

function buildPageHTML(page) {
  const pageNum = pages.indexOf(page) + 1;
  if (page.isSectionCover) {
    return `<div class="section-cover-title">${escapeHtml(page.coverTitle)}</div><div class="page-footer">${pageNum}</div>`;
  }
  return `${page.headerHtml}<div class="page-body">${page.bodyHtml}</div><div class="page-footer">${pageNum}</div>`;
}

function renderPageSlot(contentId, page) {
  const el = document.getElementById(contentId);
  if (!page) {
    el.innerHTML = '<div class="page-blank">&middot; end of entries &middot;</div>';
    return;
  }
  el.innerHTML = buildPageHTML(page);
  const body = el.querySelector('.page-body');
  if (body) {
    requestAnimationFrame(() => {
      // The real page is only at its paginated (--book-w) size once the
      // book is actually open; checking while closed/narrow compares
      // against the wrong width and false-positives.
      if (!book.classList.contains('wide')) return;
      if (body.scrollHeight > body.clientHeight + 1) {
        body.classList.add('overflowing');
        console.warn(`"${page.filename}" still overflows after pagination — a single block (e.g. a long debts/further-studies note) may be too tall for one page.`);
      }
    });
  }
}

/* A section's marker is affixed to its title page. Most of the time it
   just touches the book -- a sliver visible at the edge, right ("ahead of
   you", the default) if that page hasn't been reached yet, left ("already
   read") once you've turned past it. While that title page is actually
   part of the spread on screen, its marker instead comes forward and
   reaches into whichever slot (left or right) the page landed in, so it
   visibly rests on the page rather than just touching its edge. */
function tabPositionState(section) {
  const firstIndex = pages.findIndex(p => p.type === section.key);
  if (firstIndex === -1) return null;
  if (firstIndex === spreadStart) return 'current-left';
  if (firstIndex === spreadStart + 1) return 'current-right';
  if (firstIndex < spreadStart) return 'left';
  return 'right';
}

function updateTabPositions() {
  SECTIONS.forEach(section => {
    const state = tabPositionState(section);
    if (!state) return;
    const tab = sectionTabsEl.querySelector(`.section-tab[data-section="${section.key}"]`);
    const label = sectionLabelsEl.querySelector(`.section-label[data-section="${section.key}"]`);
    if (tab) {
      tab.classList.toggle('tab-left', state === 'left');
      tab.classList.toggle('tab-right', state === 'right');
      tab.classList.toggle('tab-current-left', state === 'current-left');
      tab.classList.toggle('tab-current-right', state === 'current-right');
    }
    if (label) {
      const onLeft = state === 'left' || state === 'current-left';
      label.classList.toggle('label-left', onLeft);
      label.classList.toggle('label-right', !onLeft);
    }
  });
}

function updateCounter() {
  const total = pages.length;
  if (!total) { counterEl.textContent = ''; return; }
  const a = Math.min(spreadStart + 1, total);
  const b = Math.min(spreadStart + 2, total);
  counterEl.textContent = `${a}–${b} of ${total}`;
}

function renderSpread() {
  renderPageSlot('pageContentL', pages[spreadStart]);
  renderPageSlot('pageContentR', pages[spreadStart + 1]);
  updateTabPositions();
  updateCounter();
  prevBtn.disabled = spreadStart <= 0;
  nextBtn.disabled = spreadStart + 2 >= pages.length;
}

function jumpToSection(firstIndex) {
  spreadStart = Math.floor(firstIndex / 2) * 2;
  if (!isOpen) setOpen(true);
  renderSpread();
}

function buildSectionTabs() {
  sectionTabsEl.innerHTML = '';
  sectionLabelsEl.innerHTML = '';
  SECTIONS.forEach((section, index) => {
    const firstIndex = pages.findIndex(p => p.type === section.key);
    if (firstIndex === -1) return;
    const top = `${TAB_SLOT_TOP + index * TAB_SLOT_GAP}px`;

    const tab = document.createElement('div');
    tab.className = 'section-tab';
    tab.dataset.section = section.key;
    tab.style.top = top;
    tab.style.background = section.tabColor;
    tab.addEventListener('click', (evt) => { evt.stopPropagation(); jumpToSection(firstIndex); });
    sectionTabsEl.appendChild(tab);

    const label = document.createElement('div');
    label.className = 'section-label';
    label.dataset.section = section.key;
    label.style.top = top;
    label.textContent = section.label;
    label.addEventListener('click', (evt) => { evt.stopPropagation(); jumpToSection(firstIndex); });
    sectionLabelsEl.appendChild(label);
  });
}

/* ---------- open / close, navigation ---------- */

function setOpen(open) {
  isOpen = open;
  toggleBtn.textContent = open ? 'Close book' : 'Open book';
  prevBtn.style.visibility = open ? 'visible' : 'hidden';
  nextBtn.style.visibility = open ? 'visible' : 'hidden';
  counterEl.style.visibility = open ? 'visible' : 'hidden';
  book.classList.toggle('open', open);

  // The width itself never animates (see .book / .book.wide in styles.css)
  // -- it snaps instantly, timed to land exactly when the cover has
  // rotated out of view and the spread is revealing (opening), or once
  // the spread has finished fading out (closing), so the box is never
  // caught visibly stretching mid-transition.
  clearTimeout(widthTimer);
  widthTimer = setTimeout(() => book.classList.toggle('wide', open), open ? 800 : 200);
}

/* ---------- page-turn animation ---------- */

let flipping = false;

/* Clones the page on the hinge side of the turn into a flap that sits on
   top of the real spread and flips it over on the gutter like a real page.
   Its front face is a clone of what's there now; its back face is the
   *actual* page that's about to be revealed -- same as a real book, where
   the back of the leaf you're turning is the next page -- rendered fresh
   rather than blank, so it visibly lands as the new page instead of a
   blank verso. The real spread underneath isn't touched until the flap
   has *completely* finished rotating (transitionend), so nothing peeks
   through mid-turn: what's visible during the animation is only ever the
   flap itself (old content up front, new content once it's rotated past
   the halfway point) laid over an unchanged spread. */
function flipPage(direction, newSpreadStart) {
  if (flipping) return;
  flipping = true;

  const isNext = direction === 'next';
  const sourceEl = document.getElementById(isNext ? 'pageRight' : 'pageLeft');

  const front = sourceEl.cloneNode(true);
  front.removeAttribute('id');
  front.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  front.classList.add('flap-face', 'flap-face-front');
  // canvases don't carry their drawn pixels over via cloneNode
  const sourceCanvases = sourceEl.querySelectorAll('canvas');
  front.querySelectorAll('canvas').forEach((dst, i) => {
    const src = sourceCanvases[i];
    dst.width = src.width;
    dst.height = src.height;
    dst.getContext('2d').drawImage(src, 0, 0);
  });

  // rotating -180deg around a hinge at the gutter lands this flap exactly
  // over the *other* slot, so its back face should hold whatever page
  // will end up there.
  const backPage = isNext ? pages[newSpreadStart] : pages[newSpreadStart + 1];
  const back = document.createElement('div');
  back.className = `page ${isNext ? 'page-left' : 'page-right'} flap-face flap-face-back`;
  const backContent = document.createElement('div');
  backContent.className = 'page-content';
  backContent.innerHTML = backPage
    ? buildPageHTML(backPage)
    : '<div class="page-blank">&middot; end of entries &middot;</div>';
  back.appendChild(backContent);

  const flap = document.createElement('div');
  flap.className = `page-flap ${isNext ? 'flap-right' : 'flap-left'}`;
  flap.append(front, back);
  book.appendChild(flap);

  requestAnimationFrame(() => flap.classList.add('flap-turning'));
  flap.addEventListener('transitionend', () => {
    spreadStart = newSpreadStart;
    renderSpread();
    flap.remove();
    flipping = false;
  }, { once: true });
}

coverEl.addEventListener('click', () => { if (ready) setOpen(true); });
toggleBtn.addEventListener('click', () => { if (ready) setOpen(!isOpen); });
prevBtn.addEventListener('click', () => {
  if (spreadStart - 2 >= 0) flipPage('prev', spreadStart - 2);
});
nextBtn.addEventListener('click', () => {
  if (spreadStart + 2 < pages.length) flipPage('next', spreadStart + 2);
});

/* ---------- texture painting (leather + paper grain) ---------- */

function seedRandom(seed) {
  let s = seed;
  return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function paintNoise(canvasId, opts) {
  const c = document.getElementById(canvasId);
  if (!c) return;
  const parent = c.parentElement;
  const w = parent.clientWidth || 400;
  const h = parent.clientHeight || 400;
  c.width = w; c.height = h;
  c.style.width = '100%'; c.style.height = '100%';
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const rand = seedRandom(opts.seed || 1);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(rand() * 255);
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v;
    img.data[i + 3] = opts.alpha || 40;
  }
  ctx.putImageData(img, 0, 0);
}

function paintScuff(canvasId, seed) {
  const c = document.getElementById(canvasId);
  if (!c) return;
  const parent = c.parentElement;
  const w = parent.clientWidth || 400;
  const h = parent.clientHeight || 400;
  c.width = w; c.height = h;
  c.style.width = '100%'; c.style.height = '100%';
  const ctx = c.getContext('2d');
  const rand = seedRandom(seed);
  for (let i = 0; i < 26; i++) {
    const x = rand() * w, y = rand() * h, r = 20 + rand() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rand() > 0.5;
    g.addColorStop(0, light ? 'rgba(255,240,210,0.18)' : 'rgba(0,0,0,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

function paintAllTextures() {
  paintNoise('leatherGrain', { seed: 7, alpha: 55 });
  paintScuff('leatherScuff', 11);
  paintNoise('pageGrainL', { seed: 21, alpha: 14 });
  paintNoise('pageGrainR', { seed: 22, alpha: 14 });
}

/* ---------- init ---------- */

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* A backgrounded/not-yet-visible tab can leave the offscreen measurer with
   a real 0x0 layout box (the renderer skips work it doesn't need to paint
   yet), which would make every page look "too tall" and blow the whole
   book up into one word per page. Give the browser a bit of room to lay
   it out for real before trusting any measurement -- bounded, so a tab
   that never becomes visible doesn't hang init() forever. */
function waitForMeasurableLayout(maxAttempts = 20, intervalMs = 50) {
  return new Promise(resolve => {
    let attempts = 0;
    (function check() {
      const r = measureBodyEl.getBoundingClientRect();
      if ((r.width > 0 && r.height > 0) || attempts >= maxAttempts) { resolve(); return; }
      attempts++;
      setTimeout(check, intervalMs);
    })();
  });
}

async function init() {
  const [bookConfig, resultsBySection, covers] = await Promise.all([
    loadBookConfig(),
    Promise.all(SECTIONS.map(loadSection)),
    Promise.all(SECTIONS.map(loadSectionCover))
  ]);
  applyBookConfig(bookConfig);
  allResultsBySection = resultsBySection;
  sectionCovers = covers;
  await preloadImages(allResultsBySection.flat());
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (err) { /* font loading state unavailable; proceed with current metrics */ }
  }
  await waitForMeasurableLayout();
  paginateAllSections(allResultsBySection, sectionCovers);
  buildSectionTabs();
  renderSpread();
  paintAllTextures();
  ready = true;
  if (coverHintEl) coverHintEl.textContent = pages.length ? 'Click to open' : 'No entries found';
}

function repaginate() {
  if (!ready) return;
  const currentFilename = pages[spreadStart] ? pages[spreadStart].filename : null;
  paginateAllSections(allResultsBySection, sectionCovers);
  buildSectionTabs();
  const idx = currentFilename ? pages.findIndex(p => p.filename === currentFilename) : -1;
  spreadStart = idx === -1 ? 0 : Math.floor(idx / 2) * 2;
  renderSpread();
}

if (coverHintEl) coverHintEl.textContent = 'Loading…';
setOpen(false);
init();
window.addEventListener('resize', debounce(() => { repaginate(); paintAllTextures(); }, 200));
// Safety net for the rarer case: a tab that's still hidden well past
// waitForMeasurableLayout()'s budget (e.g. opened in the background and
// left there) finishes init() against a real but still-wrong measurement.
// Once it's actually shown, repaginate for real.
document.addEventListener('visibilitychange', () => { if (ready && !document.hidden) repaginate(); });
