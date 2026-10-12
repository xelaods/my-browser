const $ = id => document.getElementById(id);
const address = $('address');
let lastState = null;
let lastLayout = null;
let drag = null; // { kind: 'tab' | 'fav', id }

const SVG_CLOSE = '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>';
const SVG_PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
const SVG_PRIVATE = '<svg class="private-icon" viewBox="0 0 24 24"><path d="M3 11h18"/><path d="M6 11l1.6-5.2a1 1 0 0 1 1-.7h6.8a1 1 0 0 1 1 .7L18 11"/><circle cx="8" cy="16" r="2.6"/><circle cx="16" cy="16" r="2.6"/><path d="M10.6 16h2.8"/></svg>';
const SVG_AUDIO = '<svg class="audio" viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';

// ---- ボタン ----
$('toggle-sidebar').onclick = () => browser.toggleSidebar();
$('back').onclick = () => browser.back();
$('forward').onclick = () => browser.forward();
$('reload').onclick = () => browser.reload();
$('win-min').onclick = () => browser.minimize();
$('win-max').onclick = () => browser.maximize();
$('win-close').onclick = () => browser.close();
$('new').onclick = () => browser.openPalette('new');
$('new').oncontextmenu = e => { e.preventDefault(); browser.newTabMenu(); };
$('clear').onclick = () => browser.clearTabs();
$('new-folder').onclick = () => browser.folderCreate();
$('ai-toggle').onclick = () => browser.toggleSide();
$('settings').onclick = () => browser.openSettings();

// ---- URL欄（普段はドメインだけ、クリックでURL全体） ----
const omni = $('omni');
function shortUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.protocol.startsWith('http') ? u.hostname.replace(/^www\./, '') : url;
  } catch { return url; }
}
const showAddress = () => {
  if (document.activeElement === address || !lastState) return;
  address.value = lastState.activeUrl ? shortUrl(lastState.activeUrl) : '';
  address.placeholder = t(lastState.activePrivate ? 'bar.addressPrivate' : 'bar.address');
};

// 候補（検索・お気に入り・履歴）。上下キーで選んで Enter
let sugg = { items: [], sel: -1, q: '' };
let picking = false;
function suggestAnchor() {
  const w = Math.max(340, Math.min(window.innerWidth - 640, 520));
  const r = omni.getBoundingClientRect();
  return { x: Math.round((window.innerWidth - w) / 2), y: Math.round(r.bottom + 4), width: w };
}
async function updateSuggestions() {
  const q = address.value;
  sugg.q = q;
  sugg.arrowed = false;
  const items = q.trim() ? await browser.suggest(q) : [];
  if (sugg.q !== q || document.activeElement !== address) return; // 入力が進んでいたら捨てる
  sugg.items = items;
  sugg.sel = items.length ? 0 : -1;
  if (items.length) browser.suggestShow(items, sugg.sel, suggestAnchor());
  else browser.closePopup();
}
function moveSelection(step) {
  if (!sugg.items.length) return;
  sugg.sel = (sugg.sel + step + sugg.items.length) % sugg.items.length;
  sugg.arrowed = true;
  const it = sugg.items[sugg.sel];
  address.value = it.kind === 'search' ? it.title : it.url;
  browser.suggestShow(sugg.items, sugg.sel, suggestAnchor());
}

// 入力の途中で別のウィンドウに切り替えて戻ってきたときは、入力した文字をそのまま残す（Chrome と同じ）
let editing = false;
address.addEventListener('focus', () => {
  if (editing) return;
  address.value = lastState?.activeUrl || '';
  address.select();
  sugg = { items: [], sel: -1, q: '' };
});
address.addEventListener('blur', () => {
  if (editing && !document.hasFocus()) return; // ウィンドウごと切り替わっただけ
  editing = false;
  // 候補をクリックしたときに先に閉じないよう、少し待つ
  setTimeout(() => { if (document.activeElement !== address) browser.closePopup(); }, 160);
  showAddress();
});
address.addEventListener('input', () => { editing = true; updateSuggestions(); });
address.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
  if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
  if (e.key === 'Enter') {
    const it = sugg.items[sugg.sel];
    // 選んでいる候補があればそのURL、なければ入力そのまま
    if (it && (sugg.arrowed || sugg.q === address.value)) browser.pick(it.url);
    else browser.navigate(address.value);
    browser.closePopup();
    editing = false;
    address.blur();
  }
  if (e.key === 'Escape') {
    if (!sugg.items.length) editing = false;
    if (sugg.items.length) { sugg.items = []; browser.closePopup(); address.value = lastState?.activeUrl || ''; address.select(); }
    else address.blur();
  }
});
browser.onFocusUrl(() => address.focus());
browser.onUrlPicked(() => address.blur());

// 鍵マーク：サイト情報と権限
$('site').onclick = () => {
  const r = omni.getBoundingClientRect();
  browser.openPopup('site', { x: Math.round(r.left), y: Math.round(r.bottom + 6), width: 330 });
};
$('zoom').onclick = () => browser.zoomReset();
$('translate').onclick = () => browser.translateToggle();
// ボタンを押してもURL欄にフォーカスが移らないように（押した瞬間に欄が広がってずれるのを防ぐ）
for (const id of ['site', 'zoom', 'translate']) $(id).addEventListener('mousedown', e => e.preventDefault());

// ダウンロード
function openDownloads() {
  const r = $('downloads').getBoundingClientRect();
  browser.openPopup('downloads', { x: Math.round(r.right - 360), y: Math.round(r.bottom + 4), width: 360, align: 'right' });
}
$('downloads').onclick = openDownloads;
browser.onOpenDownloads(openDownloads);

// ---- レイアウト（main.js から） ----
browser.onLayout(l => {
  lastLayout = l;
  const s = document.body.style;
  s.setProperty('--sidebar-w', l.sidebarW + 'px');
  s.setProperty('--ai-w', l.aiW + 'px');
  s.setProperty('--gap', l.gap + 'px');
  s.setProperty('--title-h', l.titleH + 'px');
  s.setProperty('--ai-header', l.aiHeader + 'px');
  document.body.classList.toggle('collapsed', l.collapsed);
  document.body.classList.toggle('peeking', l.peeking);
  document.body.classList.toggle('ai-open', l.aiW > 0);
  $('win-max').title = t(l.maximized ? 'bar.restore' : 'bar.maximize');
  for (const [id, r] of [['page-frame', l.panes ? null : l.page], ['ai-frame', l.ai]]) {
    const f = $(id);
    f.style.display = r ? 'block' : 'none';
    if (r) Object.assign(f.style, { left: r.x - 1 + 'px', top: r.y - 1 + 'px', width: r.width + 2 + 'px', height: r.height + 2 + 'px' });
  }
  // 画面分割：ページごとに縁取り（選んでいるページは濃く）
  const pf = $('pane-frames');
  pf.innerHTML = '';
  for (const p of l.panes || []) {
    const f = document.createElement('div');
    f.className = 'frame' + (p.active ? ' active' : '');
    const d = p.active ? 2 : 1;
    Object.assign(f.style, { left: p.rect.x - d + 'px', top: p.rect.y - d + 'px', width: p.rect.width + d * 2 + 'px', height: p.rect.height + d * 2 + 'px' });
    pf.append(f);
  }
  // 境目のつまみ：サイドバーとページの間、ページとAIパネルの間
  const sh = $('sidebar-handle');
  sh.style.display = l.sidebarShown && !l.collapsed ? 'block' : 'none';
  sh.style.left = l.page.x - 8 + 'px';
  const ah = $('ai-handle');
  ah.style.display = l.ai ? 'block' : 'none';
  ah.style.left = l.page.x + l.page.width + 'px';
});

// ---- 幅の変更（つまみをドラッグ） ----
let resizeWhich = null;
for (const [id, which] of [['sidebar-handle', 'sidebar'], ['ai-handle', 'ai']]) {
  $(id).addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    resizeWhich = which;
    $(id).classList.add('active');
    browser.resizeStart(which);
  });
}
window.addEventListener('mousemove', e => {
  if (!resizeWhich) return;
  browser.resizeTo(resizeWhich === 'sidebar' ? e.clientX + 4 : e.clientX - 4);
});
window.addEventListener('mouseup', () => {
  if (!resizeWhich) return;
  resizeWhich = null;
  document.querySelectorAll('.handle.active').forEach(h => h.classList.remove('active'));
  browser.resizeEnd();
});
browser.onResizing(which => document.body.classList.toggle('resizing', !!which));
browser.onSettingsOpen(open => $('settings').classList.toggle('on', open));

// ---- アイコン ----
// 新しいタブのアイコン（「新」の文字の代わり）：検索窓のマーク
const SVG_NEWTAB = '<svg class="newtab-icon" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3.5"/><circle cx="11" cy="11.5" r="2.6"/><path d="M13 13.5l2.2 2.2"/></svg>';

function iconEl(item, cls = '') {
  if (item.loading) return Object.assign(document.createElement('span'), { className: 'spinner' });
  if (item.newtab) return Object.assign(document.createElement('span'), { innerHTML: SVG_NEWTAB }).firstChild;
  const fallback = () => {
    const f = document.createElement('span');
    f.className = 'fallback';
    f.textContent = (item.title || '?').trim().charAt(0).toUpperCase();
    return f;
  };
  if (!item.favicon) return fallback();
  const img = document.createElement('img');
  img.className = 'favicon ' + cls;
  img.src = item.favicon;
  img.onerror = () => img.replaceWith(fallback());
  return img;
}

function clearDropMarks() {
  document.querySelectorAll('.drop-before, .drop-after, .drop-end')
    .forEach(el => el.classList.remove('drop-before', 'drop-after', 'drop-end'));
}

// ---- お気に入り ----
function favEl(f) {
  const el = document.createElement('button');
  el.className = 'fav' + (f.active ? ' active' : '') + (f.open ? ' open' : '');
  el.title = `${f.title}\n${f.url}`;
  el.draggable = true;
  el.dataset.id = f.id;
  el.append(iconEl(f));
  el.onclick = () => browser.openFavorite(f.id);
  el.onauxclick = e => { if (e.button === 1) browser.removeFavorite(f.id); };
  el.oncontextmenu = e => { e.preventDefault(); browser.favoriteMenu(f.id); };
  el.ondragstart = e => {
    drag = { kind: 'fav', id: f.id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', f.url);
    requestAnimationFrame(() => el.classList.add('dragging'));
  };
  el.ondragend = () => { drag = null; clearDropMarks(); render(lastState); };
  el.ondragover = e => {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    clearDropMarks();
    el.classList.add('drop-before');
  };
  el.ondrop = e => {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    if (drag.kind === 'fav' && drag.id !== f.id) browser.moveFavorite(drag.id, f.id);
    if (drag.kind === 'tab') browser.tabToFavorite(drag.id, f.id);
    clearDropMarks();
  };
  return el;
}

const favBox = $('favorites');
favBox.addEventListener('dragover', e => {
  if (!drag) return;
  e.preventDefault();
  clearDropMarks();
  favBox.classList.add('drop-end');
});
favBox.addEventListener('dragleave', e => { if (!favBox.contains(e.relatedTarget)) favBox.classList.remove('drop-end'); });
favBox.addEventListener('drop', e => {
  if (!drag) return;
  e.preventDefault();
  if (drag.kind === 'tab') browser.tabToFavorite(drag.id, null);
  if (drag.kind === 'fav') browser.moveFavorite(drag.id, null);
  clearDropMarks();
});

// ---- タブ一覧 ----
function tabEl(t) {
  const el = document.createElement('div');
  el.className = 'tab' + (t.active ? ' active' : '') + (t.sleeping ? ' sleeping' : '') + (t.private ? ' private' : '');
  el.title = t.url ? `${t.title}\n${t.url}` : t.title;
  el.draggable = true;
  el.dataset.id = t.id;

  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = t.title;

  const close = document.createElement('button');
  close.className = 'close';
  close.title = window.t(t.pinned ? 'side.sleepPinned' : 'side.closeTab');
  close.innerHTML = SVG_CLOSE;
  close.onclick = e => { e.stopPropagation(); browser.closeTab(t.id); };

  const icon = t.private && !t.loading ? Object.assign(document.createElement('span'), { innerHTML: SVG_PRIVATE }).firstChild : iconEl(t);
  el.append(icon, title);
  if (t.audible) el.append(Object.assign(document.createElement('span'), { innerHTML: SVG_AUDIO }).firstChild);
  el.append(close);
  if (t.private) el.title = window.t('common.privateTab') + '\n' + el.title;
  el.onclick = () => browser.switchTab(t.id);
  el.onauxclick = e => { if (e.button === 1) browser.closeTab(t.id); }; // ホイールクリックで閉じる
  el.oncontextmenu = e => { e.preventDefault(); browser.tabMenu(t.id); };

  // ドラッグで並べ替え・固定・お気に入り
  el.ondragstart = e => {
    drag = { kind: 'tab', id: t.id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', t.url || t.title);
    requestAnimationFrame(() => el.classList.add('dragging'));
  };
  el.ondragend = () => { drag = null; clearDropMarks(); render(lastState); };
  el.ondragover = e => {
    if (drag?.kind !== 'tab') return;
    e.preventDefault();
    e.stopPropagation();
    clearDropMarks();
    const r = el.getBoundingClientRect();
    el.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  };
  el.ondrop = e => {
    if (drag?.kind !== 'tab') return;
    e.preventDefault();
    e.stopPropagation();
    const r = el.getBoundingClientRect();
    let target = e.clientY >= r.top + r.height / 2 ? el.nextElementSibling : el;
    while (target && Number(target.dataset.id) === drag.id) target = target.nextElementSibling;
    const beforeId = target?.dataset.id ? Number(target.dataset.id) : null;
    browser.moveTab(drag.id, beforeId, t.pinned, t.pinned ? (t.folderId || null) : null);
    clearDropMarks();
  };
  return el;
}

for (const list of [$('pinned'), $('today')]) {
  list.addEventListener('dragover', e => {
    if (drag?.kind !== 'tab') return;
    e.preventDefault();
    clearDropMarks();
    list.classList.add('drop-end');
  });
  list.addEventListener('dragleave', e => { if (!list.contains(e.relatedTarget)) list.classList.remove('drop-end'); });
  list.addEventListener('drop', e => {
    if (drag?.kind !== 'tab') return;
    e.preventDefault();
    browser.moveTab(drag.id, null, list.dataset.pinned === '1', null);
    clearDropMarks();
  });
}

// ---- 固定タブのフォルダ ----
const SVG_FOLDER = '<svg class="folder-icon" viewBox="0 0 24 24"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>';
const SVG_CHEVRON = '<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
function folderEl(f, children) {
  const box = document.createElement('div');
  box.className = 'folder' + (f.open ? ' open' : '');
  box.dataset.folder = f.id;
  const head = document.createElement('div');
  head.className = 'folder-head';
  head.innerHTML = SVG_CHEVRON + SVG_FOLDER;
  const name = document.createElement('span');
  name.className = 'title';
  name.textContent = f.name;
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = children.length || '';
  head.append(name, count);
  head.onclick = () => browser.folderToggle(f.id);
  head.oncontextmenu = e => { e.preventDefault(); browser.folderMenu(f.id); };
  head.ondblclick = e => { e.preventDefault(); renameFolder(f.id); };
  // タブをフォルダの見出しに落とすと、そのフォルダに入る
  head.ondragover = e => { if (drag?.kind !== 'tab') return; e.preventDefault(); e.stopPropagation(); clearDropMarks(); head.classList.add('drop-into'); };
  head.ondragleave = () => head.classList.remove('drop-into');
  head.ondrop = e => {
    if (drag?.kind !== 'tab') return;
    e.preventDefault(); e.stopPropagation();
    head.classList.remove('drop-into');
    browser.moveTab(drag.id, null, true, f.id);
    clearDropMarks();
  };
  const list = document.createElement('div');
  list.className = 'folder-tabs';
  // 閉じているときも、開いているタブだけは見えるようにする
  for (const c of children) if (f.open || c.classList.contains('active')) list.append(c);
  box.append(head, list);
  return box;
}
// フォルダの名前をその場で書き換える
function renameFolder(id) {
  if (document.querySelector('.folder-name')) return;
  const head = document.querySelector(`.folder[data-folder="${CSS.escape(id)}"] .folder-head .title`);
  if (!head) return;
  const input = document.createElement('input');
  input.className = 'folder-name';
  input.value = head.textContent;
  input.maxLength = 40;
  head.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = ok => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    input.remove(); // 描き直しを止めている入力欄を先に消す
    if (ok && name) browser.folderRename(id, name);
    render(lastState);
  };
  input.onkeydown = e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); };
  input.onblur = () => finish(true);
  input.onclick = e => e.stopPropagation();
}
browser.onFolderRename(id => setTimeout(() => renameFolder(id), 50));

// ---- プロフィール ----
function renderProfiles(state) {
  const box = $('profiles');
  box.innerHTML = '';
  for (const p of state.profiles) {
    const b = document.createElement('button');
    b.className = 'profile' + (p.id === state.profileId ? ' on' : '');
    b.textContent = p.name;
    b.title = t('side.profileTitle', { name: p.name });
    b.onclick = () => browser.switchProfile(p.id);
    b.oncontextmenu = e => { e.preventDefault(); browser.profileMenu(p.id); };
    box.append(b);
  }
  const add = document.createElement('button');
  add.className = 'profile-add';
  add.title = t('side.addProfile');
  add.innerHTML = SVG_PLUS;
  add.onclick = () => browser.addProfile();
  box.append(add);
  $('pinned-label').textContent = t('side.pinnedOf', { name: state.profiles.find(p => p.id === state.profileId)?.name || '' });
}

function render(state) {
  if (!state || drag) return; // ドラッグ中は描き直さない
  favBox.querySelectorAll('.fav').forEach(el => el.remove());
  for (const f of state.favorites) favBox.append(favEl(f));
  favBox.classList.toggle('has-favs', state.favorites.length > 0);

  const pinned = $('pinned');
  const today = $('today');
  if (pinned.querySelector('.folder-name')) return; // フォルダの名前を書き換えている間は描き直さない
  pinned.querySelectorAll('.tab, .folder').forEach(el => el.remove());
  today.innerHTML = '';
  // フォルダ（中の固定タブは、フォルダの中に並べる）
  const folders = state.folders || [];
  const inFolder = {};
  for (const f of folders) inFolder[f.id] = [];
  state.tabs.forEach((t, i) => {
    if (!t.pinned || !t.folderId || !inFolder[t.folderId]) return;
    inFolder[t.folderId].push(tabEl(t));
  });
  for (const f of folders) pinned.append(folderEl(f, inFolder[f.id]));
  state.tabs.forEach((t, i) => {
    if (t.pinned && t.folderId && inFolder[t.folderId]) return;
    const el = tabEl(t);
    if (t.split) {
      el.classList.add('split');
      el.append(Object.assign(document.createElement('span'), { className: 'rail' }));
      if (t.shown) el.classList.add('split-shown');
      if (state.tabs[i + 1]?.split === t.split) el.classList.add('split-next');
    }
    (t.pinned ? pinned : today).append(el);
  });
  pinned.classList.toggle('has-tabs', state.tabs.some(t => t.pinned) || folders.length > 0);

  renderProfiles(state);
  showAddress();
  omni.dataset.sec = state.security;
  omni.classList.toggle('private', state.activePrivate);
  omni.classList.toggle('zoomed', state.zoom !== 100);
  omni.dataset.tr = state.translate || '';
  $('translate').title = t(state.translate === 'on' ? 'tr.showOriginal' : state.translate === 'busy' ? 'tr.translating' : 'bar.translate');
  $('zoom').textContent = state.zoom + '%';
  const dl = $('downloads');
  dl.classList.toggle('has', state.downloads.count > 0);
  dl.classList.toggle('running', state.downloads.running > 0);
  dl.classList.toggle('indeterminate', state.downloads.progress < 0);
  dl.querySelector('.bar span').style.width = Math.round(Math.max(0, state.downloads.progress) * 100) + '%';
  dl.title = state.downloads.running ? t('bar.downloading', { n: state.downloads.running }) : t('bar.downloads');
  $('back').disabled = !state.canBack;
  $('forward').disabled = !state.canForward;
  $('ai-toggle').classList.toggle('on', state.sideOpen);
  $('ai-select').value = String(state.aiIndex);
  today.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

let lastActiveTab = null;
browser.onState(state => {
  lastState = state;
  render(state);
  const active = state.tabs.find(x => x.active)?.id ?? null;
  if (active !== lastActiveTab) { lastActiveTab = active; refreshExtSoon(); }
});

// ---- AIパネル ----
const status = $('ai-status');
const DEFAULT_STATUS = t('ai.hint');
let statusTimer;
function showStatus(msg) {
  status.textContent = msg;
  status.classList.add('ok');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    status.textContent = DEFAULT_STATUS;
    status.classList.remove('ok');
  }, 6000);
}
browser.onAIStatus(showStatus);

function run(prompt) {
  showStatus(t('ai.reading'));
  browser.aiAction(prompt);
}

(async () => {
  const config = await browser.getConfig();
  const select = $('ai-select');
  config.ai.forEach((name, i) => select.append(new Option(name, i)));
  select.append(new Option(t('aic.option'), -1)); // 内蔵AI（自分のAPIキー）
  if (lastState) select.value = String(lastState.aiIndex);
  select.onchange = () => browser.selectAI(Number(select.value));

  for (const p of config.prompts) {
    const b = document.createElement('button');
    b.textContent = p.label;
    b.title = p.text;
    b.onclick = () => run(p.text);
    $('prompts').append(b);
  }
})();

$('ai-open-tab').onclick = () => browser.openAIInTab();
$('ai-reload').onclick = () => browser.reloadAI();
$('ask').onsubmit = e => {
  e.preventDefault();
  const q = $('question').value.trim();
  if (!q) return;
  run(t('ai.questionPrompt', { q }));
  $('question').value = '';
};

// ---- 拡張機能のボタン（タイトルバー） ----
const extBox = $('ext-actions');
let extState = null;
let extTimer = null;
async function refreshExt() {
  try { extState = await browser.extState(); } catch { extState = null; }
  renderExt();
}
function refreshExtSoon() { clearTimeout(extTimer); extTimer = setTimeout(refreshExt, 60); }
function renderExt() {
  extBox.innerHTML = '';
  const actions = extState?.actions || [];
  extBox.classList.toggle('has', actions.length > 0);
  const tabId = extState?.activeTabId ?? -1;
  for (const a of actions) {
    const info = { ...((tabId > -1 && a.tabs && a.tabs[tabId]) || {}), ...a };
    const b = document.createElement('button');
    b.className = 'icon ext';
    b.title = typeof info.title === 'string' && info.title ? info.title : t('bar.extensions');
    const img = new Image();
    img.alt = '';
    img.onerror = () => { img.remove(); b.textContent = (b.title || '?').charAt(0).toUpperCase(); b.classList.add('letter'); };
    img.src = `crx://extension-icon/${encodeURIComponent(a.id)}/32/2?tabId=${tabId}&partition=_self${info.iconModified ? '&t=' + info.iconModified : ''}`;
    b.append(img);
    if (info.text) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = String(info.text).slice(0, 4);
      if (info.color) badge.style.background = info.color;
      b.append(badge);
    }
    const activate = e => {
      e.preventDefault();
      const r = b.getBoundingClientRect();
      browser.extActivate({
        eventType: e.type, extensionId: a.id, tabId, alignment: '',
        anchorRect: { x: r.left, y: r.top, width: r.width, height: r.height },
      });
    };
    b.onclick = activate;
    b.oncontextmenu = activate;
    extBox.append(b);
  }
}
browser.onExtUpdate(refreshExtSoon);
browser.extObserve().catch(() => {});
refreshExt();
