// 設定パネル（文字は i18n.js の t() で日本語／英語を切り替える）
const $ = id => document.getElementById(id);
let data = null;
const SVG_TRASH = '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>';
const SVG_X = '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>';

// カードの外をクリック、×、Esc で閉じる
document.body.addEventListener('mousedown', e => { if (!$('card').contains(e.target)) browser.closeSettings(); });
$('close').onclick = () => browser.closeSettings();

// ---- 上のタブ ----
let tab = 'general';
function showTab(name) {
  if (!document.querySelector(`.page[data-page="${name}"]`)) name = 'general';
  tab = name;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('on', p.dataset.page === name));
  document.querySelector('.scroll').scrollTop = 0;
  if (name === 'history') loadHistory();
  if (name === 'system') refreshMetrics();
  if (name === 'extensions') loadExtensions();
  if (name === 'import') loadSources();
}
document.querySelectorAll('nav button').forEach(b => { b.onclick = () => { showTab(b.dataset.tab); browser.setSettingsTab(b.dataset.tab); }; });
browser.onSettingsTab(showTab);
showTab('general');

// ---- 一般 ----
$('theme').querySelectorAll('button').forEach(b => { b.onclick = () => browser.setTheme(b.dataset.v); });
// タブバー・リンクバーの色（透明感のある色の見本）
const PRESETS = ['#7c9cff', '#a78bfa', '#f472b6', '#fb7185', '#fb923c', '#facc15', '#4ade80', '#2dd4bf', '#38bdf8', '#94a3b8'];
function buildSwatches(id, key, noneLabel) {
  const box = $(id);
  const mk = (value, label) => {
    const b = document.createElement('button');
    b.className = 'sw' + (value ? '' : ' none');
    b.dataset.v = value;
    b.title = label || value;
    if (value) b.style.setProperty('--c', value);
    b.onclick = () => browser.setColors({ [key]: value });
    return b;
  };
  box.append(mk('', noneLabel));
  for (const c of PRESETS) box.append(mk(c));
  const custom = document.createElement('label');
  custom.className = 'sw custom';
  custom.title = t('set.colorCustom');
  const input = document.createElement('input');
  input.type = 'color';
  input.oninput = () => browser.setColors({ [key]: input.value });
  custom.append(input);
  box.append(custom);
}
buildSwatches('sw-side', 'side', t('set.colorNone'));
buildSwatches('sw-top', 'top', t('set.colorSame'));
$('color-alpha').oninput = e => { $('color-alpha-v').textContent = e.target.value + '%'; browser.setColors({ alpha: Number(e.target.value) }); };
$('side-buttons').onchange = e => browser.setSideButtons(e.target.value);
$('sync-mode').onchange = e => { browser.setSync(e.target.value); };
$('archive-after').onchange = e => browser.setArchiveAfter(Number(e.target.value));
// 使いすぎ防止
$('limit-form').onsubmit = e => {
  e.preventDefault();
  const site = $('limit-site').value.trim();
  if (!site) return;
  browser.setLimit(site, Number($('limit-mins').value));
  $('limit-site').value = '';
};
if (LANG === 'en') $('limit-mins').querySelectorAll('option').forEach(o => { o.textContent = o.value + ' min'; });
$('lang').onchange = e => browser.setLang(e.target.value);
$('engine').onchange = e => browser.setSearchEngine(e.target.value);
$('ai').onchange = e => browser.selectAI(Number(e.target.value));
$('restore').onchange = e => browser.setRestore(e.target.checked);
$('make-default').onclick = async () => { $('default-msg').textContent = await browser.makeDefault(); };
for (const key of ['sidebarW', 'aiW']) {
  $(key).addEventListener('input', e => {
    $(key + '-v').textContent = e.target.value + 'px';
    browser.setWidths({ [key]: Number(e.target.value) });
  });
}
$('reset-widths').onclick = () => browser.setWidths(data.defaults);

// オン/オフの設定（data-option）
document.querySelectorAll('[data-option]').forEach(input => {
  input.onchange = () => browser.setOption(input.dataset.option, input.checked);
});

// ---- プライバシー ----
async function clearData(kind) {
  $('clear-status').textContent = t('set.deleting');
  $('clear-status').textContent = await browser.clearData(kind);
}
$('clear-cache').onclick = () => clearData('cache');
$('clear-all').onclick = () => { if (confirm(t('set.confirmCookies'))) clearData('all'); };
$('clear-history').onclick = async () => {
  const sel = $('history-range');
  if (!confirm(t('set.confirmHistory', { range: sel.options[sel.selectedIndex].text }))) return;
  $('clear-status').textContent = await browser.historyClear(sel.value);
  if (tab === 'history') loadHistory();
};

// ---- 履歴 ----
let historyTimer;
$('history-q').addEventListener('input', () => { clearTimeout(historyTimer); historyTimer = setTimeout(loadHistory, 150); });
async function loadHistory() {
  const items = await browser.historyList($('history-q').value);
  const box = $('history');
  box.innerHTML = '';
  let lastDay = '';
  const locale = LANG === 'en' ? 'en-US' : 'ja-JP';
  for (const it of items) {
    const d = new Date(it.t);
    const day = d.toLocaleDateString(locale, { month: 'long', day: 'numeric', weekday: 'short' });
    if (day !== lastDay) { box.append(el('div', 'day', day)); lastDay = day; }
    const row = el('div', 'item');
    const grow = el('div', 'grow');
    grow.append(el('div', 'title', it.title || it.url), el('div', 'url', it.url));
    row.append(el('span', 'time', d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })), grow,
      iconButton(t('set.removeHistory'), 'danger', e => { e.stopPropagation(); browser.historyRemove(it.url); row.remove(); }));
    row.title = it.url;
    row.onclick = () => browser.historyOpen(it.url);
    box.append(row);
  }
  $('history-note').textContent = data && !data.saveHistory ? t('set.historyOff') : '';
}

// ---- 翻訳 ----
$('tr-engine').onchange = e => { browser.setTranslate(e.target.value); $('deepl-form').hidden = e.target.value !== 'deepl'; };
$('deepl-form').onsubmit = e => {
  e.preventDefault();
  browser.setTranslate('deepl', $('deepl-key').value);
  $('deepl-key').value = '';
};

// ---- パスワード ----
const revealed = {};
$('pw-q').addEventListener('input', () => renderPasswords());
async function importCsv(statusId) {
  const msg = await browser.pwImportCsv();
  if (msg && statusId) $(statusId).textContent = msg;
}
$('pw-import').onclick = () => importCsv('pw-import-status');
$('pw-import2').onclick = () => importCsv('imp-status');
function renderPasswords() {
  if (!data) return;
  const box = $('pw-list');
  box.innerHTML = '';
  const q = $('pw-q').value.trim().toLowerCase();
  for (const p of data.passwords.filter(p => !q || (p.origin + ' ' + p.username).toLowerCase().includes(q))) {
    const row = el('div', 'item');
    const grow = el('div', 'grow');
    grow.append(el('div', 'host', p.origin.replace(/^https:\/\//, '')), el('div', 'url', p.username || t('pw.noUser')));
    const secret = el('span', 'secret', revealed[p.id] ?? '••••••••');
    const eye = el('button', 'pill', t(revealed[p.id] != null ? 'set.pwHide' : 'set.pwShow'));
    eye.onclick = async () => {
      if (revealed[p.id] != null) delete revealed[p.id]; else revealed[p.id] = await browser.pwReveal(p.id);
      renderPasswords();
    };
    row.append(grow, secret, eye, iconButton(t('common.delete'), 'danger', () => {
      if (confirm(t('set.pwConfirmDelete', { site: p.origin.replace(/^https?:\/\//, ''), user: p.username || t('pw.noUser') }))) browser.pwRemove(p.id);
    }));
    box.append(row);
  }
  const nv = $('pw-never');
  nv.innerHTML = '';
  for (const o of data.passwordsNever) {
    const row = el('div', 'item');
    const grow = el('div', 'grow');
    grow.append(el('div', 'host', o.replace(/^https?:\/\//, '')));
    row.append(grow, iconButton(t('set.removeException'), 'danger', () => browser.pwNeverRemove(o), false, SVG_X));
    nv.append(row);
  }
  $('pw-status').textContent = data.passwordsAvailable ? t('set.pwOfferNote') : t('pw.unavailable');
}

// ---- ほかのブラウザから読み込む ----
async function loadSources() {
  const list = await browser.importSources();
  const sel = $('imp-source');
  const prev = sel.value;
  sel.innerHTML = '';
  for (const s of list) sel.append(new Option(`${s.browser} — ${s.profile}`, s.id));
  if (!list.length) sel.append(new Option(t('set.importNone'), ''));
  if (list.some(s => s.id === prev)) sel.value = prev;
  sel.disabled = !list.length;
  $('imp-run').disabled = !list.length;
}
$('imp-run').onclick = async () => {
  const id = $('imp-source').value;
  if (!id) return;
  $('imp-status').textContent = t('set.importing');
  $('imp-run').disabled = true;
  try {
    $('imp-status').textContent = await browser.importRun(id, {
      bookmarks: $('imp-bookmarks').checked, favorites: $('imp-favorites').checked, history: $('imp-history').checked,
    });
  } finally { $('imp-run').disabled = false; }
};
$('imp-bookmarks').onchange = () => { $('imp-favorites').disabled = !$('imp-bookmarks').checked; };
$('bm-clear').onclick = () => { if (confirm(t('set.bookmarksConfirm'))) browser.bookmarksClear(); };

// ---- プロフィール ----
$('add-profile').onsubmit = e => {
  e.preventDefault();
  browser.addProfile($('new-profile').value);
  $('new-profile').value = '';
};

// ---- 拡張機能 ----
$('open-webstore').onclick = () => browser.openWebStore();
async function loadExtensions() {
  let info;
  try { info = await browser.extList(); } catch { info = { items: [], error: '' }; }
  const box = $('extensions');
  box.innerHTML = '';
  for (const x of info.items) {
    const row = el('div', 'item');
    const icon = el('div', 'ext-icon');
    const img = document.createElement('img');
    img.src = `crx://extension-icon/${encodeURIComponent(x.id)}/32/2`;
    img.onerror = () => { img.remove(); icon.textContent = (x.name || '?').charAt(0).toUpperCase(); };
    icon.append(img);
    const grow = el('div', 'grow');
    grow.append(el('div', 'title', x.name), el('div', 'url', `v${x.version}`));
    row.append(icon, grow);
    if (x.options) {
      const o = el('button', 'pill', t('set.extOptions'));
      o.onclick = () => browser.extOptions(x.id);
      row.append(o);
    }
    row.append(iconButton(t('set.extRemove'), 'danger', async () => {
      if (!confirm(t('set.confirmRemoveExt', { name: x.name }))) return;
      await browser.extRemove(x.id);
      loadExtensions();
    }));
    box.append(row);
  }
  $('ext-status').textContent = info.error ? t('set.extUnavailable', { error: info.error }) : '';
}

// ---- システム ----
$('sleep').onchange = e => browser.setSleep(Number(e.target.value));
$('sleep-now').onclick = async () => {
  const n = await browser.sleepNow();
  $('memory-detail').textContent = n ? t('set.sleptN', { n }) : t('set.sleptNone');
  setTimeout(refreshMetrics, 800);
};
async function refreshMetrics() {
  const m = await browser.metrics();
  $('memory').textContent = m.mb.toLocaleString() + ' MB';
  $('memory-detail').textContent = t('set.memoryDetail', { live: m.live, sleeping: m.sleeping }) + (m.ai ? t('set.memoryAi') : '');
}
setInterval(() => { if (tab === 'system' && document.visibilityState === 'visible') refreshMetrics(); }, 3000);
$('choose-dir').onclick = () => browser.chooseDownloadDir();
$('check-update').onclick = () => browser.checkUpdate();
$('install-update').onclick = () => browser.installUpdate();
$('open-privacy').onclick = () => browser.openPrivacy();
$('open-licenses').onclick = () => browser.openLicenses();
$('open-data').onclick = () => browser.openDataFolder();

// ---- 部品 ----
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function iconButton(title, cls, onclick, disabled = false, icon = SVG_TRASH) {
  const b = el('button', 'icon ' + cls);
  b.title = title;
  b.innerHTML = icon;
  b.onclick = onclick;
  b.disabled = disabled;
  if (disabled) b.style.visibility = 'hidden';
  return b;
}
function setOptions(select, items, value) {
  if (select.options.length !== items.length) {
    select.innerHTML = '';
    for (const [v, label] of items) select.append(new Option(label, v));
  }
  select.value = String(value);
}
const fmtDate = ts => (ts ? new Date(ts).toLocaleDateString(LANG === 'en' ? 'en-US' : 'ja-JP', { month: 'numeric', day: 'numeric' }) : '');

function render() {
  // 一般
  $('theme').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === data.theme));
  $('lang').value = data.lang;
  const C = data.colors || {};
  for (const [id, key] of [['sw-side', 'side'], ['sw-top', 'top']]) {
    const v = (C[key] || '').toLowerCase();
    let matched = false;
    $(id).querySelectorAll('button.sw').forEach(b => { const on = b.dataset.v.toLowerCase() === v; b.classList.toggle('on', on); matched ||= on; });
    const custom = $(id).querySelector('.custom');
    custom.classList.toggle('on', !matched && !!v);
    if (v) { custom.style.setProperty('--c', v); custom.querySelector('input').value = v; }
  }
  if (document.activeElement !== $('color-alpha')) $('color-alpha').value = C.alpha ?? 60;
  $('color-alpha-v').textContent = (C.alpha ?? 60) + '%';
  $('side-buttons').value = data.sideButtons || 'profile';
  setOptions($('engine'), data.engines.map(e => [e.id, e.name]), data.searchEngine);
  setOptions($('ai'), [...data.ai.map((n, i) => [i, n]), [-1, t('aic.option')]], data.aiIndex);
  $('restore').checked = data.restoreTabs;
  const L = data.limits;
  for (const [key, min, max] of [['sidebarW', L.SIDEBAR_MIN, L.SIDEBAR_MAX], ['aiW', L.AI_MIN, L.AI_MAX]]) {
    const input = $(key);
    input.min = min;
    input.max = max;
    if (document.activeElement !== input) input.value = data[key];
    $(key + '-v').textContent = data[key] + 'px';
  }
  document.querySelectorAll('[data-option]').forEach(input => { input.checked = !!data[input.dataset.option]; });

  // プライバシー
  const s = data.adblockStatus;
  $('adblock-status').textContent = s.missing ? t('set.adblockMissing')
    : !data.adblock ? t('set.adblockOffNote')
      : s.ready ? t('set.adblockReady', { date: fmtDate(s.updatedAt) })
        : s.loading ? t('set.adblockLoading') : t('set.adblockWaiting');

  const perms = $('permissions');
  perms.innerHTML = '';
  for (const site of data.permissions) {
    const row = el('div', 'item');
    const grow = el('div', 'grow');
    grow.append(el('div', 'host', site.origin.replace(/^https?:\/\//, '')));
    const chips = el('div', 'chips');
    for (const it of site.items) {
      const label = it.key.startsWith('external:') ? t('perm.external', { scheme: it.key.slice(9) }) : t('perm.' + it.key);
      chips.append(el('span', 'chip ' + it.value, `${label}: ${t(it.value === 'allow' ? 'common.allow' : 'common.block')}`));
    }
    grow.append(chips);
    row.append(grow, iconButton(t('set.resetSite'), 'danger', () => browser.clearSitePermissions(site.origin)));
    perms.append(row);
  }

  const ex = $('exceptions');
  ex.innerHTML = '';
  const lists = [['adblockAllow', 'set.exAdblock'], ['popupsAllow', 'set.exPopups'], ['httpsExceptions', 'set.exHttp']];
  for (const [key, label] of lists) {
    for (const host of data[key] || []) {
      const row = el('div', 'item');
      const grow = el('div', 'grow');
      grow.append(el('div', 'host', host), el('div', 'url', t(label)));
      row.append(grow, iconButton(t('set.removeException'), 'danger', () => browser.removeException(key, host), false, SVG_X));
      ex.append(row);
    }
  }

  // 同期
  const mode = !data.syncDir ? 'off' : data.syncDir === data.syncDefault ? 'onedrive' : 'pick';
  $('sync-mode').value = mode;
  $('sync-mode').querySelector('[value="onedrive"]').disabled = !data.syncDefault;
  $('sync-path').textContent = data.syncDir ? data.syncDir : (data.syncDefault ? t('sync.offNote') : t('sync.noOneDrive'));

  // アーカイブしたタブ
  setOptions($('archive-after'), (data.archiveChoices || []).map(h => [h, h === 0 ? t('set.archiveOff') : h < 48 ? t('set.archiveHours', { n: h }) : t('set.archiveDays', { n: h / 24 })]), data.archiveAfter);
  const ar = $('archive');
  ar.innerHTML = '';
  for (const a of data.archive || []) {
    const row = el('div', 'item');
    const grow = el('div', 'grow');
    grow.append(el('div', 'host', a.title || a.url), el('div', 'url', a.url));
    grow.style.cursor = 'pointer';
    grow.onclick = () => browser.archiveOpen(a.url);
    row.append(grow, iconButton(t('common.delete'), 'danger', () => browser.archiveRemove(a.url), false, SVG_X));
    ar.append(row);
  }

  // 使いすぎ防止
  const lm = $('limits');
  lm.innerHTML = '';
  for (const [site, mins] of Object.entries(data.limits || {})) {
    const used = Math.round(((data.usageToday || {})[site] || 0) / 60);
    const row = el('div', 'item');
    const grow = el('div', 'grow');
    grow.append(el('div', 'host', site), el('div', 'url', t('set.limitRow', { m: mins, used })));
    row.append(grow, iconButton(t('set.removeException'), 'danger', () => browser.setLimit(site, 0), false, SVG_X));
    lm.append(row);
  }

  // クリックで隠した部分
  const hd = $('hidden');
  hd.innerHTML = '';
  for (const [site, list] of Object.entries(data.hideRules || {})) {
    for (const sel of list) {
      const row = el('div', 'item');
      const grow = el('div', 'grow');
      grow.append(el('div', 'host', site), el('div', 'url', sel));
      row.append(grow, iconButton(t('set.removeException'), 'danger', () => browser.hideRemove(site, sel), false, SVG_X));
      hd.append(row);
    }
  }

  // プロフィール（名前を入力中は描き直さない）
  const pl = $('profiles');
  if (!pl.contains(document.activeElement)) {
    pl.innerHTML = '';
    for (const p of data.profiles) {
      const row = el('div', 'item');
      const grow = el('div', 'grow');
      const name = el('input', 'name-input');
      name.value = p.name;
      name.maxLength = 30;
      name.addEventListener('change', () => { if (name.value.trim()) browser.renameProfile(p.id, name.value); });
      name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });
      // ログイン情報を分ける（別のアカウントでログインできる）
      const sep = el('label', 'mini');
      const sw = el('input', 'switch small');
      sw.type = 'checkbox';
      sw.checked = !!p.separate;
      sw.onchange = () => {
        if (!confirm(t(sw.checked ? 'set.confirmSeparate' : 'set.confirmShare', { name: p.name }))) { sw.checked = !sw.checked; return; }
        browser.setProfileSeparate(p.id, sw.checked);
      };
      sep.append(sw, el('span', '', t('set.separate')));
      grow.append(name, sep);
      row.append(grow, el('span', 'meta', t('set.pinnedCount', { n: p.pinned })));
      if (p.id === data.profileId) row.append(el('span', 'badge', t('set.inUse')));
      else {
        const go = el('button', 'pill', t('set.switch'));
        go.onclick = () => browser.switchProfile(p.id);
        row.append(go);
      }
      row.append(iconButton(t('common.delete'), 'danger', () => {
        if (confirm(t('set.confirmDeleteProfile', { name: p.name }))) browser.deleteProfile(p.id);
      }, data.profiles.length <= 1));
      pl.append(row);
    }
  }

  // お気に入り
  const fl = $('favorites');
  fl.innerHTML = '';
  for (const f of data.favorites) {
    const row = el('div', 'item');
    const icon = el('div', 'fav-icon');
    const letter = () => { icon.textContent = (f.title || '?').trim().charAt(0).toUpperCase(); };
    if (f.favicon) {
      const img = document.createElement('img');
      img.src = f.favicon;
      img.onerror = () => { img.remove(); letter(); };
      icon.append(img);
    } else letter();
    const grow = el('div', 'grow');
    grow.append(el('div', 'title', f.title), el('div', 'url', f.url));
    row.append(icon, grow, iconButton(t('set.removeFavorite'), 'danger', () => browser.removeFavorite(f.id)));
    fl.append(row);
  }

  // 翻訳
  $('tr-engine').value = data.translateEngine;
  $('deepl-form').hidden = data.translateEngine !== 'deepl';
  $('deepl-status').textContent = data.translateEngine === 'deepl' ? t(data.deeplKeySet ? 'set.deeplSet' : 'set.deeplMissing') : '';

  // パスワード・ブックマーク
  renderPasswords();
  $('bm-count').textContent = t('set.bookmarksCount', { n: data.bookmarkCount });
  $('bm-clear').disabled = !data.bookmarkCount;

  // 拡張機能（一覧が変わったとき）
  if (tab === 'extensions') loadExtensions();

  // システム
  setOptions($('sleep'), data.sleepChoices.map(m => [m, m === 0 ? t('set.sleepNever') : m < 60 ? t('set.sleepMin', { n: m }) : t('set.sleepHour', { n: m / 60 })]), data.sleepAfter);
  $('download-dir').textContent = data.downloadDir;
  const a = data.about;
  $('about-name').textContent = a.name;
  $('about-version').textContent = `${t('set.version', { v: a.version })}${a.packaged ? '' : t('set.devBuild')}・Chromium ${a.chrome}・Electron ${a.electron}`;
  const u = data.update || {};
  $('update-status').textContent = u.key ? t(u.key, u.vars) : (a.packaged ? t('set.autoUpdateNote') : '');
  $('check-update').disabled = !a.packaged || !!u.busy;
  $('install-update').hidden = !u.ready;
}

browser.onSettings(d => { data = d; render(); });
