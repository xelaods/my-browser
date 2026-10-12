// 新しいタブ（Ctrl+T）とコマンドバー（Ctrl+K）
const $ = id => document.getElementById(id);
const q = $('q');
const list = $('list');
let state = null;   // { mode, private }
let items = [];
let sel = 0;
let seq = 0;
let itemsFor = null; // 今の候補がどの入力のものか

const ICONS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
  star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  book: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3.5L6 20V5a1 1 0 0 1 1-1z"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  tab: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 9h7V5"/>',
  split: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M12 5v14"/>',
  mask: '<path d="M3 11h18"/><path d="M6 11l1.6-5.2a1 1 0 0 1 1-.7h6.8a1 1 0 0 1 1 .7L18 11"/><circle cx="8" cy="16" r="2.6"/><circle cx="16" cy="16" r="2.6"/><path d="M10.6 16h2.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h13M13 6l6 6-6 6"/>',
};
const svg = name => `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const host = url => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname : '') : url; } catch { return url || ''; } };

function show(p) {
  state = p;
  document.body.classList.toggle('show', !!p);
  if (!p) { q.value = ''; items = []; itemsFor = null; list.innerHTML = ''; return; }
  const chip = $('chip');
  chip.className = '';
  chip.innerHTML = '';
  if (p.private) { chip.className = 'on private'; chip.innerHTML = svg('mask'); chip.append(t('common.privateTab')); }
  else if (p.mode === 'split') { chip.className = 'on'; chip.innerHTML = svg('split'); chip.append(t('pal.splitChip')); }
  else if (p.mode === 'command') { chip.className = 'on'; chip.append(t('pal.commandChip')); }
  else { chip.className = 'on'; chip.innerHTML = svg('plus'); chip.append(t('common.newTab')); }
  q.placeholder = t(p.mode === 'command' ? 'pal.placeholderCommand' : p.mode === 'split' ? 'pal.placeholderSplit' : 'pal.placeholder');
  q.value = p.text || '';
  refresh();
  q.focus();
  q.select();
}

async function refresh() {
  const my = ++seq;
  const text = q.value;
  const r = await browser.paletteQuery(text, state?.mode || 'new');
  if (my !== seq || !state) return;
  items = r || [];
  itemsFor = text;
  sel = 0;
  render();
}

function hintFor(it) {
  if (it.kind === 'tab') return t(state.mode === 'split' ? 'pal.putBeside' : 'pal.switchTab');
  if (it.kind === 'search') return t('pal.searchWith', { engine: it.engine });
  if (it.kind === 'url') return t('pal.openUrl');
  if (it.kind === 'cmd') return '';
  if (state.mode === 'split') return t('pal.putBeside');
  return state.mode === 'command' ? t('pal.openHere') : t('pal.openNew');
}

function iconFor(it) {
  const box = el('span', 'ic');
  const fallback = { search: 'search', url: 'globe', favorite: 'star', history: 'clock', bookmark: 'book', cmd: 'bolt', tab: it.split ? 'split' : 'tab' }[it.kind] || 'globe';
  if (it.kind === 'tab' && it.private) { box.innerHTML = svg('mask'); return box; }
  if (it.favicon) {
    const img = new Image();
    img.src = it.favicon;
    img.onerror = () => { box.innerHTML = svg(fallback); };
    box.append(img);
  } else box.innerHTML = svg(fallback);
  return box;
}

const GROUPS = { tab: 'pal.groupTabs', favorite: 'pal.groupFavorites', bookmark: 'pal.groupBookmarks', history: 'pal.groupHistory', cmd: 'pal.groupCommands' };

function render() {
  list.innerHTML = '';
  let lastGroup = '';
  items.forEach((it, i) => {
    const g = GROUPS[it.kind] || '';
    if (g && g !== lastGroup) list.append(el('div', 'group', t(g)));
    lastGroup = g;
    const row = el('div', 'row' + (i === sel ? ' sel' : ''));
    row.append(iconFor(it));
    if (it.kind === 'search') row.append(el('span', 't', it.title), el('span', 'u', ''));
    else if (it.kind === 'url') row.append(el('span', 't', it.url), el('span', 'u', ''));
    else if (it.kind === 'cmd') row.append(el('span', 't', it.title), el('span', 'u', ''));
    else row.append(el('span', 't', it.title || it.url), el('span', 'u', it.folder ? it.folder + ' · ' + host(it.url) : host(it.url)));
    if (it.kind === 'cmd' && it.keys) { const k = el('span', 'hint'); k.append(el('kbd', '', it.keys)); row.append(k); }
    const h = hintFor(it);
    if (h) row.append(el('span', 'hint go', h + '  ↵'));
    row.addEventListener('mousemove', () => { if (sel !== i) { sel = i; mark(); } });
    row.addEventListener('mousedown', e => { e.preventDefault(); run(it, e.shiftKey); });
    list.append(row);
  });
}
function mark() {
  list.querySelectorAll('.row').forEach((r, i) => r.classList.toggle('sel', i === sel));
  list.querySelectorAll('.row')[sel]?.scrollIntoView({ block: 'nearest' });
}

function run(it, split) {
  const item = it || (q.value.trim() ? { kind: 'input', text: q.value } : null);
  if (!item) return;
  browser.paletteRun(item, { split: !!split });
}

let timer = null;
q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refresh, 40); });
q.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); if (items.length) { sel = (sel + 1) % items.length; mark(); } }
  else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); if (items.length) { sel = (sel - 1 + items.length) % items.length; mark(); } }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (e.isComposing) return;
    // 入力した直後で候補がまだ届いていないときは、入力したものをそのまま開く
    const fresh = itemsFor === q.value ? items[sel] : null;
    run(fresh || null, e.shiftKey);
  } else if (e.key === 'Escape') { e.preventDefault(); browser.paletteClose(); }
});
$('dim').addEventListener('mousedown', () => browser.paletteClose());
browser.onPalette(show);
