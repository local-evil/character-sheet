/* -------------------------------------------------------------------
   Book of Eldrin Vane — data-driven book renderer
   Sections are configured below. Each section folder needs a
   manifest.json (an ordered array of filenames) plus one JSON file
   per entry. See the README and each folder's _template.json for
   the exact fields expected.
------------------------------------------------------------------- */

const SECTIONS = [
  { key: 'travels',  label: 'Travels',  folder: 'data/travels' },
  { key: 'research', label: 'Research', folder: 'data/research' },
  { key: 'others',   label: 'Others',   folder: 'data/others' }
];

let pages = [];
let spreadStart = 0;
let isOpen = false;
let ready = false;

const book = document.getElementById('book');
const coverEl = document.getElementById('coverEl');
const toggleBtn = document.getElementById('toggleBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const counterEl = document.getElementById('counter');
const thumbTabsEl = document.getElementById('thumbTabs');
const coverHintEl = document.querySelector('.cover-hint');

/* ---------- helpers ---------- */

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function paragraphs(text) {
  if (!text) return '';
  return text
    .split(/\n{2,}/)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
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

/* ---------- page templates ---------- */

function travelsHTML(d) {
  return `
    <div class="page-eyebrow">Travels</div>
    <div class="page-meta">${escapeHtml(d.date)}</div>
    <div class="page-divider"></div>
    <div class="page-body">${paragraphs(d.text)}</div>
  `;
}

function researchHTML(d) {
  return `
    <div class="page-eyebrow">Research</div>
    <h2 class="page-title">${escapeHtml(d.title || 'Untitled')}</h2>
    <div class="page-meta">${escapeHtml(d.date)}</div>
    <div class="page-divider"></div>
    <div class="page-body">${paragraphs(d.text)}</div>
    ${d.furtherStudies ? `<div class="page-bottom">
      <div class="page-bottom-label">Further studies</div>
      <div class="page-bottom-text">${escapeHtml(d.furtherStudies)}</div>
    </div>` : ''}
  `;
}

function othersHTML(d) {
  const initials = (d.name || '?')
    .split(' ')
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();

  const debtsBlock = d.debts ? `<div class="page-bottom">
      <div class="page-bottom-label">Debts</div>
      <div class="page-bottom-text">${escapeHtml(d.debts)}</div>
    </div>` : '';

  if (d.continued) {
    return `
      <div class="page-eyebrow">Others &mdash; continued</div>
      <h2 class="page-title">${escapeHtml(d.name || '')}</h2>
      <div class="page-divider"></div>
      <div class="page-body">${paragraphs(d.notes)}</div>
      ${debtsBlock}
    `;
  }

  return `
    <div class="page-eyebrow">Others</div>
    <div class="rel-head">
      <div class="avatar">${initials}</div>
      <div>
        <h2 class="page-title">${escapeHtml(d.name || 'Unnamed')}</h2>
        ${d.status ? `<span class="page-tag">${escapeHtml(d.status)}</span>` : ''}
      </div>
    </div>
    <div class="page-divider"></div>
    <div class="page-body">${paragraphs(d.notes)}</div>
    ${debtsBlock}
  `;
}

function buildPageHTML(page) {
  let inner;
  if (page.type === 'travels') inner = travelsHTML(page.data);
  else if (page.type === 'research') inner = researchHTML(page.data);
  else inner = othersHTML(page.data);
  const pageNum = pages.indexOf(page) + 1;
  return inner + `<div class="page-footer">${pageNum}</div>`;
}

/* ---------- rendering ---------- */

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
      if (body.scrollHeight > body.clientHeight + 1) {
        body.classList.add('overflowing');
        console.warn(
          `"${page.filename}" overflows its page. This text does not auto-flow — ` +
          `split the remainder into a new entry file (for Others, set "continued": true on the follow-up file).`
        );
      }
    });
  }
}

function updateActiveTab() {
  const current = pages[spreadStart] || pages[spreadStart - 1];
  document.querySelectorAll('.thumb-tab').forEach(tab => {
    tab.classList.toggle('active', !!current && tab.dataset.section === current.type);
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
  updateActiveTab();
  updateCounter();
  prevBtn.disabled = spreadStart <= 0;
  nextBtn.disabled = spreadStart + 2 >= pages.length;
}

function buildThumbTabs(resultsBySection) {
  thumbTabsEl.innerHTML = '';
  let cursor = 0;
  SECTIONS.forEach((section, i) => {
    const count = resultsBySection[i].length;
    const firstIndex = cursor;
    cursor += count;
    if (count === 0) return;
    const tab = document.createElement('div');
    tab.className = 'thumb-tab';
    tab.textContent = section.label;
    tab.dataset.section = section.key;
    tab.addEventListener('click', (evt) => {
      evt.stopPropagation();
      spreadStart = Math.floor(firstIndex / 2) * 2;
      if (!isOpen) setOpen(true);
      renderSpread();
    });
    thumbTabsEl.appendChild(tab);
  });
}

/* ---------- open / close, navigation ---------- */

function setOpen(open) {
  isOpen = open;
  toggleBtn.textContent = open ? 'Close book' : 'Open book';
  prevBtn.style.visibility = open ? 'visible' : 'hidden';
  nextBtn.style.visibility = open ? 'visible' : 'hidden';
  counterEl.style.visibility = open ? 'visible' : 'hidden';
  book.classList.toggle('wide', open);
  book.classList.toggle('open', open);
}

coverEl.addEventListener('click', () => { if (ready) setOpen(true); });
toggleBtn.addEventListener('click', () => { if (ready) setOpen(!isOpen); });
prevBtn.addEventListener('click', () => { if (spreadStart - 2 >= 0) { spreadStart -= 2; renderSpread(); } });
nextBtn.addEventListener('click', () => { if (spreadStart + 2 < pages.length) { spreadStart += 2; renderSpread(); } });

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

async function init() {
  const resultsBySection = await Promise.all(SECTIONS.map(loadSection));
  pages = resultsBySection.flat();
  buildThumbTabs(resultsBySection);
  renderSpread();
  paintAllTextures();
  ready = true;
  if (coverHintEl) coverHintEl.textContent = pages.length ? 'Click to open' : 'No entries found';
}

if (coverHintEl) coverHintEl.textContent = 'Loading…';
setOpen(false);
init();
window.addEventListener('resize', paintAllTextures);
