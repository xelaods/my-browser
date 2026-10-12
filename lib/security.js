// セキュリティまわり：サイトの権限・ポップアップ・HTTPS優先・外部アプリで開くリンク
const { dialog } = require('electron');

// 確認なしで許可してよいもの（全画面・クリップボードへの書き込みなど、危険の少ないもの）
// （keyboardLock は Esc を奪えるので入れない）
const ALWAYS_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);

// サイトに使ってよいか聞くもの
const LABELS = {
  camera: 'カメラ',
  microphone: 'マイク',
  geolocation: '位置情報',
  notifications: '通知',
  'clipboard-read': 'クリップボードの読み取り',
  midi: 'MIDI機器',
  'idle-detection': 'パソコンの操作状況',
  'storage-access': '埋め込みコンテンツのCookie',
  'top-level-storage-access': '埋め込みコンテンツのCookie',
};
// 設定画面などで常に一覧に出すもの
const COMMON = ['camera', 'microphone', 'geolocation', 'notifications'];

const USER_GESTURE_MS = 2000; // クリックやキー入力からこの時間内に開いたポップアップだけ通す

function originOf(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; }
}
function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

// ローカルや社内向けのアドレス（HTTPSに切り替えない）
function isLocalHost(host) {
  if (!host) return true;
  if (!host.includes('.')) return true; // localhost や社内のホスト名
  if (/^\[.*\]$/.test(host)) return true; // IPv6
  if (/\.(localhost|local|test|internal|lan|home\.arpa)$/i.test(host)) return true;
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  return false;
}

function createSecurity(ctx) {
  // ctx: { settings(), save(), showCard(card), removeCard(id), window(), tabIdOf(wc), isPrivate(wc), t(key, vars) }
  const pending = new Map(); // カードID → { cb, origin, keys, wcId }
  const lastInput = new Map(); // webContents.id → 最後にクリック/キー入力した時刻（ページを移ると消す・ポップアップ1回で使い切る）
  const lastAny = new Map();   // webContents.id → 最後にクリック/キー入力した時刻（ダウンロード・外部アプリ用）
  const privateStore = {};     // シークレットタブで決めた権限（保存しない）
  const upgraded = new Set(); // HTTPSに切り替えたURL（その読み込みだけ）
  const httpsFailed = new Set(); // HTTPSで開けなかったので、今回はHTTPで開くホスト
  let seq = 1;

  const S = () => ctx.settings();
  const store = () => (S().permissions ||= {});

  function keysFor(permission, details = {}) {
    if (permission === 'media') {
      const t = details.mediaTypes || [];
      const keys = [];
      if (t.includes('video')) keys.push('camera');
      if (t.includes('audio')) keys.push('microphone');
      return keys.length ? keys : ['camera', 'microphone'];
    }
    if (permission === 'midiSysex') return ['midi'];
    return LABELS[permission] ? [permission] : null;
  }

  // シークレットタブでは、そこで決めたもの → 普段の設定の順に見る
  function decision(origin, key, priv = false) {
    return (priv && privateStore[origin]?.[key]) || store()[origin]?.[key]; // 'allow' | 'deny' | undefined
  }

  function setDecision(origin, key, value, priv = false) {
    if (!origin || !LABELS[key] && !key.startsWith('external:')) return;
    const all = priv ? privateStore : store();
    all[origin] ||= {};
    if (value === 'allow' || value === 'deny') all[origin][key] = value;
    else delete all[origin][key];
    if (!Object.keys(all[origin]).length) delete all[origin];
    if (!priv) ctx.save();
  }

  // ---- 権限のリクエスト ----
  function onRequest(wc, permission, callback, details = {}) {
    if (ALWAYS_ALLOW.has(permission)) return callback(true);
    if (permission === 'openExternal') return askExternal(wc, details, callback);

    const url = details.requestingUrl || wc?.getURL() || '';
    const origin = originOf(url);
    const keys = keysFor(permission, details);
    // 内部ページや不明な権限は許可しない
    if (!origin || !keys) return callback(false);

    const priv = ctx.isPrivate(wc);
    const states = keys.map(k => decision(origin, k, priv));
    if (states.includes('deny')) return callback(false);
    if (states.every(s => s === 'allow')) return callback(true);

    // ページの右上に「許可／ブロック」のカードを出して聞く
    const id = 'perm' + seq++;
    pending.set(id, { cb: callback, origin, keys, wcId: wc?.id, priv });
    ctx.showCard({
      id, kind: 'permission', tabId: ctx.tabIdOf(wc), host: hostOf(url), perm: keys[0],
      text: ctx.t('card.permission', { what: keys.map(k => ctx.t('perm.' + k)).join(ctx.t('card.and')) }),
    });
  }

  function answer(id, allow) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    for (const k of p.keys) setDecision(p.origin, k, allow ? 'allow' : 'deny', p.priv);
    ctx.removeCard(id);
    p.cb(!!allow);
  }

  // ページを閉じた・移動したときは、答えていない確認を取り下げる
  function dropPending(wcId) {
    for (const [id, p] of pending) {
      if (p.wcId !== wcId) continue;
      pending.delete(id);
      ctx.removeCard(id);
      try { p.cb(false); } catch {}
    }
  }

  function onCheck(wc, permission, requestingOrigin, details = {}) {
    if (ALWAYS_ALLOW.has(permission)) return true;
    const origin = originOf(requestingOrigin || details.requestingUrl || '');
    if (!origin) return false;
    let keys;
    if (permission === 'media') keys = [details.mediaType === 'video' ? 'camera' : 'microphone'];
    else keys = keysFor(permission, details);
    const priv = ctx.isPrivate(wc);
    return !!keys && keys.every(k => decision(origin, k, priv) === 'allow');
  }

  // mailto: や zoommtg: など、外部アプリで開くリンク
  async function askExternal(wc, details, callback) {
    const target = details.externalURL || '';
    let scheme = '';
    try { scheme = new URL(target).protocol.replace(':', ''); } catch { return callback(false); }
    // ファイルやスクリプトを直接実行できるものは常に拒否
    if (/^(file|javascript|vbscript|data|ms-msdt|search-ms|ms-officecmd)$/i.test(scheme)) return callback(false);
    const origin = originOf(details.requestingUrl || wc?.getURL() || '');
    const key = 'external:' + scheme.toLowerCase();
    const priv = ctx.isPrivate(wc);
    const saved = origin && decision(origin, key, priv);
    if (saved) return callback(saved === 'allow');
    // クリックなどの操作なしで外部アプリを開こうとしたら、聞かずに断る（確認ダイアログの連発を防ぐ）
    if (!wc || !recentGesture(wc, 5000)) return callback(false);
    const win = ctx.window();
    const { response, checkboxChecked } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: [ctx.t('common.open'), ctx.t('common.cancel')],
      defaultId: 1, cancelId: 1,
      title: ctx.t('ext.openTitle'),
      message: ctx.t('ext.openMessage', { host: hostOf(details.requestingUrl || '') || ctx.t('common.thisPage') }),
      detail: target.length > 200 ? target.slice(0, 200) + '…' : target,
      // 送り主が分からないページ（about:blank など）は覚えない
      ...(origin ? { checkboxLabel: ctx.t('ext.openRemember', { scheme }) } : {}),
    });
    const ok = response === 0;
    if (checkboxChecked && origin) setDecision(origin, key, ok ? 'allow' : 'deny', priv);
    callback(ok);
  }

  // ---- ポップアップ ----
  function noteInput(wc, ev) {
    if (/^(mouseDown|keyDown|rawKeyDown|touchStart|gestureTap)$/.test(ev.type)) {
      lastInput.set(wc.id, Date.now());
      lastAny.set(wc.id, Date.now());
    }
  }
  function recentGesture(wc, ms) { return Date.now() - (lastAny.get(wc.id) || 0) < ms; }
  function forget(wcId) { lastInput.delete(wcId); lastAny.delete(wcId); dropPending(wcId); }
  // 別のページに移ったら、前のページでのクリックは数えない
  function navigated(wcId) { lastInput.delete(wcId); dropPending(wcId); }
  // 1回のクリックで開けるポップアップは1つだけ（使い切る）
  function popupAllowed(wc, extraAllow = []) {
    if (Date.now() - (lastInput.get(wc.id) || 0) < USER_GESTURE_MS) {
      lastInput.delete(wc.id);
      return true;
    }
    const host = hostOf(wc.getURL());
    return !!host && [...(S().popupsAllow || []), ...extraAllow].includes(host);
  }

  // ---- HTTPS優先 ----
  function upgradeUrl(url) {
    if (!S().httpsOnly || !/^http:\/\//i.test(url)) return null;
    const host = hostOf(url);
    if (isLocalHost(host) || httpsFailed.has(host) || (S().httpsExceptions || []).includes(host)) return null;
    const up = 'https://' + url.slice('http://'.length);
    upgraded.add(up);
    if (upgraded.size > 200) upgraded.delete(upgraded.values().next().value);
    return up;
  }
  // この読み込みが「HTTPSに切り替えたせいで開けなかった」ものか（調べたら記録は消す）
  function failedUpgrade(url) {
    if (!upgraded.has(url)) return false;
    upgraded.delete(url);
    return /^https:\/\//i.test(url) && !httpsFailed.has(hostOf(url));
  }
  function upgradeSucceeded(url) { upgraded.delete(url); }
  function allowHttp(host) { httpsFailed.add(host); }

  // ---- 設定画面・サイト情報用 ----
  function sitePermissions(origin) {
    const saved = store()[origin] || {};
    const keys = [...new Set([...COMMON, ...Object.keys(saved).filter(k => LABELS[k])])];
    return keys.map(k => ({ key: k, label: LABELS[k], value: saved[k] || 'ask' }));
  }
  function allPermissions() {
    return Object.entries(store()).map(([origin, perms]) => ({
      origin,
      items: Object.entries(perms).map(([k, v]) => ({
        key: k, value: v,
        label: LABELS[k] || (k.startsWith('external:') ? `外部アプリ（${k.slice(9)}:）` : k),
      })),
    }));
  }
  function clearSite(origin) {
    delete store()[origin];
    ctx.save();
  }

  return {
    onRequest, onCheck, answer, dropPending, noteInput, forget, navigated, popupAllowed, recentGesture,
    upgradeUrl, failedUpgrade, upgradeSucceeded, allowHttp,
    sitePermissions, allPermissions, setDecision, clearSite,
  };
}

module.exports = { createSecurity, isLocalHost, originOf, hostOf, LABELS };
