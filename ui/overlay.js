// ページ右上のカード（mode=stack）と、小さなポップアップ（mode=popup）
const mode = new URLSearchParams(location.search).get('mode');
const root = document.getElementById('root');
document.body.classList.add(mode === 'popup' ? 'popup' : 'stack');

const ICONS = {
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  close: '<path d="M7 7l10 10M17 7L7 17"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
  star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  warn: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10v4M12 16.8v.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>',
  cam: '<rect x="3.5" y="7" width="12" height="10" rx="2"/><path d="M15.5 10.5l5-3v9l-5-3"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  popup: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9h17"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16 7l2.5 2.5M14 9l2 2"/>',
  mask: '<path d="M3 11h18"/><path d="M6 11l1.6-5.2a1 1 0 0 1 1-.7h6.8a1 1 0 0 1 1 .7L18 11"/><circle cx="8" cy="16" r="2.6"/><circle cx="16" cy="16" r="2.6"/><path d="M10.6 16h2.8"/>',
};
const svg = name => `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function iconButton(name, title, onclick) {
  const b = el('button', 'icon-btn');
  b.innerHTML = svg(name);
  b.title = title;
  b.onclick = onclick;
  return b;
}
function pill(text, onclick, pri = false) {
  const b = el('button', 'pill' + (pri ? ' pri' : ''), text);
  b.onclick = onclick;
  return b;
}

// 表示した中身の大きさを main.js に伝える（ビューの大きさを合わせてもらう）
function report() {
  requestAnimationFrame(() => {
    const r = root.getBoundingClientRect();
    if (mode === 'popup') browser.popupSize(Math.ceil(r.width), root.children.length ? Math.ceil(r.height) : 0);
    else browser.overlaySize(root.children.length ? Math.ceil(r.height) : 0);
  });
}
new ResizeObserver(report).observe(root);

// =================== mode=stack ===================
let findBox = null;
let findInput = null;
let findCount = null;
let findTimer = null;

function buildFind() {
  findBox = el('div', 'card find');
  findInput = el('input');
  findInput.placeholder = t('find.placeholder');
  findInput.spellcheck = false;
  findCount = el('span', 'count', '');
  findInput.addEventListener('input', () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(() => browser.find(findInput.value, true, false), 80);
  });
  findInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); browser.find(findInput.value, !e.shiftKey, true); }
    if (e.key === 'Escape') { e.preventDefault(); browser.findClose(); }
  });
  findBox.append(
    findInput, findCount, el('span', 'sep'),
    iconButton('up', t('find.prev'), () => browser.find(findInput.value, false, true)),
    iconButton('down', t('find.next'), () => browser.find(findInput.value, true, true)),
    iconButton('close', t('common.closeEsc'), () => browser.findClose()),
  );
}

function noteCard(c) {
  const card = el('div', 'card note');
  const head = el('div', 'head');
  const badge = el('div', 'badge');
  const permIcon = { camera: 'cam', microphone: 'mic', geolocation: 'pin', notifications: 'bell' }[c.perm] || 'info';
  badge.innerHTML = svg(c.kind === 'permission' ? permIcon : { popup: 'popup', download: 'check', password: 'key' }[c.kind] || 'info');
  const grow = el('div', 'grow');
  grow.append(el('div', 'host ellipsis', c.host || ''), el('div', 'muted', c.text || ''));
  if (c.kind === 'password') grow.append(el('div', 'pw-user ellipsis', c.user || ''));
  if (c.kind === 'popup' && c.url) grow.append(el('div', 'faint ellipsis', c.url));
  head.append(badge, grow, iconButton('close', t('common.close'), () => browser.cardAction(c.id, c.kind === 'permission' ? 'deny' : 'dismiss')));
  card.append(head);
  const actions = el('div', 'actions');
  if (c.kind === 'permission') {
    actions.append(pill(t('common.block'), () => browser.cardAction(c.id, 'deny')), pill(t('common.allow'), () => browser.cardAction(c.id, 'allow'), true));
  } else if (c.kind === 'popup') {
    actions.append(pill(t('card.alwaysAllow'), () => browser.cardAction(c.id, 'always')), pill(t('common.open'), () => browser.cardAction(c.id, 'open'), true));
  } else if (c.kind === 'password') {
    actions.append(pill(t('card.pwNever'), () => browser.cardAction(c.id, 'never')), pill(t(c.update ? 'card.pwUpdateBtn' : 'card.pwSaveBtn'), () => browser.cardAction(c.id, 'save'), true));
  } else if (c.kind === 'download') {
    actions.append(pill(t('card.showInFolder'), () => browser.cardAction(c.id, 'show')), pill(t('common.open'), () => browser.cardAction(c.id, 'open'), true));
  }
  if (actions.children.length) card.append(actions);
  return card;
}

function renderStack({ find, cards }) {
  const hadFocus = document.activeElement === findInput;
  const wasShown = !!findBox && findBox.isConnected;
  root.innerHTML = '';
  if (find) {
    if (!findBox) buildFind();
    const n = find.matches || 0;
    findCount.textContent = findInput.value ? `${n ? find.index : 0}/${n}` : '';
    findCount.classList.toggle('none', !!findInput.value && n === 0);
    root.append(findBox);
    if (hadFocus || !wasShown) findInput.focus();
  } else if (findInput) {
    findInput.value = '';
  }
  for (const c of cards || []) root.append(noteCard(c));
  report();
}

// =================== mode=popup ===================
let popupState = { mode: null };

function favicon(url, fallback) {
  const span = el('span', 'ic');
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.onerror = () => { span.innerHTML = svg(fallback); };
    span.append(img);
  } else span.innerHTML = svg(fallback);
  return span;
}

function renderSuggest({ items, sel }, width) {
  const box = el('div', 'card suggest');
  box.style.width = (width || 420) + 'px';
  items.forEach((it, i) => {
    const row = el('div', 'sugg' + (i === sel ? ' sel' : ''));
    const icon = it.kind === 'search' ? 'search' : it.kind === 'url' ? 'globe' : it.kind === 'favorite' ? 'star' : 'clock';
    row.append(favicon(it.kind === 'favorite' ? it.favicon : '', icon));
    if (it.kind === 'search') {
      row.append(el('span', 't ellipsis', it.title), el('span', 'u ellipsis', t('sugg.search', { engine: it.engine })));
    } else if (it.kind === 'url') {
      row.append(el('span', 't ellipsis', it.url), el('span', 'u ellipsis', t('sugg.open')));
    } else {
      row.append(el('span', 't ellipsis', it.title || it.url), el('span', 'u ellipsis', it.url.replace(/^https?:\/\/(www\.)?/, '')));
    }
    // フォーカスがURL欄から外れる前に決める
    row.addEventListener('mousedown', e => { e.preventDefault(); browser.pick(it.url); });
    box.append(row);
  });
  return box;
}

const STATE_TEXT = {
  secure: ['lock', t('site.secure')],
  insecure: ['warn', t('site.insecure')],
  danger: ['warn', t('site.danger')],
  file: ['info', t('site.file')],
  local: ['info', t('site.local')],
  internal: ['info', t('site.internal')],
};

let siteMsg = '';
function renderSite(d) {
  const box = el('div', 'card panel');
  box.style.width = '330px';
  const header = el('header');
  header.append(el('div', 'title ellipsis', d.host || t('common.thisPage')), iconButton('close', t('common.close'), () => browser.closePopup()));
  const [icon, text] = STATE_TEXT[d.state] || STATE_TEXT.internal;
  const st = el('div', 'state ' + d.state);
  st.innerHTML = svg(icon);
  st.append(el('span', '', text));
  box.append(header, st);
  if (d.private) {
    const p = el('div', 'state');
    p.innerHTML = svg('mask');
    p.append(el('span', '', t('site.private')));
    box.append(p);
  }

  const scroll = el('div', 'scroll');
  if (d.origin) {
    const perms = el('section');
    perms.append(el('h3', '', t('site.permissions')));
    for (const p of d.perms) {
      const row = el('label', 'row');
      const select = el('select');
      for (const [v, label] of [['ask', t('common.ask')], ['allow', t('common.allow')], ['deny', t('common.block')]]) select.append(new Option(label, v));
      select.value = p.value;
      select.onchange = () => { browser.setPermission(d.origin, p.key, select.value); siteMsg = t('site.reloadToApply'); };
      row.append(el('span', '', t('perm.' + p.key)), select);
      perms.append(row);
    }
    scroll.append(perms);

    const priv = el('section');
    priv.append(el('h3', '', t('site.behavior')));
    const ad = el('label', 'row');
    const adSwitch = el('input', 'switch');
    adSwitch.type = 'checkbox';
    adSwitch.checked = d.adblock && d.adblockSite;
    adSwitch.disabled = !d.adblock;
    adSwitch.onchange = () => { browser.siteAdblock(adSwitch.checked); siteMsg = t('site.reloadToApply'); };
    const adText = el('span');
    adText.append(el('span', '', t('site.adblock')),
      el('span', 'faint', !d.adblock ? t('site.adblockOff') : t('site.blocked', { n: d.blocked })));
    ad.append(adText, adSwitch);
    const pop = el('label', 'row');
    const popSwitch = el('input', 'switch');
    popSwitch.type = 'checkbox';
    popSwitch.checked = d.popups;
    popSwitch.onchange = () => browser.sitePopups(popSwitch.checked);
    pop.append(el('span', '', t('site.popups')), popSwitch);
    priv.append(ad, pop);
    scroll.append(priv);
  }
  box.append(scroll);

  if (d.origin) {
    const footer = el('div', 'footer');
    const msg = el('div', 'msg', siteMsg);
    footer.append(
      pill(t('site.clear'), async () => { siteMsg = await browser.siteClear(); msg.textContent = siteMsg; report(); }),
      pill(t('site.reload'), () => { siteMsg = ''; browser.siteReload(); }, true),
      msg,
    );
    box.append(footer);
  }
  return box;
}

function size(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + ' ' + u[i];
}

function renderDownloads({ items }) {
  const box = el('div', 'card panel');
  box.style.width = '360px';
  const header = el('header');
  header.append(
    el('div', 'title', t('dl.title')),
    iconButton('folder', t('dl.openFolder'), () => browser.downloadsFolder()),
    iconButton('close', t('common.close'), () => browser.closePopup()),
  );
  box.append(header);
  const scroll = el('div', 'scroll');
  if (!items.length) scroll.append(el('div', 'empty', t('dl.empty')));
  for (const d of items) {
    const done = d.state === 'completed';
    const running = d.state === 'progressing' || d.state === 'paused';
    const row = el('div', 'dl' + (done ? ' done' : '') + (!done && !running ? ' off' : ''));
    const ext = (d.name.split('.').pop() || '').slice(0, 4);
    row.append(el('div', 'file' + (d.danger ? ' danger' : ''), ext));
    const grow = el('div', 'grow');
    const name = el('div', 'name ellipsis', d.name);
    name.title = d.name;
    if (done) name.onclick = () => browser.downloadAction(d.id, 'open');
    grow.append(name);
    if (running) {
      const bar = el('div', 'progress');
      const fill = el('span');
      fill.style.width = d.total ? Math.round((d.received / d.total) * 100) + '%' : '30%';
      bar.append(fill);
      grow.append(bar, el('div', 'faint', `${d.paused ? t('dl.paused') : ''}${size(d.received)}${d.total ? ' / ' + size(d.total) : ''}`));
    } else {
      const label = done ? `${size(d.total)}${d.private ? t('dl.private') : ''}` : d.state === 'cancelled' ? t('dl.cancelled') : t('dl.failed');
      grow.append(el('div', 'faint', label));
    }
    row.append(grow);
    if (running) {
      row.append(d.paused
        ? iconButton('play', t('dl.resume'), () => browser.downloadAction(d.id, 'resume'))
        : iconButton('pause', t('dl.pause'), () => browser.downloadAction(d.id, 'pause')));
      row.append(iconButton('close', t('common.cancel'), () => browser.downloadAction(d.id, 'cancel')));
    } else {
      if (done) row.append(iconButton('folder', t('dl.showInFolder'), () => browser.downloadAction(d.id, 'show')));
      row.append(iconButton('close', t('dl.remove'), () => browser.downloadAction(d.id, 'remove')));
    }
    scroll.append(row);
  }
  box.append(scroll);
  if (items.some(d => !(d.state === 'progressing' || d.state === 'paused'))) {
    const footer = el('div', 'footer');
    footer.append(pill(t('dl.clearDone'), () => browser.downloadsClear()));
    box.append(footer);
  }
  return box;
}

// 保存したパスワードの候補（ログイン欄の下）
function renderPasswords(d, width) {
  const box = el('div', 'card suggest pw');
  box.style.width = Math.max(260, width || 260) + 'px';
  box.append(el('div', 'pw-head', t('pw.savedFor', { host: d.host })));
  for (const it of d.items) {
    const row = el('div', 'sugg');
    const ic = el('span', 'ic');
    ic.innerHTML = svg('key');
    row.append(ic, el('span', 't ellipsis', it.username || t('pw.noUser')), el('span', 'dots', '••••••••'));
    row.addEventListener('mousedown', e => { e.preventDefault(); browser.pwFill(it.id); });
    box.append(row);
  }
  const manage = el('div', 'sugg manage', t('pw.manage'));
  manage.addEventListener('mousedown', e => { e.preventDefault(); browser.pwManage(); });
  box.append(manage);
  return box;
}

function renderPopup(p) {
  if (p.mode !== popupState.mode) siteMsg = '';
  popupState = p;
  root.innerHTML = '';
  if (!p.mode) { report(); return; }
  if (p.mode === 'suggest') root.append(renderSuggest(p.data, p.width));
  if (p.mode === 'site') root.append(renderSite(p.data));
  if (p.mode === 'downloads') root.append(renderDownloads(p.data));
  if (p.mode === 'pw') root.append(renderPasswords(p.data, p.width));
  root.style.width = 'max-content';
  report();
}

if (mode === 'popup') {
  browser.onPopup(renderPopup);
} else {
  browser.onOverlay(renderStack);
  browser.onFindFocus(() => { if (findInput) { findInput.focus(); findInput.select(); } });
}
