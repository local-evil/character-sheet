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
  { key: 'others',   label: 'Others',   folder: 'data/others',   tabColor: 'linear-gradient(160deg, #eecf87 0%, #c9a24a 55%, #a6812f 100%)', tabDark: true }
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
let widthTimer = null;

const book = document.getElementById('book');
const coverEl = document.getElementById('coverEl');
const toggleBtn = document.getElementById('toggleBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const counterEl = document.getElementById('counter');
const sectionTabsEl = document.getElementById('sectionTabs');
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

/* Binary-searches how many words of a too-tall paragraph fit on an empty
   page, using the real measurer so it accounts for the active font/width. */
function splitOversizedParagraph(text, fits) {
  const words = text.split(/\s+/);
  let lo = 1, hi = words.length, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(formatParagraph(words.slice(0, mid).join(' ')))) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (best === 0) best = 1; // always make forward progress, even if one word overflows
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
      if (idx > 0) break; // later blocks carry over to the next page as-is

      // the very first block on an empty page is already too tall on its own
      if (block.kind === 'p') {
        const { fitText, remainderText } = splitOversizedParagraph(block.text, html => {
          measureBodyEl.innerHTML = html;
          return measureBodyEl.scrollHeight <= measureBodyEl.clientHeight + 1;
        });
        accHtml = formatParagraph(fitText);
        fitCount = 1;
        if (remainderText) splitRemainderBlock = { kind: 'p', text: remainderText };
      } else {
        accHtml = candidateHtml; // atomic block (e.g. a huge debts note) — accept the overflow rather than loop forever
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

function paginateAllSections(resultsBySection) {
  pages = [];
  resultsBySection.forEach(entries => {
    entries.forEach(entry => { pages.push(...paginateEntry(entry)); });
  });
}

/* ---------- rendering ---------- */

function buildPageHTML(page) {
  const pageNum = pages.indexOf(page) + 1;
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

/* A section's index tab is affixed to the page that starts it. It hangs
   off the book's right edge (ahead of you, waiting to be reached -- the
   default state right after opening the book) until you've turned past
   that page, then sits on the left (already read). Nothing else about it
   changes: no vertical movement, no distinction between "on the current
   spread" and "buried under other pages" the way the earlier ribbon
   design had. */
function tabIsPastSection(section) {
  const firstIndex = pages.findIndex(p => p.type === section.key);
  if (firstIndex === -1) return null;
  return spreadStart > firstIndex;
}

function updateTabPositions() {
  document.querySelectorAll('.section-tab').forEach(tab => {
    const section = SECTIONS.find(s => s.key === tab.dataset.section);
    const past = tabIsPastSection(section);
    if (past !== null) tab.classList.toggle('tab-left', past);
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

function buildSectionTabs() {
  sectionTabsEl.innerHTML = '';
  SECTIONS.forEach((section, index) => {
    const firstIndex = pages.findIndex(p => p.type === section.key);
    if (firstIndex === -1) return;
    const tab = document.createElement('div');
    tab.className = 'section-tab' + (section.tabDark ? ' section-tab-dark' : '');
    tab.dataset.section = section.key;
    tab.style.top = `${TAB_SLOT_TOP + index * TAB_SLOT_GAP}px`;
    tab.style.background = section.tabColor;
    tab.textContent = section.label;
    tab.addEventListener('click', (evt) => {
      evt.stopPropagation();
      spreadStart = Math.floor(firstIndex / 2) * 2;
      if (!isOpen) setOpen(true);
      renderSpread();
    });
    sectionTabsEl.appendChild(tab);
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

/* Clones the page currently on the hinge side of the turn into a flap that
   sits on top of the real spread and flips it over on the gutter like a
   real page. The flap has two faces (see .flap-face in styles.css) so it
   visibly lands showing its (blank) back once turned, rather than just
   vanishing -- the real spread's content underneath is swapped in
   immediately, hidden by the flap, so it's already showing the new page by
   the time the flap finishes rotating and is removed. */
function flipPage(direction, applyUpdate) {
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

  const back = document.createElement('div');
  back.className = 'page flap-face flap-face-back';

  const flap = document.createElement('div');
  flap.className = `page-flap ${isNext ? 'flap-right' : 'flap-left'}`;
  flap.append(front, back);
  book.appendChild(flap);

  applyUpdate();

  requestAnimationFrame(() => flap.classList.add('flap-turning'));
  flap.addEventListener('transitionend', () => flap.remove(), { once: true });
}

coverEl.addEventListener('click', () => { if (ready) setOpen(true); });
toggleBtn.addEventListener('click', () => { if (ready) setOpen(!isOpen); });
prevBtn.addEventListener('click', () => {
  if (spreadStart - 2 >= 0) flipPage('prev', () => { spreadStart -= 2; renderSpread(); });
});
nextBtn.addEventListener('click', () => {
  if (spreadStart + 2 < pages.length) flipPage('next', () => { spreadStart += 2; renderSpread(); });
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

async function init() {
  allResultsBySection = await Promise.all(SECTIONS.map(loadSection));
  await preloadImages(allResultsBySection.flat());
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (err) { /* font loading state unavailable; proceed with current metrics */ }
  }
  paginateAllSections(allResultsBySection);
  buildSectionTabs();
  renderSpread();
  paintAllTextures();
  ready = true;
  if (coverHintEl) coverHintEl.textContent = pages.length ? 'Click to open' : 'No entries found';
}

function repaginate() {
  if (!ready) return;
  const currentFilename = pages[spreadStart] ? pages[spreadStart].filename : null;
  paginateAllSections(allResultsBySection);
  buildSectionTabs();
  const idx = currentFilename ? pages.findIndex(p => p.filename === currentFilename) : -1;
  spreadStart = idx === -1 ? 0 : Math.floor(idx / 2) * 2;
  renderSpread();
}

if (coverHintEl) coverHintEl.textContent = 'Loading…';
setOpen(false);
init();
window.addEventListener('resize', debounce(() => { repaginate(); paintAllTextures(); }, 200));
