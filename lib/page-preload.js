// Webサイトのページに読み込む小さなスクリプト（サンドボックス内で動き、ページには何も公開しない）
// 広告ブロックの「要素を隠すCSS」と「広告を外すスクリプト（YouTube用など）」を、ページのスクリプトより先に入れる
const { ipcRenderer, webFrame } = require('electron');

// 普通の Chrome にある window.chrome.app などを用意する
// （無いと「自動操作のブラウザ」と判定され、X などで reCAPTCHA が出やすくなるため）
// Googleのログイン画面では、ブラウザ側が名乗っている Firefox と見た目を合わせる
// （Chrome にしかない情報が見えると「安全でないブラウザ」と判定されてログインできない）
const FF_VER = Math.max(143, 143 + Math.floor((Date.now() - Date.UTC(2025, 8, 16)) / (28 * 86400000)) - 1);
const FIREFOX_LOOK = `(() => {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${FF_VER}.0) Gecko/20100101 Firefox/${FF_VER}.0';
  const def = (o, k, v) => { try { Object.defineProperty(o, k, { get: () => v, configurable: true }); } catch (e) {} };
  const N = Navigator.prototype;
  def(N, 'userAgent', UA);
  def(N, 'appVersion', '5.0 (Windows)');
  def(N, 'vendor', '');
  def(N, 'platform', 'Win32');
  def(N, 'oscpu', 'Windows NT 10.0; Win64; x64');
  def(N, 'buildID', '20181001000000');
  def(N, 'productSub', '20100101');
  try { delete N.userAgentData; } catch (e) {}
  try { delete window.chrome; } catch (e) {}
})();`;

const CHROME_SHIM = `(() => {
  const c = window.chrome || (window.chrome = {});
  if (!c.app) {
    c.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails() { return null; },
      getIsInstalled() { return false; },
      installState(cb) { if (typeof cb === 'function') setTimeout(() => cb('not_installed'), 0); },
      runningState() { return 'cannot_run'; },
    };
  }
  if (!c.csi) {
    c.csi = function csi() {
      const t = performance.timing;
      return { startE: t.navigationStart, onloadT: t.loadEventEnd || Date.now(), pageT: performance.now(), tran: 15 };
    };
  }
  if (!c.loadTimes) {
    c.loadTimes = function loadTimes() {
      const t = performance.timing;
      const nav = performance.getEntriesByType('navigation')[0] || {};
      return {
        requestTime: t.navigationStart / 1000, startLoadTime: t.navigationStart / 1000,
        commitLoadTime: t.responseStart / 1000, finishDocumentLoadTime: t.domContentLoadedEventEnd / 1000,
        finishLoadTime: t.loadEventEnd / 1000, firstPaintTime: t.responseEnd / 1000, firstPaintAfterLoadTime: 0,
        navigationType: 'Other', wasFetchedViaSpdy: nav.nextHopProtocol === 'h2', wasNpnNegotiated: nav.nextHopProtocol === 'h2',
        npnNegotiatedProtocol: nav.nextHopProtocol || 'unknown', wasAlternateProtocolAvailable: false,
        connectionInfo: nav.nextHopProtocol || 'http/1.1',
      };
    };
  }
})();`;

// ---- リンクのプレビュー（Alt+クリック） ----
if (/^https?:$/.test(location.protocol)) {
  window.addEventListener('click', e => {
    if (!e.altKey || e.button !== 0 || e.ctrlKey || e.shiftKey || e.metaKey) return;
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !/^https?:/i.test(a.href)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    ipcRenderer.send('mb-glance', a.href);
  }, true);
}

// ---- リンクにマウスを乗せたら、そのサイトへの接続を先に始めておく（クリックしたときにすぐ開くように） ----
// （いちばん外側のページだけ。広告の枠の中のリンクでは行わない）
if (/^https?:$/.test(location.protocol) && process.isMainFrame) {
  const sent = new Set();
  let timer = 0, pending = '';
  const fire = () => {
    timer = 0;
    if (!pending || sent.has(pending) || sent.size > 300) return;
    sent.add(pending);
    ipcRenderer.send('mb-preconnect', pending);
  };
  const pick = e => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return false;
    let u;
    try { u = new URL(a.href); } catch { return false; }
    if (!/^https?:$/.test(u.protocol) || u.origin === location.origin) return false;
    pending = u.origin;
    return true;
  };
  // 少しのあいだ乗せたままのときだけ（画面の上をマウスが通り過ぎただけでは接続しない）
  window.addEventListener('mouseover', e => { if (pick(e)) { clearTimeout(timer); timer = setTimeout(fire, 80); } }, { capture: true, passive: true });
  window.addEventListener('pointerdown', e => { if (pick(e)) { clearTimeout(timer); fire(); } }, { capture: true, passive: true });
}

// ---- マウスのサイドボタン（ページの上で押したとき。どう使うかはブラウザ側の設定で決める） ----
if (process.isMainFrame) {
  window.addEventListener('mouseup', e => {
    if (e.button === 3 || e.button === 4) ipcRenderer.send('mb-side-button', e.button === 3 ? 'back' : 'forward');
  }, true);
}

// ---- パスワードの保存と自動入力（いちばん外側のページだけ） ----
if (/^https?:$/.test(location.protocol) && process.isMainFrame) {
  const isInput = el => el instanceof HTMLInputElement;
  const isPw = el => isInput(el) && el.type === 'password';
  const isUser = el => isInput(el) && /^(text|email|tel|)$/.test(el.type) &&
    (el.type === 'email' || /username|email/.test(el.autocomplete || '') ||
      /user|mail|login|account|signin|log_in|name|id$/i.test(`${el.name} ${el.id}`));
  const visible = el => el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
  let lastUser = '';

  // 入力欄の近くのユーザー名欄とパスワード欄を探す
  function fieldsNear(el) {
    const scope = (el && (el.form || (el.closest && el.closest('form')))) || document;
    const inputs = [...scope.querySelectorAll('input')];
    const pw = (isPw(el) && el) || inputs.find(i => isPw(i) && visible(i)) || null;
    let user = null;
    const pwIndex = pw ? inputs.indexOf(pw) : inputs.length;
    for (let i = pwIndex - 1; i >= 0; i--) {
      const c = inputs[i];
      if (isInput(c) && /^(text|email|tel|)$/.test(c.type) && (visible(c) || c.value)) { user = c; break; }
    }
    if (!user && isUser(el)) user = el;
    return { user, pw };
  }

  // ログインしたとき（送信・Enter・ボタン）に、保存するか聞いてもらう
  let lastSent = '';
  let lastSentAt = 0;
  function capture(from) {
    const { user, pw } = fieldsNear(from);
    if (!pw || !pw.value) return;
    const username = (user && user.value) || lastUser || '';
    const key = username + '\u0000' + pw.value;
    if (key === lastSent && Date.now() - lastSentAt < 3000) return;
    lastSent = key;
    lastSentAt = Date.now();
    ipcRenderer.send('mb-pw-capture', { username, password: pw.value });
  }
  window.addEventListener('submit', e => capture(e.target.querySelector && e.target.querySelector('input[type=password]')), true);
  window.addEventListener('keydown', e => { if (e.key === 'Enter' && isInput(e.target)) capture(e.target); }, true);
  window.addEventListener('click', e => {
    const b = e.target && e.target.closest ? e.target.closest('button, input[type=submit], input[type=button], [role=button]') : null;
    if (!b) return;
    const pw = (b.form || b.closest('form') || document).querySelector('input[type=password]');
    if (pw && pw.value) capture(pw);
  }, true);

  // ユーザー名・パスワードの欄にフォーカスしたら、保存したものを選べるようにする
  let focused = null;
  let filling = false;
  function sendField() {
    if (filling || !focused || !focused.isConnected) return;
    const r = focused.getBoundingClientRect();
    ipcRenderer.send('mb-pw-field', { x: r.left, y: r.top, width: r.width, height: r.height });
  }
  window.addEventListener('focusin', e => {
    const el = e.target;
    if (isPw(el) || isUser(el)) { focused = el; sendField(); }
  }, true);
  window.addEventListener('focusout', e => {
    if (filling || e.target !== focused) return;
    if (isUser(focused) && focused.value) lastUser = focused.value;
    focused = null;
    ipcRenderer.send('mb-pw-field', null);
  }, true);
  window.addEventListener('input', e => {
    // 入力を始めたら候補は閉じる
    if (e.target === focused && e.isTrusted) ipcRenderer.send('mb-pw-field', null);
  }, true);
  let raf = 0;
  window.addEventListener('scroll', () => {
    if (!focused || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; sendField(); });
  }, true);

  const setValue = (el, v) => {
    if (!el) return;
    el.focus();
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  ipcRenderer.on('mb-pw-fill', (_e, d) => {
    if (!d) return;
    const target = focused || document.activeElement;
    const { user, pw } = fieldsNear(isInput(target) ? target : null);
    filling = true;
    try {
      if (user && d.username) setValue(user, d.username);
      if (pw) setValue(pw, d.password);
    } finally { filling = false; }
    lastUser = d.username || lastUser;
  });
}

// YouTube：動画の情報から「広告の予定」を取り除く（広告そのものが流れないようにする。uBlock Origin と同じ考え方）
// ページのスクリプトより先に、ページと同じ環境で動かす必要がある
const YT_PRUNE = `(() => {
  if (window.__mbYtPrune) return;
  window.__mbYtPrune = true;
  const KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
  const prune = o => {
    try {
      if (!o || typeof o !== 'object') return o;
      for (const k of KEYS) if (k in o) delete o[k];
      if (o.playerResponse && typeof o.playerResponse === 'object') for (const k of KEYS) delete o.playerResponse[k];
      if (Array.isArray(o)) for (const x of o) { if (x && x.playerResponse) for (const k of KEYS) delete x.playerResponse[k]; }
    } catch (e) {}
    return o;
  };
  // 最初に埋め込まれている動画の情報
  let initial;
  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get() { return initial; },
      set(v) { initial = prune(v); },
    });
  } catch (e) {}
  // あとから読み込まれる動画の情報（JSON.parse と fetch の json() を通る）
  const parse = JSON.parse;
  JSON.parse = function () {
    const r = parse.apply(this, arguments);
    try { if (r && typeof r === 'object' && (r.adPlacements || r.playerAds || r.adSlots || (r.playerResponse && (r.playerResponse.adPlacements || r.playerResponse.adSlots)))) prune(r); } catch (e) {}
    return r;
  };
  try { JSON.parse.toString = parse.toString.bind(parse); } catch (e) {}
  const json = Response.prototype.json;
  Response.prototype.json = function () { return json.apply(this, arguments).then(r => prune(r)); };
})();`;

// X（旧Twitter）：タイムラインのデータから「プロモーション」の投稿を取り除く
const X_PRUNE = `(() => {
  if (window.__mbXPrune) return;
  window.__mbXPrune = true;
  const hasPromo = (o, d) => {
    if (!o || typeof o !== 'object' || d > 5) return false;
    if (o.promotedMetadata || o.promoted_metadata) return true;
    for (const k in o) { const v = o[k]; if (v && typeof v === 'object' && !Array.isArray(v) && hasPromo(v, d + 1)) return true; }
    return false;
  };
  const isPromo = e => !!e && typeof e === 'object' && !Array.isArray(e) &&
    ((typeof e.entryId === 'string' && /(^|-)promoted/i.test(e.entryId)) || hasPromo(e, 0));
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || d > 30) return;
    if (Array.isArray(o)) {
      for (let i = o.length - 1; i >= 0; i--) { if (isPromo(o[i])) o.splice(i, 1); else walk(o[i], d + 1); }
      return;
    }
    for (const k in o) walk(o[k], d + 1);
  };
  const prune = r => { try { walk(r, 0); } catch (e) {} return r; };
  const parse = JSON.parse;
  JSON.parse = function (text) {
    const r = parse.apply(this, arguments);
    try { if (typeof text === 'string' && text.indexOf('romoted') !== -1 && r && typeof r === 'object') prune(r); } catch (e) {}
    return r;
  };
  try { JSON.parse.toString = parse.toString.bind(parse); } catch (e) {}
  const json = Response.prototype.json;
  Response.prototype.json = function () {
    const u = this.url || '';
    const api = u.indexOf('/graphql/') !== -1 || u.indexOf('/i/api/') !== -1;
    return json.apply(this, arguments).then(r => (api ? prune(r) : r));
  };
  const desc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
  if (desc && desc.get) {
    Object.defineProperty(XMLHttpRequest.prototype, 'response', {
      configurable: true, enumerable: desc.enumerable,
      get() { const r = desc.get.call(this); if (r && typeof r === 'object' && this.responseType === 'json') prune(r); return r; },
    });
  }
})();`;

(() => {
  if (!/^https?:$/.test(location.protocol)) return;
  // Googleのログイン画面でFirefoxとして名乗っているとき（Chromeとして断られたあと）だけ、中身もFirefoxに見せる
  if (location.hostname === 'accounts.google.com' && /Firefox\//.test(navigator.userAgent)) webFrame.executeJavaScript(FIREFOX_LOOK).catch(() => {});
  else webFrame.executeJavaScript(CHROME_SHIM).catch(() => {});
  let r = null;
  // ブラウザ側からまだURLが見えないことがあるので、ページのURL（と一番外側のページのURL）も一緒に送る
  let topHref = '';
  try { topHref = window.top.location.href; } catch {}
  try { r = ipcRenderer.sendSync('mb-cosmetics', !!process.isMainFrame, location.href, topHref); } catch { return; }
  if (!r) return;
  if (/(^|\.)youtube\.com$/.test(location.hostname) && r.ytPrune !== false) webFrame.executeJavaScript(YT_PRUNE).catch(() => {});
  if (/(^|\.)(x\.com|twitter\.com)$/.test(location.hostname) && process.isMainFrame) webFrame.executeJavaScript(X_PRUNE).catch(() => {});
  if (r.styles) {
    try { webFrame.insertCSS(r.styles, { cssOrigin: 'user' }); } catch {}
  }
  // ページ本体と同じ環境で動かす必要がある（広告の設定を書き換えるため）
  // 1つずつ別の関数の中で動かす（同じ名前の関数やクラスがぶつかって、ページのスクリプトまで止まるのを防ぐ）
  const seen = new Set();
  for (const code of r.scripts || []) {
    if (typeof code !== 'string' || seen.has(code)) continue;
    seen.add(code);
    webFrame.executeJavaScript('(function(){try{' + code + '\n}catch(e){console.warn("[mb-scriptlet] " + (e && e.message))}})();').catch(() => {});
  }
})();
