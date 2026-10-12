const {
  app, BaseWindow, WebContentsView, ipcMain, clipboard, Menu, session, screen, nativeTheme, dialog, shell, protocol, safeStorage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const config = require('./config');
const { readJSON, writeJSON, writeJSONLater, onSlow: onSlowSave } = require('./lib/store');
const { History } = require('./lib/history');
const adblock = require('./lib/adblock');
const { createSecurity, originOf, hostOf, isLocalHost } = require('./lib/security');
const { createDownloads } = require('./lib/downloads');
const { createUpdater } = require('./lib/updater');
const { createExtensions } = require('./lib/extensions');
const errorPage = require('./lib/errorpage');
const { createPasswords } = require('./lib/passwords');
const importer = require('./lib/importer');
const translator = require('./lib/translate');
const youtube = require('./lib/youtube');
const xAds = require('./lib/x');
const sponsorblock = require('./lib/sponsorblock');
const hider = require('./lib/hider');
const { createSync } = require('./lib/sync');
const aiapi = require('./lib/aiapi');

// ===== 起動前の準備 =====

// すべてのページをサンドボックス（OSの隔離環境）で動かす
app.enableSandbox();

// 保存場所（ログイン状態・タブ・設定）。インストール版と開発版（npm start）で分ける
const DATA_DIR = app.isPackaged ? 'MyBrowser' : 'my-browser';
app.setPath('userData', path.join(app.getPath('appData'), DATA_DIR));

// ===== 言語（日本語 / English） =====
const I18N = require('./ui/i18n.js');
// Webサイトに伝える言語は起動時に決まるので、保存されている設定を先に読む
const EARLY_LANG = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')).lang || 'system'; } catch { return 'system'; }
})();
if (EARLY_LANG === 'en') app.commandLine.appendSwitch('lang', 'en-US');
if (EARLY_LANG === 'ja') app.commandLine.appendSwitch('lang', 'ja');
const curLang = () => {
  const l = settings?.lang || 'system';
  if (l === 'ja' || l === 'en') return l;
  return app.isReady() && !app.getLocale().toLowerCase().startsWith('ja') ? 'en' : 'ja';
};
let tr = I18N.make('ja');
const updateTr = () => { tr = I18N.make(curLang()); };

// 2回目に起動されたら新しく開かず、今のウィンドウを前に出す（URL付きで起動されたらそのURLを開く）
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  const url = urlFromArgs(argv);
  if (url) newTab(url);
});

// "Electron" を含むUAだとログインを拒否するサイトがあるので、普通のChromeとして名乗る
app.userAgentFallback = app.userAgentFallback.replace(/\s?(Electron|my-browser|MyBrowser|My Browser)\/\S+/g, '');
const CHROME_UA = app.userAgentFallback;
// Googleのログイン画面だけはFirefoxとして名乗る（自作ブラウザ判定の回避）
// 古いバージョンを名乗ると「安全でないブラウザ」と判定されるので、今のFirefoxのバージョンを日付から計算する
// （Firefox は4週間ごとに新しいバージョンが出る。143 が 2025-09-16。念のため1つ前のバージョンを名乗る）
const firefoxVersion = () => Math.max(143, 143 + Math.floor((Date.now() - Date.UTC(2025, 8, 16)) / (28 * 86400000)) - 1);
const FIREFOX_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${firefoxVersion()}.0) Gecko/20100101 Firefox/${firefoxVersion()}.0`;
const GOOGLE_LOGIN = /^https:\/\/accounts\.google\.com\//;

const GAP = 8;          // ページの周りの余白
const TITLE_H = 40;     // 上のタイトルバーの高さ
const AI_HEADER = 138;  // AIパネル上部（操作部分）の高さ
const RADIUS = 10;      // ページの角丸
const PEEK_EDGE = 18;   // サイドバーを隠しているとき、左端からこの幅(px)にマウスが来たら表示
const OVERLAY_W = 360;  // ページ右上に出るカード（ページ内検索・確認・通知）の幅
const PAD = 12;         // カードの影のための余白（ui/overlay.css の #root の左右の余白と同じ）
const SIDEBAR_MIN = 180, SIDEBAR_MAX = 440;
const AI_MIN = 300, AI_MAX = 760;
const BG = { light: '#f2f2f2', dark: '#111111' };
const SLEEP_CHOICES = [0, 5, 15, 30, 60, 180]; // タブを休止するまでの分数（0 = しない）
const SPLIT_MAX = 4;    // 画面分割で並べられるタブの数

const UI_DIR = path.join(__dirname, 'ui');
// ブラウザ自身の画面は file:// ではなく専用の mb://ui/ で表示する。
// （file:// の特別な権限をオフにしても動くように。ローカルのHTMLファイルが他のファイルを読めないようにするため）
const UI_SCHEME = 'mb';
const UI_BASE = 'mb://ui/';
const isUiUrl = url => typeof url === 'string' && url.startsWith(UI_BASE);
// 画面のファイルのURL（?lang=ja|en を付けて、画面側が言語を知れるようにする）
const uiUrl = (file, query) => UI_BASE + file + '?' + new URLSearchParams({ ...(query || {}), lang: curLang() });
const newtabUrl = isPrivate => uiUrl('newtab.html', isPrivate ? { private: '1' } : null);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
};
protocol.registerSchemesAsPrivileged([{ scheme: UI_SCHEME, privileges: { standard: true, secure: true } }]);

// mb://ui/〜 を ui フォルダの中のファイルで返す（フォルダの外は返さない）
function registerUiProtocol(ses) {
  ses.protocol.handle(UI_SCHEME, async req => {
    try {
      const u = new URL(req.url);
      const file = path.normalize(path.join(UI_DIR, decodeURIComponent(u.pathname)));
      if (u.host !== 'ui' || !file.startsWith(UI_DIR + path.sep)) return new Response('', { status: 404 });
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    } catch {
      return new Response('', { status: 404 });
    }
  });
}
const PRELOAD = path.join(__dirname, 'preload.js');

// 検索エンジン（設定で切り替え）
const ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  yahoo: { name: 'Yahoo! JAPAN', url: 'https://search.yahoo.co.jp/search?p=' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
};

let win, ui, aiView;
let panel, overlay, popup;      // 設定パネル / ページ右上のカード / 小さなポップアップ（候補・サイト情報・ダウンロード）
let palette = null;             // 新しいタブ・コマンドバー（画面中央に浮かぶ検索ボックス）
let paletteOpen = false;
let paletteState = { mode: 'new', private: false };
let glanceUi = null;            // リンクのプレビューの背景と操作ボタン
let glance = null;              // { view, url, title, loading, private, profileId, rect }
let splits = [];                // 画面分割：[[タブID, タブID, ...], ...]
let paneRects = {};             // 表示中のタブID → 位置
let areaRect = { x: 0, y: 0, width: 100, height: 100 }; // ページを置ける場所全体
let panelOpen = false;
let aiClosedAt = 0;
// タブ: { id, profileId, favId, favPid, private, url, title, favicon, pinned, pinnedUrl, view, loading, lastUsed, error,
//         pageLang, translated, translating }
//   favId があるタブは「お気に入り」から開いたタブ（全プロフィール共通、タブ一覧には出ない）
//   favPid はそのお気に入りを開いたプロフィール（ログイン情報を分けたプロフィールでは別のタブになる）
let tabs = [];
let activeId = null;
let nextId = 1;
let peeking = false;
let resizing = null;
let fullscreenTab = null;       // 動画などをページ内で全画面表示しているタブ
let fullscreenByPage = false;
const lastActive = {};          // プロフィールごとに最後に見ていたタブ
const closedStack = [];

const isNewTab = url => !url || /^mb:\/\/ui\/newtab\.html(\?[^#]*)?(#.*)?$/.test(url);
const isInternal = url => !url || isUiUrl(url);
const findTab = id => tabs.find(t => t.id === id);
const activeTab = () => findTab(activeId);
const cur = () => activeTab()?.view?.webContents;
const tabOfWc = wc => {
  if (!wc || wc.isDestroyed?.()) return null;
  return tabs.find(t => { const w = t.view?.webContents; return !!w && !w.isDestroyed() && w.id === wc.id; }) || null;
};

// ===== 設定と前回の状態の保存 =====
let settingsPath;
let settings = {
  theme: 'system',                  // light / dark / system
  lang: 'system',                   // ja / en / system（画面の言語）
  searchEngine: 'google',
  restoreTabs: true,                // 起動時に前回の「今日」のタブを復元する
  sidebarW: config.sidebarWidth || 250,
  aiW: config.aiWidth || 420,
  aiIndex: 0, sideOpen: false, sidebarCollapsed: false,
  profiles: [{ id: 'p1', name: '' }],              // 名前が空なら「メイン / Main」と表示。separate: ログイン情報を分ける
  profileId: 'p1',
  favorites: [],                    // { id, url, title, favicon } 全プロフィール共通
  bookmarks: [],                    // ほかのブラウザから読み込んだブックマーク { id, url, title, folder }
  tabs: [],                         // 保存用のタブ一覧（profileId 付き）
  active: {},                       // プロフィールごとの選択中タブの番号
  bounds: null, maximized: false,
  // プライバシーとセキュリティ
  adblock: true,                    // 広告とトラッカーをブロック
  adblockAllow: [],                 // 広告ブロックをオフにしたサイト
  httpsOnly: true,                  // http:// を https:// に切り替える
  httpsExceptions: [],
  // タブバー（左）とリンクバー（上）の色。'' は色なし（白・グレーのまま）。alpha は濃さ（%）
  colors: { side: '', top: '', alpha: 60 },
  aiMode: 'site',                   // AIパネル：'site'（AIのサイトを開く・無料）/ 'api'（内蔵AI・自分のAPIキー）
  aiProvider: 'anthropic',          // 内蔵AIで使うサービス
  aiModels: {},                     // サービスごとのモデル名（空ならおすすめのもの）
  aiKeys: {},                       // サービスごとのAPIキー（このPCの中で暗号化して保存）
  syncDir: '',                      // 2台のPCをそろえるフォルダ（OneDrive など。'' = 同期しない）
  deviceId: '',                     // このPCの印（同期で、自分が書いたものかどうかを見分ける）
  folders: [],                      // 固定タブのフォルダ { id, name, open, profileId }
  archiveAfter: 24,                 // 「今日」のタブを、使わなくなってから何時間で自動で片付けるか（0 = しない）
  archive: [],                      // 片付けたタブ（あとから開き直せる。新しい順）
  limits: {},                       // 使いすぎ防止：サイト名 → 1日の上限（分）
  usage: { day: '', sites: {}, extra: {} }, // 今日そのサイトを見ていた秒数と、「あと5分」で延ばした秒数
  hideRules: {},                    // クリックで隠した部分（サイト名 → CSS セレクターの一覧）
  autoPip: true,                    // 動画を再生中のタブから離れたら、自動で小窓にする
  sponsorSkip: true,                // YouTube の動画の中の案件（スポンサー）区間を飛ばす（SponsorBlock）
  stats: { month: '', blocked: 0, adSec: 0, sponsorSec: 0 }, // 今月ブロックした広告の数・飛ばした時間（新しいタブに表示）
  sideButtons: 'profile',           // マウスのサイドボタン：'profile'（プロフィール切り替え）/ 'history'（戻る・進む）/ 'off'
  googleUa: 'chrome',               // Googleのログイン画面で名乗るブラウザ（'chrome' か 'firefox'。断られたら自動で切り替える）
  gpc: true,                        // サイトに「追跡しないで」と伝える（Global Privacy Control）
  saveHistory: true,
  permissions: {},                  // { origin: { camera: 'allow' | 'deny', ... } }
  popupsAllow: [],                  // ポップアップを許可したサイト
  // パフォーマンス・ダウンロード・更新
  sleepAfter: 30,                   // 使っていないタブを休止するまでの分数（0 = しない）
  downloadDir: '',
  askDownload: false,
  autoUpdate: true,
  // パスワード・翻訳
  passwordSave: true,               // ログインしたときにパスワードを保存するか聞く
  translateEngine: 'google',        // google / deepl
  deeplKey: '',                     // DeepL のAPIキー（暗号化して保存）
};

function loadSettings() {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  migrateFromDev();
  const defColors = settings.colors;
  settings = { ...settings, ...readJSON(settingsPath, {}) };
  settings.colors = { ...defColors, ...(settings.colors || {}) };
  if (!config.ai[settings.aiIndex]) settings.aiIndex = 0;
  if (!ENGINES[settings.searchEngine]) settings.searchEngine = 'google';
  if (!settings.profiles?.length) settings.profiles = [{ id: 'p1', name: '' }];
  if (!settings.profiles.some(p => p.id === settings.profileId)) settings.profileId = settings.profiles[0].id;
  if (!Array.isArray(settings.tabs)) settings.tabs = [];
  if (!Array.isArray(settings.favorites)) settings.favorites = [];
  if (!Array.isArray(settings.bookmarks)) settings.bookmarks = [];
  if (!['google', 'deepl'].includes(settings.translateEngine)) settings.translateEngine = 'google';
  for (const key of ['adblockAllow', 'httpsExceptions', 'popupsAllow']) if (!Array.isArray(settings[key])) settings[key] = [];
  if (!settings.permissions || typeof settings.permissions !== 'object') settings.permissions = {};
  if (!SLEEP_CHOICES.includes(settings.sleepAfter)) settings.sleepAfter = 30;
  if (!['ja', 'en', 'system'].includes(settings.lang)) settings.lang = 'system';
  if (!settings.deviceId) settings.deviceId = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  for (const k of ['folders', 'archive']) if (!Array.isArray(settings[k])) settings[k] = [];
  for (const k of ['hideRules', 'limits']) if (!settings[k] || typeof settings[k] !== 'object') settings[k] = {};
  // 昔の「メイン」はそのままだと英語表示でも日本語になるので、空（＝言語に合わせた名前）にする
  for (const p of settings.profiles) if (p.id === 'p1' && p.name === 'メイン') p.name = '';
  // 旧バージョンの保存データ（プロフィールなし）を取り込む
  for (const t of settings.tabs) if (!t.profileId) t.profileId = settings.profiles[0].id;
  settings.sidebarW = clamp(settings.sidebarW, SIDEBAR_MIN, SIDEBAR_MAX);
  settings.aiW = clamp(settings.aiW, AI_MIN, AI_MAX);
}

// インストール版を初めて起動したとき、開発版で使っていたタブ・お気に入り・履歴を引き継ぐ
// （ログイン情報は暗号化の方式が違うので引き継がない）
function migrateFromDev() {
  if (!app.isPackaged || fs.existsSync(settingsPath)) return;
  const old = path.join(app.getPath('appData'), 'my-browser');
  for (const name of ['settings.json', 'history.json']) {
    try { fs.copyFileSync(path.join(old, name), path.join(app.getPath('userData'), name)); } catch {}
  }
}

function saveSettings(later = false) {
  const keep = tabs.filter(t => !t.favId && !t.private && (t.pinned || !isInternal(t.url)));
  settings.tabs = keep.map(t => ({
    profileId: t.profileId, url: savedUrl(t), title: t.title, favicon: t.favicon,
    pinned: t.pinned, pinnedUrl: t.pinnedUrl, folderId: t.folderId || null,
  }));
  settings.active = {};
  for (const p of settings.profiles) {
    const list = keep.filter(t => t.profileId === p.id);
    const id = p.id === settings.profileId ? activeId : lastActive[p.id];
    settings.active[p.id] = Math.max(0, list.findIndex(t => t.id === id));
  }
  if (later) writeJSONLater(settingsPath, settings); else writeJSON(settingsPath, settings);
  sync?.push();
}
// エラーページを表示中のタブは、開こうとしていたURLを保存する
const savedUrl = t => (t.error?.url || (isInternal(t.url) ? '' : t.url));

let saveTimer;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveSettings(true), 800); }

// ===== 節約した時間（今月ブロックした広告の数・飛ばした広告と案件の秒数） =====
const monthKey = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
let statsTimer = null;
function statsAdd(kind, n) {
  if (!['blocked', 'adSec', 'sponsorSec'].includes(kind) || !(n > 0)) return;
  const st = settings.stats || (settings.stats = {});
  if (st.month !== monthKey()) Object.assign(st, { month: monthKey(), blocked: 0, adSec: 0, sponsorSec: 0 });
  st[kind] = (st[kind] || 0) + Math.min(n, kind === 'blocked' ? 50 : 3600);
  // 保存は少しまとめて（広告ブロックは1ページで何十回も数える）
  if (!statsTimer) statsTimer = setTimeout(() => { statsTimer = null; saveSoon(); }, 5000);
}
function statsNow() {
  const st = settings.stats || {};
  return st.month === monthKey() ? { blocked: st.blocked || 0, adSec: st.adSec || 0, sponsorSec: st.sponsorSec || 0 } : { blocked: 0, adSec: 0, sponsorSec: 0 };
}
function clamp(v, min, max) { return Math.round(Math.min(max, Math.max(min, Number(v) || min))); }

// プロフィール名（最初のプロフィールは名前が空なら「メイン / Main」）
const profileName = p => p.name || tr('set.defaultProfile');
// AIへの指示文（config.js の prompts は { ja: [...], en: [...] } か、昔の形の配列）
const promptsFor = lang => (Array.isArray(config.prompts) ? config.prompts : (config.prompts[lang] || config.prompts.ja));

// ===== 不具合の調査用（データフォルダに debug.flag があるときだけ debug.log に書く） =====
// noscriptlets.flag があるときは、広告を外すスクリプトを使わない（原因の切り分け用）
// 調査用の印は、データフォルダか、このアプリのフォルダに置く（記録もその場所に書く）
let debugDir = null;
const flagOn = name => {
  for (const dir of [app.getPath('userData'), __dirname]) {
    try {
      const f = path.join(dir, name);
      // 中身が「off」の印は、無いのと同じ扱いにする（消さなくても切り替えられるように）
      if (fs.existsSync(f) && !/^\s*off/i.test(fs.readFileSync(f, 'utf8'))) { if (name === 'debug.flag') debugDir = dir; return true; }
    } catch {}
  }
  return false;
};
// YouTube は、広告の予定を消したり広告の通信を止めたりすると、それを見つけて動画をわざと数秒〜十数秒待たせる。
// そのため YouTube では通信のブロックと「広告の予定を消す」処理をせず、広告が流れ始めた瞬間に最後まで飛ばす（lib/youtube.js）
// （yt-strict.flag があるときは、前のやり方に戻す：調査用）
const ytSoft = url => youtube.isYouTube(url) && !liveFlag('yt-strict.flag');
// 調査用の印のうち、ブラウザを開いたまま切り替えられるもの（2秒ごとに確かめ直す）
// yt-noblock.flag：YouTube のページでは通信をブロックしない / yt-noprune.flag：動画の情報から広告の予定を消さない
// yt-noguard.flag：YouTube の保険（広告カード隠し・動画広告の早送り）を入れない
const liveFlagCache = new Map();
const liveFlag = name => {
  if (!DEBUG) return false;
  const c = liveFlagCache.get(name);
  if (c && Date.now() - c.t < 2000) return c.v;
  let v = false;
  for (const dir of [app.getPath('userData'), __dirname]) {
    try { const f = path.join(dir, name); if (fs.existsSync(f)) { v = !/^\s*off/i.test(fs.readFileSync(f, 'utf8')); break; } } catch {}
  }
  liveFlagCache.set(name, { v, t: Date.now() });
  return v;
};
let DEBUG = false;
let NO_SCRIPTLETS = false;
let NO_COSMETICS = false; // nocosmetics.flag：リストのルールをページに入れない（保険の動きを確かめる調査用）
// 記録はまとめて裏で書く（調査中もブラウザの動きを遅くしないため）
let dlogBuf = [], dlogTimer = null;
function dlog(...a) {
  if (!DEBUG) return;
  dlogBuf.push(new Date().toISOString() + ' ' + a.join(' ').slice(0, 8000));
  if (dlogTimer) return;
  dlogTimer = setTimeout(() => {
    dlogTimer = null;
    const text = dlogBuf.join('\n') + '\n';
    dlogBuf = [];
    fs.promises.appendFile(path.join(debugDir || app.getPath('userData'), 'debug.log'), text).catch(() => {});
  }, 500);
}

// 調査用：ブラウザ本体が止まっていないか（止まると、すべてのページの通信が待たされる）
function startPerfLog() {
  const { monitorEventLoopDelay } = require('perf_hooks');
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const gap = now - last - 1000;
    last = now;
    if (gap > 100 || h.max / 1e6 > 150) dlog('[perf] main-blocked gap=' + gap + 'ms maxDelay=' + Math.round(h.max / 1e6) + 'ms');
    h.reset();
  }, 1000);
  onSlowSave((kind, file, ms) => dlog('[perf] save', kind, path.basename(file), ms + 'ms'));
}
const debugHost = url => /(^|\.)(youtube\.com|googlevideo\.com|ytimg\.com|x\.com|twitter\.com|twimg\.com)$/i.test(hostOf(url));

// ===== 部品（履歴・セキュリティ・ダウンロード・更新） =====
let history;
// （passwords は下の「パスワードの保存と自動入力」で用意する）
const security = createSecurity({
  settings: () => settings,
  save: () => { saveSoon(); sendSettings(); },
  showCard: card => showCard(card),
  removeCard: id => removeCard(id),
  window: () => win,
  tabIdOf: wc => (wc && aiView && wc.id === aiView.webContents.id ? 'ai' : tabOfWc(wc)?.id ?? null),
  t: (k, v) => tr(k, v),
  isPrivate: wc => isPrivateWc(wc),
});
const isPrivateWc = wc => !!wc && !wc.isDestroyed() && !!privateSession && wc.session === privateSession;
const privatePopupsAllow = new Set(); // シークレットタブで「常に許可」したサイト（保存しない）
const downloads = createDownloads({
  settings: () => settings,
  window: () => win,
  isPrivate: ses => !!ses && ses === privateSession,
  userInitiated: wc => !wc || security.recentGesture(wc, 5000),
  t: (k, v) => tr(k, v),
  onChange: list => {
    sendState();
    if (popupMode === 'downloads') sendPopup();
  },
  onDone: d => showCard({
    id: 'dl-' + d.id, kind: 'download', tabId: null, downloadId: d.id, timeout: 8000,
    host: tr('card.downloadDone'), text: d.name,
  }),
});
let updater;
// Chrome拡張機能（Chromeウェブストアから追加したもの）。シークレットタブでは使わない
const extensions = createExtensions({
  window: () => win,
  openTab: (url, active) => {
    const t = addTab({ url: url || '' }, { activate: !!active });
    if (!t.view) { loadView(t); layout(); }
    return t.view.webContents;
  },
  selectWc: wc => { const t = tabOfWc(wc); if (t) activateTab(t.id); },
  // 拡張機能が閉じるよう求めたときだけ閉じる（休止や終了でページが消えたときにも呼ばれるので、そのときは何もしない）
  closeWc: wc => { if (!wc || wc.isDestroyed()) return; const t = tabOfWc(wc); if (t) closeTab(t.id); },
  onChange: () => sendSettings(),
  t: (k, v) => tr(k, v),
});

// ===== テーマ =====
const isDark = () => settings.theme === 'dark' || (settings.theme === 'system' && nativeTheme.shouldUseDarkColors);

// ブラウザ自身の画面（UI・新しいタブ・設定など）に <html data-theme="dark|light"> を付ける
function paintTheme(wc) {
  if (!wc || wc.isDestroyed()) return;
  wc.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(isDark() ? 'dark' : 'light')}`).catch(() => {});
}

// ===== タブバー・リンクバーの色（透明感のある色） =====
const HEX = /^#[0-9a-f]{6}$/i;
const rgbOf = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function colorState() {
  const c = settings.colors || {};
  const side = HEX.test(c.side || '') ? c.side : '';
  const top = HEX.test(c.top || '') ? c.top : side; // 上のバーを決めていなければ、左と同じ色
  const alpha = Math.max(10, Math.min(100, Number(c.alpha) || 55)) / 100;
  return { side, top, alpha };
}
// Dia のような、ふんわりした色合い（本当に透けるのではなく、地の色に溶け込むグラデーション）
function tintGradient(hex, strength) {
  if (!hex) return '';
  const dark = isDark();
  const base = dark ? [20, 20, 22] : [246, 246, 247];
  const [r, g, b] = rgbOf(hex);
  // 濃さ 100% でも色そのものにはせず、地の色と混ぜる（明るい色では最大 55%、暗い色では最大 45%）
  const k = strength * (dark ? 0.45 : 0.55);
  const mixc = (t, lift = 0) => {
    const m = (x, y) => Math.round(Math.min(255, x * t + y * (1 - t) + lift));
    return `rgb(${m(r, base[0])}, ${m(g, base[1])}, ${m(b, base[2])})`;
  };
  // 上が少し濃く、下に向かって地の色に溶ける。左上にやわらかい光
  const glow = dark ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.55)';
  return `radial-gradient(120% 60% at 0% 0%, ${glow}, transparent 60%), ` +
    `linear-gradient(170deg, ${mixc(k)} 0%, ${mixc(k * 0.75)} 45%, ${mixc(k * 0.5, dark ? 0 : 4)} 100%)`;
}
function paintColors(wc) {
  if (!wc || wc.isDestroyed()) return;
  const { side, top, alpha } = colorState();
  const vars = {
    side: tintGradient(side, alpha),
    // 上のバーがタブバーと同じ色なら、ウィンドウ全体で1つのグラデーションにする（つなぎ目を見せない）
    top: top && top !== side ? tintGradient(top, Math.min(1, alpha + .05)) : '',
  };
  wc.executeJavaScript(`(() => {
    const r = document.documentElement.style, v = ${JSON.stringify(vars)};
    r.setProperty('--tint-side', v.side || 'var(--bg)');
    r.setProperty('--tint-top', v.top || 'transparent');
    r.setProperty('--tint-side-solid', v.side || 'var(--bg)');
    document.documentElement.classList.toggle('tinted', !!v.side);
    document.documentElement.classList.toggle('tinted-top', !!v.top);
    document.documentElement.classList.remove('glass');
  })()`).catch(() => {});
}
// ウィンドウの地の色も、選んだ色の中間の色にしておく（サイドバーの一時表示中に、ページのまわりの細い枠が黒く見えないように）
function tintSolid(hex, strength) {
  const dark = isDark();
  const base = dark ? [20, 20, 22] : [246, 246, 247];
  const [r, g, b] = rgbOf(hex);
  const t = strength * (dark ? 0.45 : 0.55) * 0.6;
  const h = (x, y) => Math.round(x * t + y * (1 - t)).toString(16).padStart(2, '0');
  return '#' + h(r, base[0]) + h(g, base[1]) + h(b, base[2]);
}
function applyWindowMaterial() {
  if (!win || win.isDestroyed()) return;
  try { win.setBackgroundMaterial?.('none'); } catch {}
  const { side, alpha } = colorState();
  win.setBackgroundColor(side ? tintSolid(side, alpha) : (isDark() ? BG.dark : BG.light));
}

function applyTheme() {
  nativeTheme.themeSource = settings.theme; // Webサイト側の prefers-color-scheme もこれに従う
  const dark = isDark();
  applyWindowMaterial();
  for (const v of [ui, panel, overlay, popup, palette, glanceUi]) paintTheme(v?.webContents);
  paintColors(ui?.webContents);
  for (const t of tabs) {
    if (!t.view || !isInternal(t.url)) continue;
    t.view.setBackgroundColor(dark ? '#161616' : '#ffffff');
    paintTheme(t.view.webContents);
  }
}

// ===== レイアウト =====
let pageRect = { x: 0, y: 0, width: 100, height: 100 };

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const sidebarShown = !settings.sidebarCollapsed || peeking;
  // 隠しているサイドバーを一時表示（左端にマウス）しているときは、ページの上に重ねて出す。
  // ページの幅は変えない（変えるとサイトが描き直されて、表示がずれたり重くなったりするため）
  const left = settings.sidebarCollapsed ? GAP : settings.sidebarW;
  const aiW = settings.sideOpen ? settings.aiW : 0;
  const right = aiW ? aiW + GAP * 2 : GAP;
  const full = fullscreenTab != null && fullscreenTab === activeId;

  ui.setBounds({ x: 0, y: 0, width: w, height: h });
  panel?.setBounds({ x: 0, y: 0, width: w, height: h });
  areaRect = full
    ? { x: 0, y: 0, width: w, height: h }
    : { x: left, y: TITLE_H, width: Math.max(100, w - left - right), height: Math.max(100, h - TITLE_H - GAP) };
  // 画面分割：同じグループのタブを横に等分して並べる
  const group = full ? null : splitOf(activeId);
  const ids = group ? group.filter(id => findTab(id)) : [activeId];
  const colW = (areaRect.width - GAP * (ids.length - 1)) / ids.length;
  paneRects = {};
  ids.forEach((id, i) => {
    const x = Math.round(areaRect.x + i * (colW + GAP));
    const next = Math.round(areaRect.x + (i + 1) * (colW + GAP) - GAP);
    paneRects[id] = { x, y: areaRect.y, width: Math.max(80, next - x), height: areaRect.height };
  });
  pageRect = paneRects[activeId] || areaRect;
  for (const t of tabs) {
    if (!t.view) continue;
    t.view.setVisible(!!paneRects[t.id]);
    t.view.setBounds(paneRects[t.id] || areaRect);
    t.view.setBorderRadius(full ? 0 : RADIUS);
  }
  const ai = { x: w - GAP - settings.aiW, y: TITLE_H + AI_HEADER, width: settings.aiW, height: Math.max(100, h - TITLE_H - GAP - AI_HEADER) };
  if (aiView) {
    aiView.setVisible(settings.sideOpen && !full);
    aiView.setBounds(ai);
  }
  placeOverlay();
  placePopup();
  placeGlance();
  if (paletteOpen) palette.setBounds({ x: 0, y: 0, width: w, height: h });
  ui.webContents.send('layout', {
    page: areaRect, ai: settings.sideOpen ? ai : null,
    panes: ids.length > 1 ? ids.map(id => ({ rect: paneRects[id], active: id === activeId })) : null,
    sidebarShown, collapsed: settings.sidebarCollapsed, peeking,
    sidebarW: settings.sidebarW, aiW, gap: GAP, titleH: TITLE_H, aiHeader: AI_HEADER,
    maximized: win.isMaximized(),
  });
}

// タブやAIのビューは、UIのすぐ上（カードや設定パネルより下）に入れる
function addPageView(view) {
  win.contentView.addChildView(view, 1);
}

function displayTitle(t) {
  if (t.title) return t.title;
  if (isNewTab(t.url)) return tr(t.private ? 'common.privateTab' : 'common.newTab');
  try { return new URL(t.url).hostname || t.url.slice(0, 60); } catch { return t.url; }
}
const displayUrl = t => (t.error?.url || (isInternal(t.url) ? '' : t.url));

// 鍵マークの状態
function securityState(t) {
  const url = displayUrl(t);
  if (!url) return 'internal';
  if (t.error?.kind === 'https' || (t.error && t.error.code <= -200 && t.error.code > -300)) return 'danger';
  if (url.startsWith('https:')) return 'secure';
  if (url.startsWith('http:')) return isLocalHost(hostOf(url)) ? 'local' : 'insecure';
  return 'file';
}

// 画面（タブ一覧など）への状態の送信。ページの読み込み中は短い間に何十回も呼ばれるので、まとめて1回にする
let stateTimer = null;
function sendState() {
  if (stateTimer) return;
  stateTimer = setTimeout(() => { stateTimer = null; sendStateNow(); }, 16);
}
function sendStateNow() {
  if (!ui || ui.webContents.isDestroyed()) return;
  const wc = cur();
  const nav = wc ? wc.navigationHistory : null;
  const pid = settings.profileId;
  const active = activeTab();
  const dls = downloads.list();
  const running = dls.filter(d => /progressing|paused/.test(d.state));
  const total = running.reduce((s, d) => s + (d.total || 0), 0);
  const got = running.reduce((s, d) => s + (d.received || 0), 0);
  ui.webContents.send('state', {
    tabs: tabs.filter(t => t.profileId === pid).map(t => ({
      id: t.id, title: displayTitle(t), url: displayUrl(t), folderId: t.pinned ? (t.folderId || null) : null,
      favicon: t.favicon, pinned: t.pinned, active: t.id === activeId,
      loading: t.loading, sleeping: !t.view, private: t.private, newtab: isNewTab(t.url) && !t.error,
      audible: !!t.view && !t.view.webContents.isDestroyed() && t.view.webContents.isCurrentlyAudible(),
      split: splitOf(t.id) ? splits.indexOf(splitOf(t.id)) + 1 : 0, shown: !!paneRects[t.id],
    })),
    folders: settings.folders.filter(f => f.profileId === pid).map(f => ({ id: f.id, name: f.name, open: f.open !== false })),
    favorites: settings.favorites.map(f => {
      const t = favTab(f.id);
      return { ...f, favicon: f.favicon || t?.favicon || '', active: !!t && t.id === activeId, open: !!t?.view, loading: !!t?.loading };
    }),
    profiles: settings.profiles.map(p => ({ ...p, name: profileName(p) })), profileId: pid,
    activeUrl: active ? displayUrl(active) : '',
    activeTitle: active ? displayTitle(active) : '',
    activePrivate: !!active?.private,
    translate: active ? translateState(active) : '',
    security: active ? securityState(active) : 'internal',
    zoom: wc && !wc.isDestroyed() ? Math.round(wc.getZoomFactor() * 100) : 100,
    canBack: nav ? nav.canGoBack() : false,
    canForward: nav ? nav.canGoForward() : false,
    sideOpen: settings.sideOpen,
    aiIndex: settings.aiMode === 'api' ? -1 : settings.aiIndex,
    downloads: { count: dls.length, running: running.length, progress: total ? got / total : (running.length ? -1 : 1) },
  });
  sendSettings();
  if (popupMode === 'site') sendPopup();
}

// ===== タブ =====
function addTab(data = {}, { activate = true, index } = {}) {
  const t = {
    id: nextId++, profileId: data.favId ? null : (data.profileId || settings.profileId), favId: data.favId || null,
    private: !!data.private,
    url: data.url || '', title: data.title || '', favicon: data.favicon || '',
    pinned: !!data.pinned, pinnedUrl: data.pinnedUrl ?? null, folderId: data.pinned ? (data.folderId || null) : null, view: null, loading: false,
    lastUsed: Date.now(), error: null,
  };
  if (index == null) {
    // 新しいタブは Arc と同じく「今日」の一番上に入れる
    const first = tabs.findIndex(x => x.profileId === t.profileId && !x.pinned && !x.favId);
    index = first < 0 ? tabs.length : first;
  }
  tabs.splice(index, 0, t);
  if (activate) activateTab(t.id);
  else { sendState(); saveSoon(); }
  return t;
}

const newTab = (url, opts = {}) => addTab({ url: url || '', private: !!opts.private });

// ページのビューの共通設定（セキュリティのため明示しておく）
// pid: どのプロフィールのページか（ログイン情報を分けたプロフィールは専用のセッションを使う）
function pagePrefs(isPrivate, pid) {
  return {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
    plugins: true,            // PDFビューアー
    safeDialogs: true,        // alert を連続で出すページを止められるようにする
    spellcheck: true,
    session: isPrivate ? getPrivateSession() : sessionFor(pid),
  };
}
const tabPid = t => (t.favId ? t.favPid : t.profileId);
// 拡張機能は普段のセッション（ログイン情報を分けていないプロフィール）のタブだけで動く
const extOk = wc => !!wc && !wc.isDestroyed() && wc.session === session.defaultSession;

function loadView(t) {
  if (t.view) return;
  const view = new WebContentsView({ webPreferences: pagePrefs(t.private, tabPid(t)) });
  view.setBorderRadius(RADIUS);
  view.setBackgroundColor(isInternal(t.url) && isDark() ? '#161616' : '#ffffff');
  addPageView(view);
  t.view = view;
  setupPage(view.webContents, t);
  wireView(t, view);
  if (isNewTab(t.url)) view.webContents.loadURL(newtabUrl(t.private));
  else view.webContents.loadURL(t.url).catch(() => {});
}

// 案件（スポンサー）区間を SponsorBlock から取ってきて、ページの中の飛ばす仕組みに渡す
async function sendSponsor(wc, url) {
  const id = youtube.videoIdOf(url);
  if (!id) return;
  const segs = await sponsorblock.segmentsFor(id);
  if (wc.isDestroyed() || youtube.videoIdOf(wc.getURL()) !== id) return;
  wc.executeJavaScript(`window.__mbSponsor && window.__mbSponsor.set(${JSON.stringify(id)}, ${JSON.stringify(segs)})`).catch(() => {});
}

// タブのページの出来事（読み込み・タイトル・エラーなど）を受け取る
function wireView(t, view) {
  const wc = view.webContents;
  if (extOk(wc)) extensions.addTab(wc, win);
  // 画面分割中：クリックしたページを選択中のタブにする
  wc.on('focus', () => { if (t.id !== activeId && t.view === view && paneRects[t.id]) activateTab(t.id, { focus: false }); });
  // 新しいタブの検索欄：入力は #q=... としてここに届くので、設定の検索エンジンで開く
  // 使いすぎ防止：上限を超えたサイトを開いたら、上限の画面にする。上限の画面のボタン（#more / #close）を受け取る
  wc.on('did-navigate', (_, url) => {
    const site = limitSiteOf(url);
    if (site && overLimit(site)) showLimit(t, site);
  });
  wc.on('did-navigate-in-page', (_, url) => {
    if (!isLimitPage(url)) return;
    const m = url.match(/#(more|close)$/);
    if (!m) return;
    const site = new URL(url).searchParams.get('site') || '';
    if (m[1] === 'more' && settings.limits[site]) {
      const u = usageToday();
      u.extra[site] = (u.extra[site] || 0) + 5 * 60;
      saveSoon();
      wc.loadURL(t.limitedUrl || ('https://' + site + '/')).catch(() => {});
    } else if (m[1] === 'close') closeTab(t.id);
  });
  // YouTube の中で別の動画に移ったら、その動画の案件区間を取ってくる
  wc.on('did-navigate-in-page', (_, url, isMain) => { if (isMain !== false && settings.sponsorSkip) sendSponsor(wc, url); });
  // ページの中から届く「飛ばした時間」（YouTube の保険のスクリプトが書き出す）
  wc.on('console-message', e => {
    const m = /^\[mb-stat\] (ad|sponsor) (\d{1,5})$/.exec(e.message || '');
    if (m && youtube.isYouTube(wc.getURL())) statsAdd(m[1] === 'ad' ? 'adSec' : 'sponsorSec', Number(m[2]));
  });
  wc.on('did-navigate-in-page', (_, url) => {
    const m = isNewTab(url) && url.match(/#q=(.*)$/);
    if (m) { const target = toURL(decodeURIComponent(m[1])); if (target) wc.loadURL(target); }
  });

  const update = () => {
    if (wc.isDestroyed()) return;
    t.url = wc.getURL();
    t.title = isInternal(t.url) ? '' : wc.getTitle();
    if (isInternal(t.url)) t.favicon = '';
    if (!t.private && settings.saveHistory && !t.error) history.setTitle(t.url, t.title);
    sendState();
    saveSoon();
  };
  if (DEBUG) {
    let navStart = 0;
    wc.on('did-start-navigation', (e, u, inPlace, isMain) => { if ((e.isMainFrame ?? isMain) && !(e.isSameDocument ?? inPlace)) navStart = Date.now(); });
    wc.on('dom-ready', () => { if (navStart) dlog('[perf] dom-ready', (Date.now() - navStart) + 'ms', wc.getURL().slice(0, 100)); });
    wc.on('did-finish-load', () => { if (navStart) dlog('[perf] load', (Date.now() - navStart) + 'ms', wc.getURL().slice(0, 100)); });
  }
  wc.on('dom-ready', () => {
    const url = wc.getURL();
    if (isInternal(url)) paintTheme(wc);
    injectHideRules(wc, url);
    if (isNewTab(url)) wc.executeJavaScript(`window.mbStats && window.mbStats(${JSON.stringify(statsNow())})`).catch(() => {});
    if (settings.sponsorSkip && youtube.isYouTube(url)) { wc.executeJavaScript(youtube.SPONSOR_SCRIPT).catch(() => {}); sendSponsor(wc, url); }
    // YouTube：広告カードを隠し、動画広告を飛ばす（リストのルールが効かなかったときの保険）
    if (DEBUG && youtube.isYouTube(url)) wc.executeJavaScript(youtube.PERF_SCRIPT).catch(() => {});
    if (settings.adblock && youtube.isYouTube(url) && !settings.adblockAllow.includes(hostOf(url)) && !liveFlag('yt-noguard.flag')) {
      wc.executeJavaScript(youtube.SCRIPT).catch(() => {});
      if (DEBUG) dlog('[yt-guard] injected', url.slice(0, 120));
    }
    // X：「プロモーション」の投稿を隠す（データから取り除けなかったときの保険）
    if (settings.adblock && xAds.isX(url) && !settings.adblockAllow.includes(hostOf(url))) {
      wc.executeJavaScript(xAds.SCRIPT).catch(() => {});
    }
  });
  wc.on('page-title-updated', (_, title) => {
    // エラーページのボタンからの合図
    if (t.error && title.startsWith('#mb:')) return onErrorSignal(t, title.slice(4));
    update();
  });
  wc.on('did-start-navigation', (e, legacyUrl, _inPlace, legacyMain) => {
    const main = e.isMainFrame ?? legacyMain;
    const sameDoc = e.isSameDocument ?? _inPlace;
    if (main && !sameDoc) {
      t.error = null;
      adblock.resetCount(wc.id);
      security.navigated(wc.id);
      stopTranslate(t);
      t.pageLang = '';
      if (popupMode === 'pw' && pwContext?.wcId === wc.id) closePopup();
      if (findState.tabId === t.id) closeFind();
      // 前のページで出た「ポップアップをブロックしました」は消す
      const before = cards.length;
      cards = cards.filter(c => !(c.kind === 'popup' && c.tabId === t.id));
      if (cards.length !== before) sendOverlay();
    }
  });
  wc.on('did-navigate', (_, url) => {
    security.upgradeSucceeded(url);
    injectCosmeticCss(wc, url);
    injectHideRules(wc, url);
    if (!t.private && settings.saveHistory && /^https?:/i.test(url)) history.visit(url, wc.getTitle());
    update();
  });
  wc.on('did-navigate-in-page', update);
  wc.on('did-start-loading', () => { t.loading = true; sendState(); });
  wc.on('did-stop-loading', () => { t.loading = false; update(); detectLang(t); });
  wc.on('did-fail-load', (_, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = 中断（別のページへ移動した等）
    showError(t, { kind: security.failedUpgrade(url) ? 'https' : 'error', code, desc, url });
  });
  wc.on('render-process-gone', (_, d) => {
    if (d.reason === 'clean-exit') return;
    const url = t.error?.url || t.url;
    t.loading = false;
    // 落ちたページの代わりに「問題が発生しました」を表示する
    wc.loadURL('about:blank').then(() => showError(t, { kind: 'crash', url })).catch(() => {});
    sendState();
  });
  wc.on('page-favicon-updated', (_, icons) => {
    // シークレットタブのアイコンは読み込まない（普段のCookieで外部に問い合わせてしまうため）
    t.favicon = t.private ? '' : (icons[0] || '');
    const f = t.favId && settings.favorites.find(x => x.id === t.favId);
    if (f && !f.favicon) f.favicon = t.favicon;
    sendState();
    saveSoon();
  });
  wc.on('audio-state-changed', () => sendState());
  wc.on('zoom-changed', (_, dir) => zoom(dir === 'in' ? 0.5 : -0.5, wc));
  wc.on('found-in-page', (_, r) => {
    if (findState.tabId !== t.id) return;
    findState.matches = r.matches;
    findState.index = r.activeMatchOrdinal;
    sendOverlay();
  });
  // 動画などの全画面表示
  wc.on('enter-html-full-screen', () => {
    fullscreenTab = t.id;
    if (!win.isFullScreen()) { fullscreenByPage = true; win.setFullScreen(true); }
    layout();
    // 偽のアドレスバーなどにだまされないよう、全画面になったことと抜け方を知らせる
    showCard({ id: 'fullscreen', kind: 'info', tabId: t.id, host: hostOf(wc.getURL()) || tr('common.thisPage'), text: tr('card.fullscreen'), timeout: 3500 });
  });
  wc.on('leave-html-full-screen', () => exitPageFullscreen());
}

// ページ側の JavaScript に邪魔されないよう、別の実行環境（isolated world）で全画面を解除する
function forceExitFullscreen() {
  const wc = findTab(fullscreenTab)?.view?.webContents;
  if (!wc) return exitPageFullscreen();
  wc.executeJavaScriptInIsolatedWorld(1001, [{ code: 'document.fullscreenElement && document.exitFullscreen()' }]).catch(() => {});
  // ページが解除しなくても、ブラウザ側の表示は元に戻す
  setTimeout(() => { if (fullscreenTab != null) exitPageFullscreen(); }, 400);
}

function exitPageFullscreen() {
  if (fullscreenTab == null) return;
  fullscreenTab = null;
  if (fullscreenByPage) { fullscreenByPage = false; win.setFullScreen(false); }
  layout();
}

function unloadView(t) {
  if (!t.view) return;
  const wc = t.view.webContents;
  if (fullscreenTab === t.id) exitPageFullscreen();
  if (findState.tabId === t.id) closeFind();
  security.forget(wc.id);
  adblock.resetCount(wc.id);
  stopTranslate(t);
  // 先にタブから外してから閉じる（閉じた知らせを受けた拡張機能などが、このタブを探しても見つからないように）
  const view = t.view;
  t.view = null;
  t.loading = false;
  win.contentView.removeChildView(view);
  if (!wc.isDestroyed()) wc.close();
  if (t.error) { t.url = t.error.url; t.error = null; }
}

// ---- 読み込みエラー ----
function showError(t, { kind, code = 0, desc = '', url }) {
  const wc = t.view?.webContents;
  if (!wc || wc.isDestroyed()) return;
  t.error = { kind, code, url };
  t.favicon = '';
  const js = errorPage.script({ kind, code, desc, url, dark: isDark(), t: tr });
  // エラーページが表示されてから書き込む
  const inject = (n = 0) => wc.executeJavaScript(js).catch(() => { if (n < 5) setTimeout(() => inject(n + 1), 120); });
  setTimeout(inject, 30);
  sendState();
}

// エラーページごとに使えるボタン
const ERROR_SIGNALS = { error: ['retry', 'back'], https: ['back', 'http'], crash: ['retry'] };
function onErrorSignal(t, sig) {
  const wc = t.view?.webContents;
  const url = t.error?.url;
  if (!wc || !url) return;
  // 今表示しているエラーページのボタンからの合図だけを受け付ける
  if (!ERROR_SIGNALS[t.error.kind]?.includes(sig)) return;
  if (!/^(chrome-error:|about:blank)/.test(wc.getURL()) && wc.getURL() !== url) return;
  if (sig === 'retry' && t.error.code <= -200 && t.error.code > -300) return;
  if (sig === 'retry') { t.error = null; wc.loadURL(url).catch(() => {}); }
  if (sig === 'back') {
    t.error = null;
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); else wc.loadURL(newtabUrl(t.private));
  }
  if (sig === 'http') {
    const host = hostOf(url);
    security.allowHttp(host);
    t.error = null;
    wc.loadURL('http://' + url.replace(/^https:\/\//i, '')).catch(() => {});
  }
}

function activateTab(id, { focus = true } = {}) {
  const t = findTab(id);
  if (!t) return;
  const prev = activeTab();
  if (prev && prev.id !== id) prev.lastUsed = Date.now();
  if (findState.tabId != null && findState.tabId !== id) closeFind();
  if (fullscreenTab != null && fullscreenTab !== id) exitPageFullscreen();
  if (glance) closeGlance(false);
  if (popupMode === 'pw') closePopup();
  // 動画を再生しているタブから離れたら小窓（ピクチャーインピクチャー）にし、戻ってきたら元に戻す
  if (prev && prev.id !== id && !(splitOf(id) || []).includes(prev.id)) autoPip(prev, true);
  autoPip(t, false);
  activeId = id;
  t.lastUsed = Date.now();
  if (!t.private || t.profileId) lastActive[settings.profileId] = id;
  // 画面分割のグループなら、並んでいるタブもまとめて表示する
  for (const mid of splitOf(id) || [id]) { const m = findTab(mid); if (m) { loadView(m); m.lastUsed = Date.now(); } }
  if (extOk(t.view.webContents)) extensions.selectTab(t.view.webContents);
  layout();
  sendState();
  sendOverlay();
  sendAIContext();
  saveSoon();
  if (focus) t.view.webContents.focus();
}

// ===== 使いすぎ防止（サイトごとの1日の上限） =====
const dayKey = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const isLimitPage = url => /^mb:\/\/ui\/limit\.html/.test(url || '');
// URL がどの「上限を決めたサイト」に当たるか（サブドメインも同じサイトとして数える）
function limitSiteOf(url) {
  const host = hider.siteOf(url);
  if (!host) return '';
  return Object.keys(settings.limits || {}).find(s => host === s || host.endsWith('.' + s)) || '';
}
function usageToday() {
  const u = settings.usage || (settings.usage = {});
  if (u.day !== dayKey()) Object.assign(u, { day: dayKey(), sites: {}, extra: {} });
  u.sites ||= {}; u.extra ||= {};
  return u;
}
const overLimit = site => {
  const u = usageToday();
  return !!site && (u.sites[site] || 0) >= settings.limits[site] * 60 + (u.extra[site] || 0);
};
function showLimit(t, site) {
  if (!t?.view || t.view.webContents.isDestroyed()) return;
  t.limitedUrl = t.view.webContents.getURL();
  t.view.webContents.loadURL(uiUrl('limit.html', { site, mins: settings.limits[site] })).catch(() => {});
}
// 5秒ごとに、前に出ているタブのサイトの時間を数える（ウィンドウが前にあるときだけ）
function tickUsage() {
  if (!win || win.isDestroyed() || !win.isFocused() || win.isMinimized()) return;
  const shown = [...new Set([activeId, ...(splitOf(activeId) || [])])].map(findTab).filter(Boolean);
  for (const t of shown) {
    if (!t.view || t.view.webContents.isDestroyed()) continue;
    const site = limitSiteOf(t.view.webContents.getURL());
    if (!site) continue;
    const u = usageToday();
    u.sites[site] = (u.sites[site] || 0) + 5;
    if (overLimit(site)) showLimit(t, site);
  }
  saveSoon();
}

// ===== 動画の自動小窓（ピクチャーインピクチャー） =====
const PIP_ON = `(() => {
  if (document.pictureInPictureElement || !document.pictureInPictureEnabled) return false;
  // 再生中で、音が出ていて、ある程度大きい動画（広告の小さなプレビューなどは対象外）
  const vids = [...document.querySelectorAll('video')].filter(v => !v.paused && !v.ended && v.readyState > 2 && !v.muted && v.videoWidth > 0 &&
    v.getBoundingClientRect().width > 200 && !v.disablePictureInPicture);
  const v = vids.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  if (!v) return false;
  v.dataset.mbAutoPip = '1';
  return v.requestPictureInPicture().then(() => true, () => false);
})()`;
const PIP_OFF = `(() => {
  const v = document.pictureInPictureElement;
  if (v && v.dataset.mbAutoPip === '1') { delete v.dataset.mbAutoPip; document.exitPictureInPicture().catch(() => {}); }
})()`;
function autoPip(t, on) {
  if (!settings.autoPip || !t?.view) return;
  const wc = t.view.webContents;
  if (wc.isDestroyed() || isInternal(wc.getURL())) return;
  // 小窓にするには「操作した」扱いが必要なので、ユーザー操作として実行する
  if (on) { if (wc.isCurrentlyAudible()) wc.executeJavaScript(PIP_ON, true).catch(() => {}); }
  else wc.executeJavaScript(PIP_OFF, true).catch(() => {});
}

// 今のプロフィールで表示する順番（固定 → 今日）
function orderedTabs() {
  const mine = tabs.filter(t => t.profileId === settings.profileId);
  return [...mine.filter(t => t.pinned), ...mine.filter(t => !t.pinned)];
}

function pickNext(exceptId) {
  const list = orderedTabs().filter(t => t.id !== exceptId);
  return list.find(t => !t.pinned) || list[0] || null;
}

function closeTab(id) {
  const t = findTab(id);
  if (!t) return;
  const order = orderedTabs();
  const pos = order.findIndex(x => x.id === id);
  // 画面分割で並んでいたら、残ったタブを選ぶ
  const mate = (splitOf(id) || []).find(x => x !== id && findTab(x));
  removeFromSplit(id);
  unloadView(t);
  if (t.favId) {
    // お気に入りのタブは休止させるだけ（お気に入り自体は残る）
    const f = settings.favorites.find(x => x.id === t.favId);
    tabs = tabs.filter(x => x.id !== id);
    if (f) t.url = f.url;
  } else if (t.pinned) {
    // 固定タブは消さずに休止させて、固定したときのページに戻す
    t.url = t.pinnedUrl || '';
  } else {
    if (!isInternal(t.url) && !t.private) closedStack.push(t.url);
    tabs = tabs.filter(x => x.id !== id);
  }
  if (t.private) clearPrivateIfUnused();
  if (activeId === id) {
    const rest = orderedTabs().filter(x => x.id !== id);
    const near = (mate && findTab(mate)) || rest[Math.min(Math.max(pos, 0), rest.length - 1)];
    if (near) activateTab(near.id); else newTab();
  } else { layout(); sendState(); saveSoon(); }
}

// ---- 画面分割（2〜4つのタブを横に並べる） ----
const splitOf = id => (id == null ? null : splits.find(g => g.includes(id)) || null);
function pruneSplits() {
  splits = splits.map(g => g.filter(id => findTab(id))).filter(g => g.length > 1);
}
function removeFromSplit(id) {
  const g = splitOf(id);
  if (!g) return;
  g.splice(g.indexOf(id), 1);
  pruneSplits();
}
// anchorId のタブの右に id のタブを並べる
function splitWith(anchorId, id) {
  const a = findTab(anchorId);
  const t = findTab(id);
  if (!a || !t || a.id === t.id) return false;
  removeFromSplit(t.id);
  let g = splitOf(a.id);
  if (g && g.length >= SPLIT_MAX) {
    showCard({ id: 'split-full', kind: 'info', tabId: null, host: tr('split.title'), text: tr('split.full', { n: SPLIT_MAX }), timeout: 3500 });
    activateTab(t.id);
    return false;
  }
  if (!g) { g = [a.id]; splits.push(g); }
  g.splice(g.indexOf(a.id) + 1, 0, t.id);
  // サイドバーでも隣に並べる
  if (!a.favId && !t.favId && !t.pinned && !a.pinned && a.profileId === t.profileId) {
    tabs = tabs.filter(x => x !== t);
    tabs.splice(tabs.indexOf(a) + 1, 0, t);
  }
  activateTab(t.id);
  return true;
}
function unsplit(id) {
  const g = splitOf(id);
  if (!g) return;
  splits = splits.filter(x => x !== g);
  layout();
  sendState();
  cur()?.focus();
}
// 新しいタブで開いて今のタブの横に並べる
function openBeside(url, from = activeTab()) {
  if (!from) return newTab(url);
  const t = addTab({ url, private: from.private, profileId: from.profileId || settings.profileId }, { activate: false });
  splitWith(from.id, t.id);
  return t;
}

// folderId：入れるフォルダ（null = フォルダの外、undefined = 前に置くタブと同じところ）
function moveTab(id, beforeId, pinned, folderId) {
  const t = findTab(id);
  if (!t || t.favId) return;
  if (t.private && pinned) return; // シークレットタブは固定できない（保存されないため）
  if (folderId === undefined) { const b = beforeId == null ? null : findTab(beforeId); folderId = b?.pinned ? (b.folderId || null) : null; }
  if (folderId && !settings.folders.some(f => f.id === folderId)) folderId = null;
  tabs = tabs.filter(x => x.id !== id);
  if (pinned !== t.pinned) {
    t.pinned = pinned;
    t.pinnedUrl = pinned ? (isInternal(t.url) ? '' : savedUrl(t)) : null;
  }
  t.folderId = pinned ? folderId : null;
  let j = beforeId == null ? -1 : tabs.findIndex(x => x.id === beforeId);
  if (j < 0) j = tabs.length;
  tabs.splice(j, 0, t);
  sendState();
  saveSoon();
}

// ===== 2台のPCで同期 =====
let sync = null;
function applyRemoteSettings(data) {
  // ほかのPCにないプロフィールでも、このPCでタブを開いているものは残す
  if (Array.isArray(data.profiles) && data.profiles.length) {
    const keep = settings.profiles.filter(p => !data.profiles.some(q => q.id === p.id) && tabs.some(t => t.profileId === p.id));
    data.profiles = [...data.profiles, ...keep];
  } else delete data.profiles;
  Object.assign(settings, data);
  settings.colors = { side: '', top: '', alpha: 60, ...(settings.colors || {}) };
  if (!settings.profiles.some(p => p.id === settings.profileId)) switchProfile(settings.profiles[0].id);
  applyTheme();
  sendState();
  sendSettings();
  saveSettings(true);
  showCard({ id: 'sync', kind: 'info', tabId: null, host: tr('sync.title'), text: tr('sync.applied'), timeout: 3000 });
}
function startSync() {
  if (!sync) sync = createSync({ settings: () => settings, onRemote: applyRemoteSettings, log: (...a) => dlog(...a) });
  sync.start();
}

// ===== 固定タブのフォルダ =====
function createFolder(tabId) {
  const f = { id: 'fd' + Date.now().toString(36), name: tr('folder.new'), open: true, profileId: settings.profileId };
  settings.folders.push(f);
  if (tabId != null) moveTab(tabId, null, true, f.id);
  sendState();
  saveSoon();
  ui?.webContents.send('folder-rename', f.id); // すぐに名前を付けられるように
  return f;
}
function deleteFolder(id) {
  for (const t of tabs) if (t.folderId === id) t.folderId = null;
  settings.folders = settings.folders.filter(f => f.id !== id);
  sendState();
  saveSoon();
}

// ===== 使っていないタブの自動アーカイブ =====
const ARCHIVE_CHOICES = [0, 12, 24, 72, 168]; // 時間
function archiveTab(t) {
  if (!t || t.private || t.pinned || t.favId || isInternal(t.url) || !/^https?:/i.test(t.url || '')) return;
  settings.archive = (settings.archive || []).filter(a => a.url !== t.url);
  settings.archive.unshift({ url: t.url, title: displayTitle(t), favicon: t.favicon || '', profileId: t.profileId, at: Date.now() });
  settings.archive = settings.archive.slice(0, 300);
}
function archiveIdleTabs() {
  const hours = settings.archiveAfter;
  if (!hours) return;
  const limit = Date.now() - hours * 3600 * 1000;
  const shown = new Set([activeId, ...(splitOf(activeId) || [])]);
  const old = tabs.filter(t => !t.pinned && !t.favId && !t.private && !shown.has(t.id) && (t.lastUsed || 0) < limit &&
    !(t.view && !t.view.webContents.isDestroyed() && t.view.webContents.isCurrentlyAudible()));
  if (!old.length) return;
  for (const t of old) { archiveTab(t); closeTab(t.id); }
  sendSettings();
  saveSoon();
}

function clearTabs() {
  const pid = settings.profileId;
  // 「整理」で閉じたタブもアーカイブに残す（あとから開き直せるように）
  for (const t of tabs.filter(x => x.profileId === pid && !x.pinned)) archiveTab(t);
  for (const t of tabs.filter(x => x.profileId === pid && !x.pinned)) unloadView(t);
  tabs = tabs.filter(x => x.profileId !== pid || x.pinned);
  pruneSplits();
  clearPrivateIfUnused();
  if (!findTab(activeId)) {
    const next = pickNext(null);
    if (next) activateTab(next.id); else newTab();
  } else { layout(); sendState(); saveSoon(); }
}

function cycleTab(step) {
  const list = orderedTabs();
  if (!list.length) return;
  const i = list.findIndex(t => t.id === activeId);
  activateTab(list[(i + step + list.length) % list.length].id);
}

// ---- シークレットタブ（Cookieや履歴を残さない。メモリ上だけのセッション） ----
let privateSession = null;
function getPrivateSession() {
  if (!privateSession) {
    privateSession = session.fromPartition('mb-private'); // "persist:" を付けない＝ディスクに保存しない
    registerUiProtocol(privateSession); // シークレットタブの「新しいタブ」画面用
    setupSession(privateSession);
  }
  return privateSession;
}
// ---- プロフィールごとのログイン情報（「ログイン情報を分ける」をオンにしたプロフィールは専用のセッション） ----
const profileSessions = new Map();
const profileOf = pid => settings.profiles.find(p => p.id === pid);
const sessionKey = pid => (profileOf(pid)?.separate ? pid : 'default');
function sessionFor(pid) {
  const key = sessionKey(pid);
  if (key === 'default') return session.defaultSession;
  let s = profileSessions.get(key);
  if (!s) {
    s = session.fromPartition('persist:mb-profile-' + key);
    registerUiProtocol(s);
    setupSession(s);
    profileSessions.set(key, s);
  }
  return s;
}
// 閲覧データの削除などで使う：使っているすべての保存されるセッション
function allSessions() {
  const list = [session.defaultSession];
  for (const p of settings.profiles) if (p.separate) list.push(sessionFor(p.id));
  return [...new Set(list)];
}

// シークレットタブがすべて閉じられたら、ログイン情報などを消す
function clearPrivateIfUnused() {
  if (!privateSession || tabs.some(t => t.private)) return;
  privateSession.clearStorageData().catch(() => {});
  privateSession.clearCache().catch(() => {});
}

// ===== 使っていないタブの自動休止（メモリを空ける） =====
function sleepIdleTabs(force = false) {
  const limit = settings.sleepAfter * 60 * 1000;
  if (!force && !limit) return 0;
  const now = Date.now();
  let n = 0;
  for (const t of tabs) {
    if (!t.view || t.id === activeId || paneRects[t.id]) continue;
    const wc = t.view.webContents;
    // 音が鳴っているタブ・開発者ツールを開いているタブはそのまま
    if (wc.isCurrentlyAudible() || wc.isDevToolsOpened()) continue;
    if (!force && now - t.lastUsed < limit) continue;
    unloadView(t);
    n++;
  }
  // 閉じたままのAIパネルも休止
  if (aiView && !settings.sideOpen && (force || (limit && now - aiClosedAt > limit))) {
    win.contentView.removeChildView(aiView);
    aiView.webContents.close();
    aiView = null;
    n++;
  }
  if (n) { layout(); sendState(); }
  return n;
}

function metrics() {
  const procs = app.getAppMetrics();
  // Windowsでは private（そのプロセスだけが使っている量）、それ以外は working set
  const kb = procs.reduce((s, p) => s + (p.memory?.privateBytes || p.memory?.workingSetSize || 0), 0);
  return {
    mb: Math.round(kb / 1024),
    live: tabs.filter(t => t.view).length,
    sleeping: tabs.filter(t => !t.view).length,
    ai: !!aiView,
  };
}

// ===== 設定パネル（右上に浮かぶ） =====
let settingsTab = 'general';
function openSettings(tab) {
  if (tab) settingsTab = tab;
  if (!panel) {
    panel = createInternalView('settings.html');
    panel.webContents.on('dom-ready', () => { sendSettings(); panel.webContents.send('settings-tab', settingsTab); });
  }
  closePopup();
  win.contentView.addChildView(panel); // 一番上に
  panel.setVisible(true);
  panelOpen = true;
  layout();
  sendSettings();
  panel.webContents.send('settings-tab', settingsTab);
  panel.webContents.focus();
  ui.webContents.send('settings-open', true);
}
function closeSettings() {
  if (!panelOpen) return;
  panelOpen = false;
  panel.setVisible(false);
  ui.webContents.send('settings-open', false);
  cur()?.focus();
}
const toggleSettings = tab => (panelOpen && (!tab || tab === settingsTab) ? closeSettings() : openSettings(tab));

// 設定画面に今の設定を送る
function sendSettings() {
  if (!panel || !panelOpen) return;
  const data = {
    theme: settings.theme, sidebarW: settings.sidebarW, aiW: settings.aiW,
    colors: settings.colors,
    sideButtons: settings.sideButtons,
    searchEngine: settings.searchEngine, engines: Object.entries(ENGINES).map(([id, e]) => ({ id, name: e.name })),
    restoreTabs: settings.restoreTabs,
    aiIndex: settings.aiMode === 'api' ? -1 : settings.aiIndex, ai: config.ai.map(a => a.name),
    defaults: { sidebarW: config.sidebarWidth || 250, aiW: config.aiWidth || 420 },
    limits: { SIDEBAR_MIN, SIDEBAR_MAX, AI_MIN, AI_MAX },
    profiles: settings.profiles.map(p => ({ ...p, name: profileName(p), pinned: tabs.filter(t => t.profileId === p.id && t.pinned).length })),
    lang: settings.lang,
    profileId: settings.profileId,
    favorites: settings.favorites,
    adblock: settings.adblock, adblockAllow: settings.adblockAllow, adblockStatus: adblock.status(), sponsorSkip: settings.sponsorSkip, autoPip: settings.autoPip, stats: statsNow(), hideRules: settings.hideRules, limits: settings.limits, usageToday: usageToday().sites, archive: settings.archive.slice(0, 100), archiveAfter: settings.archiveAfter, archiveChoices: ARCHIVE_CHOICES, syncDir: settings.syncDir, syncDefault: require('./lib/sync').defaultDir(),
    httpsOnly: settings.httpsOnly, httpsExceptions: settings.httpsExceptions,
    gpc: settings.gpc, saveHistory: settings.saveHistory,
    permissions: security.allPermissions(), popupsAllow: settings.popupsAllow,
    sleepAfter: settings.sleepAfter, sleepChoices: SLEEP_CHOICES,
    downloadDir: downloads.dir(), askDownload: settings.askDownload,
    autoUpdate: settings.autoUpdate, update: updater?.status(),
    passwordSave: settings.passwordSave,
    passwords: passwords ? passwords.list() : [], passwordsNever: passwords ? passwords.neverList() : [],
    passwordsAvailable: !!passwords?.available(),
    bookmarkCount: settings.bookmarks.length,
    translateEngine: settings.translateEngine, deeplKeySet: !!settings.deeplKey,
    about: {
      name: 'My Browser', version: app.getVersion(), packaged: app.isPackaged, platform: process.platform,
      electron: process.versions.electron, chrome: process.versions.chrome,
    },
  };
  panel.webContents.send('settings', data);
}

// ブラウザ自身の画面（設定・カード・ポップアップ）を作る。ここだけ preload（橋渡し）を付ける
function createInternalView(file, query) {
  const v = new WebContentsView({ webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, spellcheck: false } });
  v.setBackgroundColor('#00000000');
  trust(v.webContents);
  lockDown(v.webContents);
  handleKeys(v.webContents);
  v.webContents.on('dom-ready', () => paintTheme(v.webContents));
  v.webContents.loadURL(uiUrl(file, query));
  win.contentView.addChildView(v);
  return v;
}

// ===== ページ右上のカード（ページ内検索・権限の確認・ポップアップのブロック・通知） =====
const findState = { tabId: null, text: '', matches: 0, index: 0 };
let lastFindText = '';
let cards = [];
let overlayHeight = 0;

function ensureOverlay() {
  if (overlay) return;
  overlay = createInternalView('overlay.html', { mode: 'stack' });
  overlay.setVisible(false);
  overlay.webContents.on('dom-ready', () => sendOverlay());
  if (panelOpen) win.contentView.addChildView(panel);
}

function overlayCards() {
  // 今のタブ（またはAIパネル・タブ共通）のものだけ見せる
  return cards.filter(c => c.tabId == null || c.tabId === activeId || c.tabId === 'ai').slice(-4);
}

function sendOverlay() {
  if (!overlay) return;
  const find = findState.tabId != null && findState.tabId === activeId ? findState : null;
  overlay.webContents.send('overlay', { find, cards: overlayCards() });
  if (!find && !overlayCards().length) { overlayHeight = 0; placeOverlay(); }
}

function placeOverlay() {
  if (!overlay) return;
  const show = overlayHeight > 0;
  overlay.setVisible(show);
  if (!show) return;
  overlay.setBounds({
    x: Math.round(pageRect.x + pageRect.width - OVERLAY_W + PAD - 10), y: pageRect.y + 6,
    width: OVERLAY_W, height: Math.min(overlayHeight, pageRect.height - 12),
  });
}

function showCard(card) {
  ensureOverlay();
  cards = cards.filter(c => c.id !== card.id);
  cards.push(card);
  if (cards.length > 12) cards.shift();
  if (card.timeout) setTimeout(() => removeCard(card.id), card.timeout);
  sendOverlay();
}
function removeCard(id) {
  pendingPasswords.delete(id);
  const before = cards.length;
  cards = cards.filter(c => c.id !== id);
  if (cards.length !== before) sendOverlay();
}

function cardAction(id, action) {
  const c = cards.find(x => x.id === id);
  if (!c) return;
  if (c.kind === 'permission') return security.answer(id, action === 'allow');
  if (c.kind === 'popup') {
    if (action === 'open') addTab({ url: c.url, private: c.private });
    if (action === 'always' && c.host) {
      if (c.private) privatePopupsAllow.add(c.host);
      else if (!settings.popupsAllow.includes(c.host)) { settings.popupsAllow.push(c.host); saveSoon(); sendSettings(); }
      addTab({ url: c.url, private: c.private });
    }
  }
  if (c.kind === 'download') downloads.action(c.downloadId, action);
  if (c.kind === 'password') {
    const p = pendingPasswords.get(id);
    if (p && action === 'save') passwords.upsert(p.origin, p.username, p.password);
    if (p && action === 'never') passwords.never(p.origin);
    sendSettings();
  }
  removeCard(id);
}

// ---- ページ内検索 ----
function openFind() {
  const t = activeTab();
  if (!t?.view) return;
  ensureOverlay();
  if (findState.tabId !== t.id) Object.assign(findState, { tabId: t.id, matches: 0, index: 0 });
  sendOverlay();
  overlay.webContents.focus();
  overlay.webContents.send('find-focus');
}
// followUp: 同じ語で「次へ／前へ」。false なら新しく検索を始める
// （Electron の findNext は「新しく検索を始めるか」なので逆になる）
function doFind(text, forward = true, followUp = false) {
  const t = findTab(findState.tabId);
  const wc = t?.view?.webContents;
  if (!wc) return;
  findState.text = text;
  if (!text) { wc.stopFindInPage('clearSelection'); lastFindText = ''; findState.matches = 0; findState.index = 0; sendOverlay(); return; }
  if (text !== lastFindText) followUp = false;
  lastFindText = text;
  wc.findInPage(text, { forward, findNext: !followUp });
}
function closeFind() {
  lastFindText = '';
  const t = findTab(findState.tabId);
  t?.view?.webContents.stopFindInPage('clearSelection');
  findState.tabId = null;
  findState.matches = 0;
  sendOverlay();
}

// ===== 小さなポップアップ（URL欄の候補・サイト情報・ダウンロード一覧） =====
let popupMode = null;
let popupAnchor = null;    // { x, y, width }
let popupSize = { width: 320, height: 0 };
let popupData = null;
let popupHiddenAt = 0;
let popupHiddenMode = null;

function ensurePopup() {
  if (popup) return;
  popup = createInternalView('overlay.html', { mode: 'popup' });
  popup.setVisible(false);
  popup.webContents.on('dom-ready', () => sendPopup());
  // サイト情報・ダウンロードは、外をクリックしたら閉じる
  popup.webContents.on('blur', () => { if (popupMode && popupMode !== 'suggest' && popupMode !== 'pw') closePopup(); });
  if (panelOpen) win.contentView.addChildView(panel);
}

function openPopup(mode, anchor, data) {
  // 開いているポップアップのボタンをもう一度押したときは、閉じたままにする
  if (mode !== 'suggest' && mode !== 'pw' && popupHiddenMode === mode && Date.now() - popupHiddenAt < 250) return;
  ensurePopup();
  // ダウンロード一覧を開いたら、「ダウンロード完了」の知らせは片付ける
  if (mode === 'downloads') { cards = cards.filter(c => c.kind !== 'download'); sendOverlay(); }
  popupMode = mode;
  popupAnchor = anchor;
  popupData = data || null;
  popupSize = { width: anchor.width || 320, height: 0 };
  win.contentView.addChildView(popup); // 一番上へ
  sendPopup();
  if (mode !== 'suggest' && mode !== 'pw') popup.webContents.focus();
}

function closePopup() {
  if (!popupMode) return;
  popupHiddenMode = popupMode;
  popupHiddenAt = Date.now();
  popupMode = null;
  pwContext = null;
  popup?.setVisible(false);
  popup?.webContents.send('popup', { mode: null });
}

function placePopup() {
  if (!popup || !popupMode || !popupAnchor || !popupSize.height) { popup?.setVisible(false); return; }
  const [w, h] = win.getContentSize();
  const width = Math.min(popupSize.width, w - 16);
  // 中のカードの周りに影用の余白（左右 PAD）があるので、その分ずらす
  let x = Math.round(popupAnchor.align === 'right' ? popupAnchor.x + popupAnchor.width - width + PAD : popupAnchor.x - PAD);
  x = Math.max(0, Math.min(x, w - width));
  const y = Math.round(popupAnchor.y);
  popup.setBounds({ x, y, width, height: Math.min(popupSize.height, h - y - 8) });
  popup.setVisible(true);
}

function sendPopup() {
  if (!popup || !popupMode) return;
  let data = popupData;
  if (popupMode === 'site') data = siteInfo();
  if (popupMode === 'downloads') data = { items: downloads.list(), dir: downloads.dir() };
  popup.webContents.send('popup', { mode: popupMode, data, width: popupAnchor?.width });
}

// 鍵マークを押したときの情報
function siteInfo() {
  const t = activeTab();
  const url = t ? displayUrl(t) : '';
  const origin = originOf(url);
  const host = hostOf(url);
  const wc = t?.view?.webContents;
  return {
    url, host, origin, state: t ? securityState(t) : 'internal', private: !!t?.private,
    perms: origin ? security.sitePermissions(origin) : [],
    adblock: settings.adblock, adblockSite: !!host && !settings.adblockAllow.includes(host),
    blocked: wc && !wc.isDestroyed() ? adblock.blockedCount(wc.id) : 0,
    popups: !!host && settings.popupsAllow.includes(host),
    zoom: wc && !wc.isDestroyed() ? Math.round(wc.getZoomFactor() * 100) : 100,
  };
}

// URL欄の候補（検索・お気に入り・履歴）
function suggestions(q) {
  const text = String(q || '').trim();
  if (!text) return [];
  const out = [];
  const url = toURL(text);
  const looksUrl = url && !url.startsWith(ENGINES[settings.searchEngine].url);
  if (looksUrl) out.push({ kind: 'url', title: text, url });
  out.push({ kind: 'search', title: text, url: ENGINES[settings.searchEngine].url + encodeURIComponent(text), engine: ENGINES[settings.searchEngine].name });
  const seen = new Set(out.map(x => x.url));
  const low = text.toLowerCase();
  for (const f of settings.favorites) {
    if (seen.has(f.url) || !(f.url.toLowerCase().includes(low) || (f.title || '').toLowerCase().includes(low))) continue;
    out.push({ kind: 'favorite', title: f.title, url: f.url, favicon: f.favicon });
    seen.add(f.url);
  }
  let nb = 0;
  for (const b of settings.bookmarks) {
    if (nb >= 2) break;
    if (seen.has(b.url) || !(b.url.toLowerCase().includes(low) || (b.title || '').toLowerCase().includes(low))) continue;
    out.push({ kind: 'favorite', title: b.title || b.url, url: b.url });
    seen.add(b.url);
    nb++;
  }
  for (const h of history.suggest(text, 8)) {
    if (seen.has(h.url)) continue;
    out.push({ kind: 'history', title: h.title || h.url, url: h.url });
    seen.add(h.url);
    if (out.length >= 8) break;
  }
  return out.slice(0, 8);
}

function toURL(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^(https?|file):\/\//i.test(s)) return s;
  if (/^about:blank$/i.test(s)) return s;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s)) return 'http://' + s;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(s)) return 'http://' + s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s) && !/\s/.test(s)) return 'https://' + s;
  return ENGINES[settings.searchEngine].url + encodeURIComponent(s);
}

function navigateActive(input) {
  const url = toURL(input);
  if (!url) return;
  const t = activeTab();
  if (t?.view) {
    t.error = null;
    t.view.webContents.loadURL(url).catch(() => {});
    t.view.webContents.focus();
  } else newTab(url);
}

// ===== お気に入り（全プロフィール共通） =====
// 今のプロフィールで開いているお気に入りのタブ（ログイン情報を分けたプロフィールでは別のタブ）
const favTab = favId => tabs.find(x => x.favId === favId && sessionKey(x.favPid) === sessionKey(settings.profileId));

function openFavorite(favId) {
  const f = settings.favorites.find(x => x.id === favId);
  if (!f) return;
  let t = favTab(favId);
  if (!t) {
    t = addTab({ favId, url: f.url, title: f.title, favicon: f.favicon }, { activate: false, index: tabs.length });
    t.favPid = settings.profileId;
  }
  activateTab(t.id);
}

function addFavorite({ url, title, favicon }) {
  if (!url || !/^(https?|file):/i.test(url) || settings.favorites.some(f => f.url === url)) return null;
  const f = { id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), url, title: title || url, favicon: favicon || '' };
  settings.favorites.push(f);
  return f;
}

// タブをお気に入りに移す（タブ一覧からは消えて、お気に入りのアイコンになる）
function tabToFavorite(id, beforeFavId) {
  const t = findTab(id);
  if (!t || t.favId || t.private || isInternal(t.url)) return;
  const f = addFavorite({ url: t.url, title: t.title, favicon: t.favicon });
  if (!f) return;
  t.favId = f.id;
  t.favPid = t.profileId;
  t.profileId = null;
  t.pinned = false;
  t.pinnedUrl = null;
  if (beforeFavId) moveFavorite(f.id, beforeFavId);
  sendState();
  saveSoon();
}

function moveFavorite(id, beforeId) {
  const f = settings.favorites.find(x => x.id === id);
  if (!f) return;
  settings.favorites = settings.favorites.filter(x => x.id !== id);
  let j = beforeId ? settings.favorites.findIndex(x => x.id === beforeId) : -1;
  if (j < 0) j = settings.favorites.length;
  settings.favorites.splice(j, 0, f);
  sendState();
  saveSoon();
}

function removeFavorite(id) {
  for (const t of tabs.filter(x => x.favId === id)) closeTab(t.id);
  settings.favorites = settings.favorites.filter(x => x.id !== id);
  sendState();
  saveSoon();
}

// ===== プロフィール =====
function switchProfile(id) {
  if (!settings.profiles.some(p => p.id === id) || id === settings.profileId) return;
  const now = activeTab();
  if (now && !now.favId) lastActive[settings.profileId] = activeId;
  settings.profileId = id;
  const back = findTab(lastActive[id]);
  const next = back && back.profileId === id ? back : pickNext(null);
  if (next) activateTab(next.id); else newTab();
}

// マウスのサイドボタン：戻る＝前のプロフィール、進む＝次のプロフィール（名前を少しのあいだ表示する）
function cycleProfile(step) {
  const list = settings.profiles;
  if (list.length < 2) {
    showCard({ id: 'profile-switch', kind: 'info', tabId: null, host: tr('set.tabProfiles'), text: tr('card.oneProfile'), timeout: 1800 });
    return;
  }
  const i = list.findIndex(p => p.id === settings.profileId);
  const next = list[(i + step + list.length) % list.length];
  switchProfile(next.id);
  showCard({ id: 'profile-switch', kind: 'info', tabId: null, host: tr('set.tabProfiles'), text: profileName(next), timeout: 1200 });
}
let lastSideButton = 0;
function onSideButton(dir) {
  // 同じ押し方が二重に届くことがあるので、すぐ後のものは無視する
  if (Date.now() - lastSideButton < 150) return;
  lastSideButton = Date.now();
  if (settings.sideButtons === 'profile') cycleProfile(dir === 'back' ? -1 : 1);
  else if (settings.sideButtons === 'history') {
    const nav = cur()?.navigationHistory;
    if (dir === 'back' && nav?.canGoBack()) nav.goBack();
    if (dir === 'forward' && nav?.canGoForward()) nav.goForward();
  }
}

function addProfile(name) {
  const n = settings.profiles.length + 1;
  // 新しいプロフィールは、はじめからログイン情報を分ける（仕事用・個人用などで別のアカウントを使えるように）
  const p = { id: 'p' + Date.now().toString(36), name: String(name || '').trim().slice(0, 30) || tr('set.profileN', { n }), separate: true };
  settings.profiles.push(p);
  switchProfile(p.id);
  saveSoon();
  return p;
}

// ログイン情報を分ける／共有する。切り替えたら、そのプロフィールのタブは読み込み直す
function setProfileSeparate(id, on) {
  const p = profileOf(id);
  if (!p || !!p.separate === !!on) return;
  const affected = tabs.filter(x => x.profileId === id || (x.favId && x.favPid === id));
  for (const t of affected) { removeFromSplit(t.id); unloadView(t); }
  tabs = tabs.filter(x => !(x.favId && x.favPid === id));
  p.separate = !!on;
  if (!findTab(activeId)) { const n = pickNext(null); if (n) activateTab(n.id); else newTab(); } else if (!activeTab().view) activateTab(activeId);
  else { layout(); sendState(); }
  saveSoon();
  sendSettings();
}

function renameProfile(id, name) {
  const p = settings.profiles.find(x => x.id === id);
  if (!p || !String(name).trim()) return;
  p.name = String(name).trim().slice(0, 30);
  sendState();
  saveSoon();
}

function deleteProfile(id) {
  if (settings.profiles.length <= 1) return;
  if (settings.profileId === id) switchProfile(settings.profiles.find(p => p.id !== id).id);
  const gone = x => x.profileId === id || (x.favId && x.favPid === id);
  for (const t of tabs.filter(gone)) { removeFromSplit(t.id); unloadView(t); }
  tabs = tabs.filter(x => !gone(x));
  // ログイン情報を分けていたプロフィールは、そのCookieなども消す
  if (profileOf(id)?.separate) {
    const ses = sessionFor(id);
    ses.clearStorageData().catch(() => {});
    ses.clearCache().catch(() => {});
    profileSessions.delete(id);
  }
  settings.profiles = settings.profiles.filter(p => p.id !== id);
  delete lastActive[id];
  sendState();
  saveSoon();
}

// ===== 新しいタブ・コマンドバー（Arc と同じく、画面中央に浮かぶ検索ボックス） =====
// mode: new（Ctrl+T・新しいタブ。Enter で初めてタブができる）/ command（Ctrl+K。今のタブで開く・操作を実行）
//       split（今のタブの横に並べるページを選ぶ）
function openPalette(mode = 'new', opts = {}) {
  if (!win || !ui) return;
  closePopup();
  if (glance) closeGlance(false);
  paletteState = { mode, private: !!opts.private, text: opts.text || '', seq: Date.now() };
  if (!palette) {
    palette = createInternalView('palette.html');
    palette.webContents.on('dom-ready', () => { if (paletteOpen) palette.webContents.send('palette', paletteState); });
  }
  const [w, h] = win.getContentSize();
  win.contentView.addChildView(palette); // 一番上に
  palette.setBounds({ x: 0, y: 0, width: w, height: h });
  palette.setVisible(true);
  paletteOpen = true;
  palette.webContents.focus();
  palette.webContents.send('palette', paletteState);
}
function closePalette(refocus = true) {
  if (!paletteOpen) return;
  paletteOpen = false;
  palette.setVisible(false);
  palette.webContents.send('palette', null);
  if (refocus) cur()?.focus();
}

// コマンド（ラベルは i18n.js の cmd.〜。日本語でも英語でも検索できる）
const I18N_JA = I18N.make('ja');
const I18N_EN = I18N.make('en');
function commandList() {
  const t = activeTab();
  const web = !!t && /^(https?|file):/i.test(displayUrl(t));
  const list = [
    ['newPrivate', 'Ctrl+Shift+N', true],
    ['reopen', 'Ctrl+Shift+T', closedStack.length > 0],
    ['split', '', !!t && (splitOf(activeId)?.length || 1) < SPLIT_MAX],
    ['unsplit', '', !!splitOf(activeId)],
    ['translate', '', web && !t.translated],
    ['showOriginal', '', !!t?.translated],
    ['reload', 'Ctrl+R', !!t],
    ['close', 'Ctrl+W', !!t],
    [t?.pinned ? 'unpin' : 'pin', '', !!t && !t.favId && !t.private],
    ['favorite', 'Ctrl+D', web && !t.private && !t.favId],
    ['copyUrl', '', web],
    ['duplicate', '', !!t],
    ['find', 'Ctrl+F', !!t],
    ['print', 'Ctrl+P', web],
    ['zoomReset', 'Ctrl+0', !!t],
    ['toggleSidebar', 'Ctrl+S', true],
    ['toggleAI', 'Ctrl+E', true],
    ['theme', '', true],
    ['settings', 'Ctrl+,', true],
    ['history', 'Ctrl+H', true],
    ['downloads', 'Ctrl+J', true],
    ['passwords', '', true],
    ['import', '', true],
    ['sleep', '', true],
    ['clearData', 'Ctrl+Shift+Del', true],
    ['devtools', 'F12', web],
  ];
  return list.filter(x => x[2]).map(([id, keys]) => ({ id, keys, label: tr('cmd.' + id), ja: I18N_JA('cmd.' + id), en: I18N_EN('cmd.' + id) }));
}

function runCommand(id) {
  const t = activeTab();
  const wc = cur();
  const map = {
    newPrivate: () => openPalette('new', { private: true }),
    reopen: () => { const u = closedStack.pop(); if (u) newTab(u); },
    split: () => openPalette('split'),
    unsplit: () => unsplit(activeId),
    translate: () => t && translateTab(t),
    showOriginal: () => t && showOriginal(t),
    reload: () => wc?.reload(),
    close: () => closeTab(activeId),
    pin: () => t && moveTab(t.id, null, true),
    unpin: () => t && moveTab(t.id, null, false),
    favorite: () => { if (t && addFavorite({ url: t.url, title: t.title, favicon: t.favicon })) { sendState(); saveSoon(); } },
    copyUrl: () => t && clipboard.writeText(displayUrl(t)),
    duplicate: () => t && addTab({ url: isInternal(t.url) ? '' : savedUrl(t), private: t.private }),
    find: () => openFind(),
    print: () => wc?.print({}, () => {}),
    zoomReset: () => zoom(0),
    toggleSidebar: () => toggleSidebar(),
    toggleAI: () => setSide(!settings.sideOpen),
    theme: () => { settings.theme = isDark() ? 'light' : 'dark'; applyTheme(); sendState(); saveSoon(); },
    settings: () => openSettings('general'),
    history: () => openSettings('history'),
    downloads: () => ui.webContents.send('open-downloads'),
    passwords: () => openSettings('passwords'),
    import: () => openSettings('import'),
    sleep: () => sleepIdleTabs(true),
    clearData: () => openSettings('privacy'),
    devtools: () => wc?.toggleDevTools(),
  };
  map[id]?.();
}

// 入力に合う候補：URL・検索・開いているタブ・お気に入り・ブックマーク・履歴・コマンド
function paletteItems(q, mode) {
  const text = String(q || '').trim();
  const low = text.toLowerCase();
  const terms = low.split(/\s+/).filter(Boolean);
  const hit = (...fields) => terms.every(term => fields.some(f => String(f || '').toLowerCase().includes(term)));
  const out = [];
  const seen = new Set();
  const urls = new Set(); // 同じページを、開いているタブと履歴などで2回出さない
  const push = it => {
    const key = it.kind + '|' + (it.url || it.tabId || it.cmd);
    if (seen.has(key)) return;
    if (['favorite', 'bookmark', 'history'].includes(it.kind) && urls.has(it.url)) return;
    seen.add(key);
    if (['tab', 'favorite', 'bookmark'].includes(it.kind) && it.url) urls.add(it.url);
    out.push(it);
  };
  const open = orderedTabs().concat(tabs.filter(x => x.favId && sessionKey(x.favPid) === sessionKey(settings.profileId)))
    .filter(x => x.id !== activeId || mode === 'new');
  const tabItem = x => ({ kind: 'tab', tabId: x.id, title: displayTitle(x), url: displayUrl(x), favicon: x.private ? '' : x.favicon, private: x.private, split: !!splitOf(x.id) });

  if (!text) {
    // 何も入力していないとき：最近使ったタブとよく使う操作
    for (const x of [...open].filter(x => x.id !== activeId).sort((a, b) => b.lastUsed - a.lastUsed).slice(0, mode === 'command' ? 4 : 5)) push(tabItem(x));
    if (mode === 'command') {
      const prefer = ['translate', 'showOriginal', 'split', 'unsplit', 'copyUrl', 'pin', 'unpin', 'newPrivate'];
      for (const c of commandList().filter(c => prefer.includes(c.id)).slice(0, 5)) push({ kind: 'cmd', cmd: c.id, title: c.label, keys: c.keys });
    } else if (mode === 'new') {
      for (const c of commandList().filter(c => ['newPrivate', 'reopen'].includes(c.id))) push({ kind: 'cmd', cmd: c.id, title: c.label, keys: c.keys });
    }
    return out;
  }

  // コマンドバー（Ctrl+K）では、合う操作を検索より先に出す
  const cmds = mode === 'split' ? [] : commandList().filter(c => hit(c.ja + ' ' + c.en + ' ' + c.id)).slice(0, 3);
  if (mode === 'command') for (const c of cmds) push({ kind: 'cmd', cmd: c.id, title: c.label, keys: c.keys });

  const engine = ENGINES[settings.searchEngine];
  const url = toURL(text);
  const looksUrl = url && !url.startsWith(engine.url);
  if (looksUrl) push({ kind: 'url', title: text, url });
  push({ kind: 'search', title: text, url: engine.url + encodeURIComponent(text), engine: engine.name });

  // ほかの候補は、合うものを種類ごとに数件ずつ
  let n = 0;
  for (const x of open) { if (n >= 4) break; if (hit(displayTitle(x), displayUrl(x))) { push(tabItem(x)); n++; } }
  n = 0;
  for (const f of settings.favorites) { if (n >= 3) break; if (hit(f.title, f.url)) { push({ kind: 'favorite', favId: f.id, title: f.title, url: f.url, favicon: f.favicon }); n++; } }
  if (mode === 'new') for (const c of cmds) push({ kind: 'cmd', cmd: c.id, title: c.label, keys: c.keys });
  n = 0;
  for (const b of settings.bookmarks) { if (n >= 3) break; if (hit(b.title, b.url, b.folder)) { push({ kind: 'bookmark', title: b.title || b.url, url: b.url, folder: b.folder }); n++; } }
  for (const h of history.suggest(text, 6)) { if (out.length >= 12) break; push({ kind: 'history', title: h.title || h.url, url: h.url }); }
  return out.slice(0, 12);
}

function paletteRun(item, { split = false } = {}) {
  const { mode, private: priv } = paletteState;
  closePalette(false);
  const from = activeTab();
  if (!item || typeof item !== 'object') return cur()?.focus();
  if (item.kind === 'cmd') return runCommand(str(item.cmd, 32));
  if (item.kind === 'tab') {
    const t = findTab(num(item.tabId));
    if (!t) return;
    if ((split || mode === 'split') && from && t.id !== from.id) splitWith(from.id, t.id); else activateTab(t.id);
    return;
  }
  if (item.kind === 'favorite' && !split && mode !== 'split') {
    if (settings.favorites.some(f => f.id === item.favId)) return openFavorite(str(item.favId, 64));
  }
  const url = item.kind === 'input' ? toURL(str(item.text, 2000)) : str(item.url);
  if (!url || !/^(https?|file):/i.test(url)) return cur()?.focus();
  if ((split || mode === 'split') && from) return openBeside(url, from);
  if (mode === 'command' && from?.view && !from.favId) return navigateActive(url);
  addTab({ url, private: priv });
}

// ===== リンクのプレビュー（Alt+クリック。ページの上に大きく浮かべて表示し、タブを増やさない） =====
function openGlance(url, src) {
  if (!win || !/^https?:/i.test(url)) return;
  if (glance) closeGlance(false);
  closePopup();
  closePalette(false);
  if (!glanceUi) {
    glanceUi = createInternalView('glance.html');
    glanceUi.webContents.on('dom-ready', () => sendGlance());
  }
  win.contentView.addChildView(glanceUi); // 一番上に
  const priv = !!src?.private;
  const pid = src ? tabPid(src) : settings.profileId;
  const view = new WebContentsView({ webPreferences: pagePrefs(priv, pid) });
  view.setBorderRadius(RADIUS);
  view.setBackgroundColor('#ffffff');
  win.contentView.addChildView(view);
  const g = { view, url, title: '', loading: true, private: priv, profileId: pid, rect: null };
  glance = g;
  const wc = view.webContents;
  setupPage(wc, { private: priv, glance: true, profileId: pid });
  const upd = () => {
    if (glance !== g || wc.isDestroyed()) return;
    g.url = wc.getURL() || g.url;
    g.title = wc.getTitle();
    sendGlance();
  };
  wc.on('page-title-updated', upd);
  wc.on('did-navigate', upd);
  wc.on('did-navigate-in-page', upd);
  wc.on('did-start-loading', () => { g.loading = true; upd(); });
  wc.on('did-stop-loading', () => { g.loading = false; upd(); });
  wc.on('did-fail-load', (_e, code, desc, failed, isMain) => {
    if (!isMain || code === -3) return;
    const js = errorPage.script({ kind: 'error', code, desc, url: failed, dark: isDark(), t: tr });
    setTimeout(() => wc.executeJavaScript(js).catch(() => {}), 30);
  });
  wc.loadURL(url).catch(() => {});
  glanceUi.setVisible(true);
  placeGlance();
  wc.focus();
}

function placeGlance() {
  if (!glance || !glanceUi) return;
  const [w, h] = win.getContentSize();
  const a = areaRect;
  const width = Math.round(Math.min(a.width - 24, Math.max(a.width * 0.86, 480)));
  const top = a.y + 44;
  glance.rect = { x: Math.round(a.x + (a.width - width) / 2), y: top, width, height: Math.max(120, a.y + a.height - top - 12) };
  glanceUi.setBounds({ x: 0, y: 0, width: w, height: h });
  glance.view.setBounds(glance.rect);
  sendGlance();
}

function sendGlance() {
  if (!glanceUi) return;
  glanceUi.webContents.send('glance', glance ? {
    rect: glance.rect, url: glance.url, host: hostOf(glance.url), title: glance.title, loading: glance.loading, private: glance.private,
    canSplit: !!activeTab() && (splitOf(activeId)?.length || 1) < SPLIT_MAX,
  } : null);
}

function closeGlance(refocus = true) {
  if (!glance) return;
  const g = glance;
  glance = null;
  win.contentView.removeChildView(g.view);
  if (!g.view.webContents.isDestroyed()) g.view.webContents.close();
  glanceUi?.setVisible(false);
  sendGlance();
  if (refocus) cur()?.focus();
}

// プレビューを普通のタブにする（読み込み直さず、そのままタブに移す）
function glanceToTab(beside) {
  if (!glance) return;
  const g = glance;
  glance = null;
  glanceUi?.setVisible(false);
  sendGlance();
  const from = activeTab();
  const t = addTab({ url: g.url, title: g.title, private: g.private, profileId: from?.profileId || settings.profileId }, { activate: false });
  if (sessionKey(t.profileId) !== sessionKey(g.profileId) && !g.private) {
    // 別のプロフィールのセッションだったときは読み込み直す
    win.contentView.removeChildView(g.view);
    g.view.webContents.close();
  } else {
    win.contentView.removeChildView(g.view);
    addPageView(g.view);
    t.view = g.view;
    t.loading = g.loading;
    wireView(t, g.view);
  }
  if (beside && from) splitWith(from.id, t.id); else activateTab(t.id);
}

// ===== ページの翻訳 =====
function translateState(t) {
  if (t.translating) return 'busy';
  if (t.translated) return 'on';
  if (t.pageLang && t.pageLang !== curLang() && t.pageLang !== 'und') return 'offer';
  return '';
}

async function detectLang(t) {
  const wc = t.view?.webContents;
  if (!wc || wc.isDestroyed() || !/^https?:/i.test(wc.getURL()) || t.error) return;
  try {
    const d = await wc.executeJavaScriptInIsolatedWorld(translator.WORLD, [{ code: translator.DETECT_SCRIPT }]);
    const lang = translator.guessLang(d);
    if (lang !== t.pageLang) { t.pageLang = lang; if (t.id === activeId) sendState(); }
  } catch {}
}

function engineOpts() {
  const key = unsealSecret(settings.deeplKey);
  return { engine: settings.translateEngine === 'deepl' && key ? 'deepl' : 'google', deeplKey: key };
}

async function translateTab(t) {
  const wc = t.view?.webContents;
  if (!wc || wc.isDestroyed() || t.translating || t.translated) return;
  if (!/^https?:/i.test(wc.getURL())) return;
  t.translating = true;
  sendState();
  const url = wc.getURL();
  try {
    await wc.executeJavaScriptInIsolatedWorld(translator.WORLD, [{ code: translator.PAGE_SCRIPT }]);
    t.translated = true;
    t.trTarget = curLang();
    await translateMore(t, true);
    if (wc.isDestroyed() || wc.getURL() !== url) return;
    // あとから増えた文（スクロールで読み込まれた部分など）も訳す
    clearInterval(t.trTimer);
    t.trTimer = setInterval(() => { if (t.translated && t.view && !t.view.webContents.isDestroyed()) translateMore(t, false); else stopTranslate(t); }, 1500);
  } catch (e) {
    console.warn('翻訳に失敗:', e.message);
    stopTranslate(t);
    showOriginal(t);
    showCard({ id: 'tr-fail-' + t.id, kind: 'info', tabId: t.id, host: tr('tr.title'), text: tr('tr.failed'), timeout: 5000 });
  } finally {
    t.translating = false;
    sendState();
  }
}

async function translateMore(t, all) {
  const wc = t.view?.webContents;
  if (!wc || wc.isDestroyed() || t.trBusy) return;
  t.trBusy = true;
  try {
    const r = await wc.executeJavaScriptInIsolatedWorld(translator.WORLD, [{ code: `window.__mbtr ? window.__mbtr.collect(${all ? 'true' : 'false'}) : null` }]);
    if (!r || !r.texts?.length) return;
    const out = await translator.translate(r.texts, t.trTarget || curLang(), engineOpts());
    if (!t.translated || wc.isDestroyed()) return;
    await wc.executeJavaScriptInIsolatedWorld(translator.WORLD, [{ code: `window.__mbtr && window.__mbtr.apply(${Number(r.start)}, ${JSON.stringify(out.texts)})` }]);
  } catch (e) {
    if (all) throw e;
  } finally {
    t.trBusy = false;
  }
}

function stopTranslate(t) {
  clearInterval(t.trTimer);
  t.trTimer = null;
  t.translated = false;
}

function showOriginal(t) {
  stopTranslate(t);
  const wc = t.view?.webContents;
  if (wc && !wc.isDestroyed()) wc.executeJavaScriptInIsolatedWorld(translator.WORLD, [{ code: 'window.__mbtr && window.__mbtr.restore()' }]).catch(() => {});
  sendState();
}

function toggleTranslate(t) {
  if (!t) return;
  if (t.translated) showOriginal(t); else translateTab(t);
}

// APIキーなどはOSの仕組みで暗号化して設定ファイルに入れる
function sealSecret(v) {
  if (!v) return '';
  try { if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(v).toString('base64'); } catch {}
  return v;
}
function unsealSecret(v) {
  if (!v) return '';
  if (!v.startsWith('enc:')) return v;
  try { return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')); } catch { return ''; }
}

// ===== パスワードの保存と自動入力 =====
let passwords;
const pendingPasswords = new Map(); // カードID → { origin, username, password }（保存するか聞いている間だけ）
let pwContext = null;               // 候補を出している入力欄 { wcId, origin }

ipcMain.on('mb-pw-capture', (e, d) => {
  try {
    const wc = e.sender;
    const t = tabOfWc(wc);
    if (!t || t.private || !settings.passwordSave || !passwords?.available()) return;
    if (!e.senderFrame || e.senderFrame !== wc.mainFrame) return;
    const origin = originOf(e.senderFrame.url);
    if (!origin) return;
    if (!origin.startsWith('https:') && !isLocalHost(hostOf(origin))) return; // 暗号化されていないページのパスワードは保存しない
    const username = str(d?.username, 200);
    const password = str(d?.password, 1000);
    if (!password || passwords.isNever(origin)) return;
    const had = passwords.find(origin, username);
    if (had && passwords.get(had.id)?.password === password) return;
    for (const [id, p] of pendingPasswords) if (p.origin === origin && p.username === username) { pendingPasswords.delete(id); removeCard(id); }
    const id = 'pw-' + Date.now().toString(36);
    pendingPasswords.set(id, { origin, username, password });
    showCard({
      id, kind: 'password', tabId: t.id, host: hostOf(origin), timeout: 90000,
      text: tr(had ? 'card.pwUpdate' : 'card.pwSave'), user: username || tr('pw.noUser'), update: !!had,
    });
  } catch {}
});

ipcMain.on('mb-pw-field', (e, d) => {
  try {
    const wc = e.sender;
    const t = tabOfWc(wc);
    if (!t || !paneRects[t.id] || !e.senderFrame || e.senderFrame !== wc.mainFrame) return;
    if (!d) {
      // 欄からフォーカスが外れたら閉じる（候補をクリックしたときは、その前に入力が終わっている）
      const ctx = pwContext;
      setTimeout(() => { if (popupMode === 'pw' && pwContext === ctx) closePopup(); }, 200);
      return;
    }
    const origin = originOf(wc.mainFrame.url);
    const items = origin && passwords ? passwords.forOrigin(origin) : [];
    if (!items.length) { if (popupMode === 'pw') closePopup(); return; }
    const z = wc.getZoomFactor();
    const pr = paneRects[t.id];
    const x = pr.x + num(d.x) * z;
    const y = pr.y + (num(d.y) + num(d.height)) * z + 4;
    if (!Number.isFinite(x) || !Number.isFinite(y) || y < pr.y || y > pr.y + pr.height - 20) { if (popupMode === 'pw') closePopup(); return; }
    pwContext = { wcId: wc.id, origin };
    const data = { host: hostOf(origin), items: items.slice(0, 6).map(i => ({ id: i.id, username: i.username })) };
    const anchor = { x: Math.round(x), y: Math.round(y), width: Math.round(Math.max(260, Math.min(420, num(d.width) * z))) };
    if (popupMode === 'pw') { popupAnchor = anchor; popupData = data; sendPopup(); placePopup(); } else openPopup('pw', anchor, data);
  } catch {}
});

function fillPassword(id) {
  const ctx = pwContext;
  closePopup();
  if (!ctx || !passwords) return;
  const entry = passwords.get(id);
  const wc = require('electron').webContents.fromId(ctx.wcId);
  if (!entry || !wc || wc.isDestroyed()) return;
  // 入力欄のあるページが、保存したサイトのままのときだけ渡す
  if (entry.origin !== ctx.origin || originOf(wc.mainFrame.url) !== entry.origin) return;
  wc.focus();
  wc.mainFrame.send('mb-pw-fill', { username: entry.username, password: entry.password });
  passwords.markUsed(id);
}

// ===== ほかのブラウザから読み込む =====
async function runImport(sourceId, what) {
  const src = importer.detect().find(s => s.id === sourceId);
  if (!src) return { error: tr('imp.notFound') };
  const res = { bookmarks: 0, favorites: 0, history: 0, error: '' };
  if (what.bookmarks && src.bookmarks) {
    const items = importer.readBookmarks(src.dir);
    const have = new Set(settings.bookmarks.map(b => b.url));
    for (const b of items) {
      if (have.has(b.url)) continue;
      have.add(b.url);
      settings.bookmarks.push({ id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url: b.url, title: b.title, folder: b.folder });
      res.bookmarks++;
    }
    if (settings.bookmarks.length > 20000) settings.bookmarks = settings.bookmarks.slice(-20000);
    // ブックマークバーの先頭のものはお気に入りにも入れる
    if (what.favorites) {
      for (const b of items.filter(x => x.bar).slice(0, 12)) {
        if (settings.favorites.length >= 24) break;
        if (addFavorite({ url: b.url, title: b.title })) res.favorites++;
      }
    }
  }
  if (what.history && src.history) {
    const r = importer.readHistory(src.dir);
    if (r.error) res.error = tr(r.error === 'locked' ? 'imp.locked' : 'imp.readError');
    else res.history = history.importItems(r.items);
  }
  saveSoon();
  sendState();
  return res;
}

// ===== ページ共通の設定（ポップアップ・右クリック・ショートカット） =====
function openHandler(wc, t, { url, disposition }) {
  if (!/^https?:/i.test(url)) return { action: 'deny' };
  const isPrivate = !!t?.private;
  // クリックなどの操作なしで開こうとしたポップアップはブロックして知らせる
  if (!security.popupAllowed(wc, isPrivate ? [...privatePopupsAllow] : [])) {
    const host = hostOf(wc.getURL());
    showCard({
      id: 'popup-' + wc.id + '-' + Date.now(), kind: 'popup', tabId: t?.id ?? 'ai', host,
      text: tr('card.popupBlocked'), url, private: isPrivate, timeout: 15000,
    });
    return { action: 'deny' };
  }
  // window.open で開くログイン画面などは、ポップアップとしてそのまま開く（ログインに必要）
  if (disposition === 'new-window') {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 520, height: 720, backgroundColor: '#ffffff', autoHideMenuBar: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      },
    };
  }
  // target="_blank" のリンクなどは新しいタブで
  addTab({ url, private: isPrivate }, { activate: disposition !== 'background-tab' });
  return { action: 'deny' };
}

function setupPage(wc, t) {
  wc.setWindowOpenHandler(d => openHandler(wc, t, d));
  if (DEBUG) {
    wc.on('console-message', e => {
      const level = e.level ?? '';
      if ((level === 'error' || level === 'warning' || /mb-scriptlet|mb-perf/.test(e.message || '')) && debugHost(wc.getURL())) {
        dlog('[console]', level, String(e.message || '').slice(0, 600), (e.sourceId || '').slice(0, 120) + ':' + (e.lineNumber ?? ''));
      }
    });
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => { if (debugHost(url)) dlog('[fail]', code, desc, isMain ? 'main' : 'sub', url.slice(0, 200)); });
    wc.on('render-process-gone', (_e, d) => dlog('[crash]', d.reason, wc.getURL().slice(0, 120)));
    // YouTube の「スポンサー」表示がどんな要素の中にあるかを書き出す（広告枠を隠す決まりを作るため）
    const ytDiag = () => {
      if (!/(^|\.)youtube\.com$/.test(hostOf(wc.getURL()))) return;
      setTimeout(() => {
        if (wc.isDestroyed()) return;
        wc.executeJavaScriptInIsolatedWorld(1004, [{ code: `(() => {
          const out = [];
          const desc = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 16).join('.') : '') + ' [' + getComputedStyle(el).display + ']';
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n && out.length < 6; n = walker.nextNode()) {
            if (!/^\\s*(スポンサー|Sponsored|広告|Ad)\\s*$/.test(n.nodeValue)) continue;
            const chain = [];
            for (let e = n.parentElement, i = 0; e && i < 16; e = e.parentElement, i++) chain.push(desc(e));
            out.push(n.nodeValue.trim() + ' <= ' + chain.join(' < '));
          }
          // 広告らしい部品の名前と、その表示状態
          const tags = {};
          for (const el of document.querySelectorAll('*')) {
            const n = el.tagName.toLowerCase();
            if (/ad-|-ad|ads|promoted|sponsor|pyv/.test(n)) tags[n] = (tags[n] || '') + getComputedStyle(el).display[0];
          }
          // 動画プレーヤーの様子（サムネイルのプレビューも含む）
          const players = [...document.querySelectorAll('video')].map(v => {
            const chain = [];
            for (let e = v.parentElement, i = 0; e && i < 8; e = e.parentElement, i++) chain.push(desc(e));
            return { t: +v.currentTime.toFixed(1), d: v.duration, paused: v.paused, muted: v.muted, rate: v.playbackRate, chain: chain.join(' < ') };
          });
          return { url: location.href, players, adSlots: document.querySelectorAll('ytd-ad-slot-renderer').length, hits: out.slice(0, 1) };
        })()` }]).then(r => dlog('[yt-ads]', JSON.stringify(r))).catch(e => dlog('[yt-ads] error', e.message));
      }, 5000);
    };
    wc.on('did-stop-loading', ytDiag);
    wc.on('did-navigate-in-page', ytDiag);
  }
  handleKeys(wc);
  wc.on('input-event', (_, ev) => security.noteInput(wc, ev));
  wc.once('destroyed', () => security.forget(wc.id));
  wc.on('context-menu', (_, p) => {
    const items = [];
    const sep = { type: 'separator' };
    const isPrivate = !!t?.private;
    const aiMenu = label => ({ label, submenu: promptsFor(curLang()).map(pr => ({ label: pr.label, click: () => aiAction(pr.text, wc) })) });
    if (p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
      if (!p.dictionarySuggestions.length) items.push({ label: tr('menu.noSuggestions'), enabled: false });
      items.push({ label: tr('menu.addToDictionary'), click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, sep);
    }
    if (p.linkURL && /^https?:/i.test(p.linkURL)) {
      const owner = tabOfWc(wc);
      items.push(
        { label: tr('menu.openLinkNewTab'), click: () => addTab({ url: p.linkURL, private: isPrivate }, { activate: false }) },
        { label: tr('menu.glance'), click: () => openGlance(p.linkURL, owner || t) },
        ...(owner ? [{ label: tr('menu.openBeside'), click: () => openBeside(p.linkURL, owner) }] : []),
        ...(isPrivate ? [] : [{ label: tr('menu.openLinkPrivate'), click: () => addTab({ url: p.linkURL, private: true }) }]),
        { label: tr('menu.saveLink'), click: () => wc.downloadURL(p.linkURL) },
        { label: tr('menu.copyLink'), click: () => clipboard.writeText(p.linkURL) }, sep);
    }
    if (p.mediaType === 'image' && /^(https?:|data:image\/)/i.test(p.srcURL || '')) {
      items.push(
        ...(/^https?:/i.test(p.srcURL) ? [{ label: tr('menu.openImageNewTab'), click: () => addTab({ url: p.srcURL, private: isPrivate }, { activate: false }) }] : []),
        { label: tr('menu.saveImage'), click: () => wc.downloadURL(p.srcURL) },
        { label: tr('menu.copyImage'), click: () => wc.copyImageAt(p.x, p.y) },
        { label: tr('menu.copyImageAddress'), click: () => clipboard.writeText(p.srcURL) }, sep);
    }
    if (p.isEditable) {
      items.push(
        { label: tr('menu.undo'), role: 'undo' }, sep,
        { label: tr('menu.cut'), role: 'cut' }, { label: tr('menu.copy'), role: 'copy' },
        { label: tr('menu.paste'), role: 'paste' }, { label: tr('menu.selectAll'), role: 'selectAll' }, sep);
    } else if (p.selectionText) {
      const s = p.selectionText.trim();
      items.push(
        { label: tr('menu.copy'), role: 'copy' },
        { label: tr('menu.searchFor', { text: s.slice(0, 16) + (s.length > 16 ? '…' : ''), engine: ENGINES[settings.searchEngine].name }), click: () => addTab({ url: ENGINES[settings.searchEngine].url + encodeURIComponent(s), private: isPrivate }) },
        aiMenu(tr('menu.sendSelectionToAI')), sep);
    }
    if (!p.linkURL && !p.selectionText && !p.isEditable && p.mediaType !== 'image') {
      items.push(
        { label: tr('menu.back'), enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: tr('menu.forward'), enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: tr('menu.reload'), click: () => wc.reload() }, sep,
        { label: tr('menu.find'), click: () => openFind() },
        { label: tr('menu.print'), click: () => wc.print({}, () => {}) },
        ...(tabOfWc(wc) && /^https?:/i.test(wc.getURL()) ? [{
          label: tabOfWc(wc).translated ? tr('tr.showOriginal') : tr('tr.translateTo', { lang: tr('lang.' + curLang()) }),
          click: () => toggleTranslate(tabOfWc(wc)),
        }] : []), sep,
        aiMenu(tr('menu.sendPageToAI')), sep);
    }
    // クリックで隠す
    if (/^https?:/i.test(wc.getURL()) && !p.isEditable) {
      const site = hider.siteOf(wc.getURL());
      items.push({ label: tr('hide.start'), click: () => startHide(wc) });
      if (settings.hideRules[site]?.length) items.push({ label: tr('hide.reset', { n: settings.hideRules[site].length }), click: () => clearHide(site) });
      items.push(sep);
    }
    // 拡張機能が追加した右クリックメニュー
    const extItems = t?.private ? [] : extensions.contextMenuItems(wc, p);
    if (extItems.length) items.push(...extItems, sep);
    items.push({ label: tr('menu.inspect'), click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup();
  });
}

function zoom(delta, wc = cur()) {
  if (!wc || wc.isDestroyed()) return;
  const level = delta === 0 ? 0 : Math.max(-5, Math.min(5, wc.getZoomLevel() + delta));
  wc.setZoomLevel(level);
  setTimeout(sendState, 30);
}

// メニューバーを消すと標準ショートカットも消えるので、自前で用意する
function handleKeys(wc) {
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const c = input.control || input.meta;
    const s = input.shift;
    const k = input.key.length === 1 ? input.key.toLowerCase() : input.key;
    const list = () => orderedTabs();
    const rules = [
      [input.key === 'Escape' && paletteOpen, () => closePalette()],
      [input.key === 'Escape' && !!glance, () => closeGlance()],
      [c && !s && k === 't', () => openPalette('new')],
      [c && !s && k === 'k', () => openPalette('command')],
      [c && s && k === 'n', () => openPalette('new', { private: true })],
      [c && s && k === 't', () => { const u = closedStack.pop(); if (u) newTab(u); }],
      [c && !s && k === 'w', () => closeTab(activeId)],
      [c && k === 'l', () => { ui.webContents.focus(); ui.webContents.send('focus-url'); }],
      [(c && !s && k === 'r') || input.key === 'F5', () => cur()?.reload()],
      [(c && s && k === 'r') || (c && input.key === 'F5'), () => cur()?.reloadIgnoringCache()],
      [input.alt && input.key === 'ArrowLeft', () => cur()?.navigationHistory.goBack()],
      [input.alt && input.key === 'ArrowRight', () => cur()?.navigationHistory.goForward()],
      [c && !s && k === 's', () => toggleSidebar()],
      [c && !s && k === 'e', () => setSide(!settings.sideOpen)],
      [c && !s && k === ',', () => toggleSettings()],
      [c && !s && k === 'f', () => openFind()],
      [input.key === 'F3' || (c && k === 'g'), () => { if (findState.text) doFind(findState.text, !s, true); else openFind(); }],
      [c && !s && k === 'p', () => cur()?.print({}, () => {})],
      [c && !s && k === 'j', () => ui.webContents.send('open-downloads')],
      [c && !s && k === 'h', () => toggleSettings('history')],
      [c && !s && k === 'd', () => { const t = activeTab(); if (t && !t.private && addFavorite({ url: t.url, title: t.title, favicon: t.favicon })) { sendState(); saveSoon(); } }],
      [c && s && input.key === 'Delete', () => openSettings('privacy')],
      [input.key === 'Escape' && fullscreenTab != null, () => forceExitFullscreen()],
      [input.key === 'Escape' && popupMode != null && popupMode !== 'suggest', () => closePopup()],
      [input.key === 'Escape' && panelOpen, () => closeSettings()],
      [c && input.key === 'Tab', () => cycleTab(s ? -1 : 1)],
      [c && !s && /^[1-8]$/.test(k), () => { const t = list()[Number(k) - 1]; if (t) activateTab(t.id); }],
      [c && !s && k === '9', () => { const l = list(); if (l.length) activateTab(l[l.length - 1].id); }],
      [c && (k === '+' || k === '=' || k === ';'), () => zoom(0.5)],
      [c && k === '-', () => zoom(-0.5)],
      [c && k === '0', () => zoom(0)],
      [input.key === 'F12' || (c && s && k === 'i'), () => cur()?.toggleDevTools()],
      [input.key === 'F11', () => win.setFullScreen(!win.isFullScreen())],
    ];
    const hit = rules.find(([cond]) => cond);
    if (hit) { e.preventDefault(); hit[1](); }
  });
}

// ===== セッション（通信）の設定：権限・広告ブロック・HTTPS・ダウンロード =====
function pageUrlOf(details) {
  const wc = details.webContents;
  if (wc && !wc.isDestroyed()) return wc.getURL();
  return details.referrer || '';
}

function setupSession(ses) {
  ses.setPermissionRequestHandler((wc, permission, cb, details) => security.onRequest(wc, permission, cb, details));
  ses.setPermissionCheckHandler((wc, permission, origin, details) => security.onCheck(wc, permission, origin, details));
  ses.setDevicePermissionHandler(() => false); // USB・シリアル・HID機器へのアクセスは許可しない

  ses.webRequest.onBeforeRequest((details, cb) => {
    // 調査用：通信がブラウザ本体の処理を待たされた時間
    if (DEBUG) { const lag = Date.now() - details.timestamp; if (lag > 100) dlog('[perf] req-wait', Math.round(lag) + 'ms', details.resourceType, details.url.slice(0, 120)); }
    if (details.resourceType === 'mainFrame') {
      const up = security.upgradeUrl(details.url);
      return cb(up ? { redirectURL: up } : {});
    }
    if (settings.adblock && /^(https?|wss?):/i.test(details.url)) {
      const pageUrl = pageUrlOf(details);
      const host = hostOf(pageUrl);
      if (/^https?:/i.test(pageUrl) && !settings.adblockAllow.includes(host) && !ytSoft(pageUrl) && !(DEBUG && youtube.isYouTube(pageUrl) && liveFlag('yt-noblock.flag'))) {
        const r = adblock.check(details, pageUrl);
        if (r) {
          if (details.webContents) adblock.countBlocked(details.webContents.id);
          statsAdd('blocked', 1);
          if (DEBUG && debugHost(pageUrl)) dlog('[block]', details.resourceType, details.url.slice(0, 300), r.redirectURL ? '(redirect)' : '');
          return cb(r);
        }
      }
    }
    cb({});
  });

  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    if (settings.gpc) h['Sec-GPC'] = '1';
    // Googleのログイン画面だけはFirefoxとして名乗る（自作ブラウザ判定の回避）
    if (config.googleLoginFix && settings.googleUa === 'firefox' && GOOGLE_LOGIN.test(details.url)) {
      h['User-Agent'] = FIREFOX_UA;
      for (const key of Object.keys(h)) if (/^sec-ch-ua/i.test(key)) delete h[key];
    }
    cb({ requestHeaders: h });
  });

  ses.on('will-download', (e, item, wc) => downloads.handle(e, item, wc));
  // 広告ブロック（ページ内の要素隠し・スクリプト）用の小さなスクリプトを、Webサイトのページに入れる
  const pagePreload = path.join(__dirname, 'lib', 'page-preload.js');
  if (ses.registerPreloadScript) ses.registerPreloadScript({ id: 'mb-content', type: 'frame', filePath: pagePreload });
  else ses.setPreloads([...ses.getPreloads(), pagePreload]); // 古い Electron 用
}

// 広告枠を隠すCSSは、ページ側からの問い合わせに加えてブラウザ側からも入れておく（問い合わせが失敗したときの保険）
// クリックで隠した部分（サイトごと）
function injectHideRules(wc, url) {
  const css = hider.cssFor(settings.hideRules?.[hider.siteOf(url)]);
  if (css) wc.insertCSS(css, { cssOrigin: 'user' }).catch(() => {});
}
async function startHide(wc) {
  if (!wc || wc.isDestroyed() || !/^https?:/i.test(wc.getURL())) return;
  let sel = null;
  try { sel = await wc.executeJavaScriptInIsolatedWorld(1006, [{ code: hider.PICKER({ hint: tr('hide.hint') }) }]); } catch {}
  if (!sel || typeof sel !== 'string' || sel.length > 400) return;
  const site = hider.siteOf(wc.getURL());
  const list = settings.hideRules[site] || (settings.hideRules[site] = []);
  if (!list.includes(sel)) list.push(sel);
  injectHideRules(wc, wc.getURL());
  showCard({ id: 'hide-' + Date.now(), kind: 'info', tabId: tabOfWc(wc)?.id ?? null, host: site, text: tr('hide.done'), timeout: 3500 });
  sendSettings();
  saveSoon();
}
function clearHide(site) {
  delete settings.hideRules[site];
  for (const t of tabs) if (t.view && !t.view.webContents.isDestroyed() && hider.siteOf(t.view.webContents.getURL()) === site) t.view.webContents.reload();
  sendSettings();
  saveSoon();
}

function injectCosmeticCss(wc, url) {
  try {
    if (!settings.adblock || NO_COSMETICS || !/^https?:/i.test(url) || settings.adblockAllow.includes(hostOf(url))) return;
    const r = adblock.cosmetics(url, true);
    if (r?.styles) wc.insertCSS(r.styles, { cssOrigin: 'user' }).catch(() => {});
    if (DEBUG && debugHost(url)) dlog('[cosmetics-main]', url.slice(0, 120), 'css=' + (r?.styles?.length || 0));
  } catch {}
}

// lib/page-preload.js からの問い合わせ。どのページからでも来るので、返すのは公開されているルールだけ
ipcMain.on('mb-cosmetics', (e, isMain, pageHref, topHref) => {
  // returnValue は1回だけ設定する（最初に設定した値がそのまま返される）
  let result = null;
  try {
    // 読み込みの途中では、ブラウザ側からはまだページのURLが分からないことがある（Windows で起きる）。
    // そのときはページが知らせたURLを使う（返すのは公開されている広告ブロックのルールだけなので、偽られても害はない）
    const frameUrl = e.senderFrame?.url || '';
    const url = /^https?:/i.test(frameUrl) ? frameUrl : String(pageHref || '').slice(0, 4096);
    const senderTop = e.sender.getURL();
    const top = /^https?:/i.test(senderTop) ? senderTop : (isMain ? url : String(topHref || ''));
    if (DEBUG && debugHost(url)) dlog('[cosmetics-req]', 'frame=' + frameUrl.slice(0, 80), 'sent=' + String(pageHref || '').slice(0, 80), 'top=' + top.slice(0, 80));
    if (settings.adblock && /^https?:/i.test(url) && !settings.adblockAllow.includes(hostOf(top))) {
      // リストがまだ無いとき（部品の準備前・ダウンロード前）も、YouTube・X の対策は動かすため空の結果を返す
      result = adblock.cosmetics(url, !!isMain) || { styles: '', scripts: [] };
      if (result && (NO_SCRIPTLETS || liveFlag('noscriptlets.flag'))) result = { ...result, scripts: [] };
      if (result && (ytSoft(top) || ytSoft(url) || liveFlag('yt-noprune.flag'))) result = { ...result, scripts: [], ytPrune: false };
      if (NO_COSMETICS || liveFlag('nocosmetics.flag')) result = null;
      if (DEBUG && debugHost(url)) dlog('[cosmetics]', url.slice(0, 120), 'main=' + !!isMain, 'css=' + (result?.styles?.length || 0), 'scripts=' + (result?.scripts?.length || 0));
    }
  } catch {}
  e.returnValue = result;
});

// 先に接続しておく（DNS・TCP・TLS の準備だけで、ページの中身は取りに行かない）
// 広告ブロックの対象のサイトには接続しない
function preconnect(ses, rawUrl, pageUrl) {
  try {
    let u = new URL(String(rawUrl || '').slice(0, 2048));
    if (!/^https?:$/.test(u.protocol)) return;
    const up = security.upgradeUrl(u.origin + '/');
    if (up) u = new URL(up);
    if (settings.adblock && pageUrl && adblock.check({ url: u.origin + '/', resourceType: 'subFrame' }, pageUrl)) return;
    ses.preconnect({ url: u.origin, numSockets: 1 });
  } catch {}
}

// lib/page-preload.js から：ページの上でマウスのサイドボタンを押した
ipcMain.on('mb-side-button', (e, d) => {
  if (!tabOfWc(e.sender) || (e.senderFrame && e.senderFrame.parent)) return;
  onSideButton(d === 'back' ? 'back' : 'forward');
});

// lib/page-preload.js から：リンクにマウスを乗せた
ipcMain.on('mb-preconnect', (e, url) => {
  const wc = e.sender;
  if (!wc || wc.isDestroyed() || !tabOfWc(wc)) return;
  if (e.senderFrame && e.senderFrame.parent) return; // いちばん外側のページからだけ
  preconnect(wc.session, url, wc.getURL());
});

// lib/page-preload.js から：Alt+クリックしたリンクをプレビューで開く（クリックした直後だけ受け付ける）
ipcMain.on('mb-glance', (e, url) => {
  const u = String(url || '').slice(0, 4096);
  if (!/^https?:\/\//i.test(u)) return;
  const wc = e.sender;
  const t = tabOfWc(wc) || (glance && glance.view.webContents === wc ? { private: glance.private, profileId: glance.profileId } : null);
  if (!t || !security.recentGesture(wc, 2000)) return;
  openGlance(u, t);
});

// すべてのページに共通の安全策
app.on('web-contents-created', (_, wc) => {
  // <webview> は使わない
  wc.on('will-attach-webview', e => e.preventDefault());
  // Googleのログイン画面を開くときだけUAを切り替える
  if (config.googleLoginFix) {
    wc.on('did-start-navigation', (e, legacyUrl, _inPlace, legacyMain) => {
      const url = e.url ?? legacyUrl;
      const main = e.isMainFrame ?? legacyMain;
      if (!main || !url) return;
      const ua = GOOGLE_LOGIN.test(url) && settings.googleUa === 'firefox' ? FIREFOX_UA : CHROME_UA;
      if (wc.getUserAgent() !== ua) wc.setUserAgent(ua);
    });
    // 「このブラウザは安全でない可能性があります」と断られたら、名乗り方を切り替えて、ログイン画面に戻ってやり直す
    let retried = 0;
    wc.on('did-navigate', (_e, url) => {
      if (!/^https:\/\/accounts\.google\.com\/[^?#]*\/rejected/.test(url || '') || retried >= 1) return;
      retried++;
      settings.googleUa = settings.googleUa === 'firefox' ? 'chrome' : 'firefox';
      saveSoon();
      dlog('[google-login] rejected, switching to', settings.googleUa);
      setTimeout(() => {
        if (wc.isDestroyed()) return;
        const nav = wc.navigationHistory;
        // 前の画面（ログイン画面）を、新しい名乗り方で読み込み直す（履歴から戻ると古い名乗りのまま表示されることがある）
        let back = '';
        try { const i = nav.getActiveIndex(); if (i > 0) back = nav.getEntryAtIndex(i - 1)?.url || ''; } catch {}
        wc.loadURL(/^https:\/\/accounts\.google\.com\//.test(back) ? back : 'https://accounts.google.com/').catch(() => {});
      }, 300);
    });
  }
  // ログイン用のポップアップ（別ウィンドウ）にも同じ安全策をかける
  wc.on('did-create-window', child => {
    child.setMenuBarVisibility?.(false);
    // ウィンドウの題名には常にサイトのドメインを出す（偽のログイン画面と見分けられるように）
    const showHost = () => { if (!child.isDestroyed()) child.setTitle(`${hostOf(child.webContents.getURL()) || '…'} — ${child.webContents.getTitle()}`); };
    child.webContents.on('page-title-updated', e => { e.preventDefault(); showHost(); });
    child.webContents.on('did-navigate', showHost);
    const opener = { private: isPrivateWc(child.webContents) };
    child.webContents.setWindowOpenHandler(d => openHandler(child.webContents, opener, d));
    child.webContents.on('input-event', (_e, ev) => security.noteInput(child.webContents, ev));
    handleKeys(child.webContents);
  });
});

// ===== IPC（ブラウザ自身の画面からの命令だけを受け付ける） =====
const trustedIds = new Set();
function trust(wc) {
  trustedIds.add(wc.id);
  wc.once('destroyed', () => trustedIds.delete(wc.id));
}
function isTrusted(e) {
  const frame = e.senderFrame;
  return trustedIds.has(e.sender.id) && !!frame && frame === e.sender.mainFrame && isUiUrl(frame.url);
}
const on = (ch, fn) => ipcMain.on(ch, (e, ...a) => { if (isTrusted(e)) fn(...a); });
const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!isTrusted(e)) throw new Error('forbidden'); return fn(...a); });
const str = (v, max = 4096) => String(v ?? '').slice(0, max);
const num = v => Number(v);

// ブラウザ自身の画面は、別のページへ移動したり新しいウィンドウを開いたりできないようにする
function lockDown(wc) {
  wc.on('will-navigate', e => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// ===== サイドバー =====
function toggleSidebar() {
  settings.sidebarCollapsed = !settings.sidebarCollapsed;
  setPeek(false);
  watchPeek();
  layout();
  saveSoon();
}

function setPeek(on) {
  if (peeking === on) return;
  peeking = on;
  // 一時表示の間だけ、UI（サイドバー）をページより上に重ねる。終わったら一番下に戻す
  if (!resizing && ui) {
    if (on) win.contentView.addChildView(ui);
    else { win.contentView.removeChildView(ui); win.contentView.addChildView(ui, 0); }
  }
  layout();
}

// サイドバーを隠しているときは、マウスの位置を見張って左端に来たら表示する
// （ページの上にマウスがあっても反応するので、当たり判定を広く取れる）
let peekTimer = null;
function watchPeek() {
  clearInterval(peekTimer);
  peekTimer = null;
  if (!settings.sidebarCollapsed) return;
  peekTimer = setInterval(() => {
    if (!win || win.isDestroyed() || win.isMinimized() || !win.isVisible() || resizing || fullscreenTab != null) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getContentBounds();
    const x = p.x - b.x;
    const y = p.y - b.y;
    const inWindow = y >= TITLE_H && y <= b.height && x >= -4 && x <= b.width;
    if (!peeking && inWindow && x <= PEEK_EDGE) setPeek(true);
    else if (peeking && (!inWindow || x > settings.sidebarW + 30)) setPeek(false);
  }, 80);
}

// ===== 幅の変更（境目のドラッグ） =====
// ドラッグ中だけUIを一番上に重ねて、ページの上でもマウスの動きを受け取れるようにする
function resizeStart(which) {
  if (which !== 'sidebar' && which !== 'ai') return;
  resizing = which;
  win.contentView.addChildView(ui); // すでにある子ビューを足し直すと一番上に来る
  ui.webContents.send('resizing', which);
}
function resizeTo(x) {
  if (!resizing || !Number.isFinite(x)) return;
  const [w] = win.getContentSize();
  if (resizing === 'sidebar') settings.sidebarW = clamp(x, SIDEBAR_MIN, SIDEBAR_MAX);
  else settings.aiW = clamp(w - GAP - x, AI_MIN, Math.min(AI_MAX, w - settings.sidebarW - 300));
  layout();
}
function resizeEnd() {
  if (!resizing) return;
  resizing = null;
  win.contentView.removeChildView(ui); // 一番下に戻す
  win.contentView.addChildView(ui, 0);
  ui.webContents.send('resizing', null);
  layout();
  sendSettings();
  saveSoon();
}
function setWidths({ sidebarW, aiW }) {
  if (sidebarW != null) settings.sidebarW = clamp(sidebarW, SIDEBAR_MIN, SIDEBAR_MAX);
  if (aiW != null) settings.aiW = clamp(aiW, AI_MIN, AI_MAX);
  layout();
  sendSettings();
  saveSoon();
}

// ===== AIサイドパネル =====
function ensureAI() {
  if (aiView) return;
  if (settings.aiMode === 'api') return ensureAIChat();
  aiView = new WebContentsView({ webPreferences: pagePrefs(false) }); // ログイン状態はブラウザ全体で共有・保存される
  aiView.setBorderRadius(RADIUS);
  aiView.setBackgroundColor('#ffffff');
  const wc = aiView.webContents;
  setupPage(wc, null);
  // 読み込めなかったときは、タブと同じエラー表示（再読み込みボタン付き）にする
  let failedUrl = null;
  wc.on('did-start-navigation', (e, _u, inPlace, legacyMain) => { if ((e.isMainFrame ?? legacyMain) && !(e.isSameDocument ?? inPlace)) failedUrl = null; });
  wc.on('did-fail-load', (_, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    failedUrl = url;
    const js = errorPage.script({ kind: 'error', code, desc, url, dark: isDark(), t: tr });
    const inject = (n = 0) => wc.executeJavaScript(js).catch(() => { if (n < 5) setTimeout(() => inject(n + 1), 120); });
    setTimeout(inject, 30);
  });
  wc.on('page-title-updated', (_, title) => {
    if (failedUrl && title === '#mb:retry') wc.loadURL(failedUrl).catch(() => {});
  });
  wc.loadURL(config.ai[settings.aiIndex].url).catch(() => {});
  addPageView(aiView);
}

// 内蔵AI（APIキー）の会話画面。ブラウザ自身の画面なので、信頼する画面として扱う
function ensureAIChat() {
  aiView = new WebContentsView({ webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, spellcheck: false } });
  aiView.setBorderRadius(RADIUS);
  aiView.setBackgroundColor(isDark() ? '#161616' : '#ffffff');
  const wc = aiView.webContents;
  trust(wc);
  lockDown(wc);
  handleKeys(wc);
  wc.on('dom-ready', () => { paintTheme(wc); sendAIContext(); });
  wc.loadURL(uiUrl('aichat.html'));
  addPageView(aiView);
}
// AIパネルの種類（サイト／内蔵AI）を切り替えたら、作り直す
function rebuildAI() {
  aiAbort?.abort();
  if (aiView) { win.contentView.removeChildView(aiView); aiView.webContents.close(); aiView = null; }
  if (settings.sideOpen) ensureAI();
  layout();
}

// ===== 内蔵AI（自分のAPIキーで、開いているページについて答える） =====
let aiConv = { url: '', messages: [] };
let aiAbort = null;
const aiSend = m => { if (aiView && settings.aiMode === 'api' && !aiView.webContents.isDestroyed()) aiView.webContents.send('ai-msg', m); };
function sendAIContext() { const t = activeTab(); aiSend({ type: 'context', title: t ? displayTitle(t) : '' }); }
function aiKey(provider) {
  return unsealSecret(settings.aiKeys?.[provider] || '');
}
async function aiAsk(prompt, wc) {
  const provider = settings.aiProvider;
  const key = aiKey(provider);
  if (!settings.sideOpen) setSide(true);
  if (!key) return aiSend({ type: 'error', text: tr('aic.noKey'), needKey: true });
  let page;
  try { page = await getPage(wc); } catch { return aiSend({ type: 'error', text: tr('ai.cantRead') }); }
  const body = page.selection || page.text;
  if (!body || isInternal(page.url)) return aiSend({ type: 'error', text: tr('ai.noText') });
  // 別のページに移ったら、新しい会話にする
  if (aiConv.url !== page.url) { aiConv = { url: page.url, messages: [] }; aiSend({ type: 'reset' }); }
  sendAIContext();
  const cut = body.length > config.maxChars ? body.slice(0, config.maxChars) + '\n' + tr('ai.cut') : body;
  const first = !aiConv.messages.length;
  const content = first
    ? `${prompt}\n\n# ${tr('ai.pageInfo')}\n${tr('ai.title')}: ${page.title}\nURL: ${page.url}\n\n# ${tr(page.selection ? 'ai.selection' : 'ai.body')}\n${cut}`
    : prompt;
  aiConv.messages.push({ role: 'user', content });
  aiSend({ type: 'user', text: prompt.replace(/^.*\n/, m => (prompt.split('\n').length > 1 ? '' : m)) });
  aiSend({ type: 'start' });
  aiAbort?.abort();
  const ac = aiAbort = new AbortController();
  let answer = '';
  try {
    await aiapi.streamChat({
      provider, key, model: settings.aiModels?.[provider] || '',
      system: tr('aic.system'), messages: aiConv.messages, signal: ac.signal,
      onDelta: text => { answer += text; aiSend({ type: 'delta', text }); },
    });
    aiConv.messages.push({ role: 'assistant', content: answer });
    aiSend({ type: 'done' });
  } catch (e) {
    aiConv.messages.pop();
    if (ac.signal.aborted) return;
    const msg = String(e?.message || e);
    aiSend({ type: 'error', text: tr('aic.failed', { msg: msg.slice(0, 300) }), needKey: /401|invalid.*key|api.key|authentication/i.test(msg) });
  }
}

function setSide(open) {
  settings.sideOpen = !!open;
  if (open) ensureAI(); else aiClosedAt = Date.now();
  layout();
  sendState();
  saveSoon();
}

// 開いているページのタイトル・URL・本文（選択中ならその部分）を取り出す
// ページの JavaScript に結果を書き換えられないよう、別の実行環境（isolated world）で読む
async function getPage(wc) {
  return wc.executeJavaScriptInIsolatedWorld(1002, [{ code: `(() => {
    const selection = String(window.getSelection() || '').trim();
    const root = document.querySelector('article') || document.querySelector('main') || document.body;
    const text = (root ? root.innerText : '').replace(/\\n{3,}/g, '\\n\\n').trim();
    return { title: document.title, url: location.href, selection, text };
  })()` }]);
}

// AIの入力欄にフォーカスして貼り付ける（送信はしない＝内容を確認してから自分で送る）
// AIの入力欄に文章を入れる（送信はしない＝内容を確認してから自分で送る）
// クリップボードは使わない：入力欄に「貼り付け」の操作をページの中で起こす
async function pasteIntoAI(message, isPrivate) {
  const wc = aiView.webContents;
  wc.focus();
  const ok = await wc.executeJavaScript(`((text) => {
    const el = document.querySelector(${JSON.stringify(config.inputSelector)});
    if (!el) return false;
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // React などが変更に気づくよう、本来の value の書き込み口を使ってから input を知らせる
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, (el.value ? el.value + '\\n' : '') + text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    // 入力欄が編集エディター（contenteditable）のときは「貼り付け」を起こす（Claude・ChatGPT・Gemini はこれを受け取る）
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    if (!ev.defaultPrevented) document.execCommand('insertText', false, text);
    return true;
  })(${JSON.stringify(message)})`).catch(() => false);
  // 入力欄が見つからないときだけクリップボードにコピーする（シークレットタブの内容はコピーしない）
  if (!ok && !isPrivate) clipboard.writeText(message);
  return ok;
}

function aiStatus(msg) { ui?.webContents.send('ai-status', msg); }

async function aiAction(prompt, wc = cur()) {
  if (!wc) return aiStatus(tr('ai.noTab'));
  if (settings.aiMode === 'api') return aiAsk(prompt, wc);
  let page;
  try { page = await getPage(wc); } catch { return aiStatus(tr('ai.cantRead')); }
  const body = page.selection || page.text;
  if (!body || isInternal(page.url)) return aiStatus(tr('ai.noText'));
  const cut = body.length > config.maxChars ? body.slice(0, config.maxChars) + '\n' + tr('ai.cut') : body;
  const label = tr(page.selection ? 'ai.selection' : 'ai.body');
  const message = `${prompt}\n\n# ${tr('ai.pageInfo')}\n${tr('ai.title')}: ${page.title}\nURL: ${page.url}\n\n# ${label}\n${cut}`;

  if (!settings.sideOpen) setSide(true);
  // AIパネルが別のサイトに移動していたら送らない（ページの内容をよそのサイトに渡さないため）
  const awc = aiView.webContents;
  if (awc.isLoading()) await new Promise(r => { awc.once('did-stop-loading', r); setTimeout(r, 8000); });
  if (originOf(awc.getURL()) !== originOf(config.ai[settings.aiIndex].url)) {
    return aiStatus(tr('ai.wrongSite', { name: config.ai[settings.aiIndex].name }));
  }
  const isPrivate = isPrivateWc(wc);
  const ok = await pasteIntoAI(message, isPrivate);
  aiStatus(ok
    ? tr('ai.pasted')
    : tr(isPrivate ? 'ai.noInput' : 'ai.copied'));
}

// 言語を切り替えたら、ブラウザ自身の画面を新しい言語で読み込み直す
function applyLanguage() {
  updateTr();
  closePopup();
  closePalette(false);
  closeGlance(false);
  for (const v of [ui, panel, overlay, popup, palette, glanceUi]) {
    if (!v) continue;
    const file = v === ui ? 'index.html' : v === panel ? 'settings.html' : v === palette ? 'palette.html' : v === glanceUi ? 'glance.html' : 'overlay.html';
    const query = v === overlay ? { mode: 'stack' } : v === popup ? { mode: 'popup' } : null;
    v.webContents.loadURL(uiUrl(file, query));
  }
  for (const t of tabs) {
    if (t.view && isNewTab(t.view.webContents.getURL())) t.view.webContents.loadURL(newtabUrl(t.private));
  }
}

// ===== 起動時の引数（既定のブラウザとして開かれたとき） =====
function urlFromArgs(argv) {
  for (const a of argv.slice(1)) {
    if (typeof a !== 'string' || a.startsWith('-')) continue;
    if (/^https?:\/\//i.test(a)) return a;
    if (/\.(html?|xhtml|pdf|svg|txt)$/i.test(a)) {
      try { if (fs.existsSync(a)) return pathToFileURL(path.resolve(a)).href; } catch {}
    }
  }
  return null;
}

// 既定のブラウザに設定する画面を開く
function makeDefaultBrowser() {
  if (process.platform === 'win32') {
    if (!app.isPackaged) return tr('set.defaultDevOnly');
    shell.openExternal('ms-settings:defaultapps?registeredAppUser=My%20Browser');
    return tr('set.defaultPick');
  }
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
  return tr('set.defaultDone');
}

function licensesUrl() {
  const p = path.join(path.dirname(process.execPath), 'LICENSES.chromium.html');
  return fs.existsSync(p) ? pathToFileURL(p).href : 'https://github.com/electron/electron/blob/main/LICENSE';
}

// ===== 起動 =====
app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // File / Edit などのメニューバーを消す
  loadSettings();
  updateTr();
  DEBUG = flagOn('debug.flag');
  NO_SCRIPTLETS = flagOn('noscriptlets.flag');
  NO_COSMETICS = flagOn('nocosmetics.flag');
  dlog('==== start', app.getVersion(), 'electron', process.versions.electron, 'noScriptlets=' + NO_SCRIPTLETS);
  if (DEBUG) startPerfLog();
  history = new History(path.join(app.getPath('userData'), 'history.json'));
  passwords = createPasswords(path.join(app.getPath('userData'), 'passwords.json'));
  // 広告ブロックのリストは、ページを開く前に読み込んでおく（保存済みのものはすぐ使える。古ければ裏で更新）
  // （YouTube などはページ内で移動するので、最初の読み込みに間に合わないと広告が出たままになる）
  adblock.init(app.getPath('userData')).then(() => sendSettings());
  registerUiProtocol(session.defaultSession);
  setupSession(session.defaultSession);
  extensions.init(); // 終わるのは待たない（起動を遅くしないため）
  nativeTheme.themeSource = settings.theme;

  const b = settings.bounds || {};
  win = new BaseWindow({
    width: b.width || 1360, height: b.height || 860, x: b.x, y: b.y,
    minWidth: 800, minHeight: 480,
    frame: false,               // Windows標準のタイトルバーは消して、自作のタイトルバー（ui/index.html）を使う
    backgroundColor: isDark() ? BG.dark : BG.light,
    title: 'My Browser',
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
  });
  if (settings.maximized) win.maximize();
  applyWindowMaterial();
  startSync();

  ui = new WebContentsView({ webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, spellcheck: false } });
  ui.setBackgroundColor('#00000000'); // 透明（幅の変更中にページが透けて見えるように）
  win.contentView.addChildView(ui);
  trust(ui.webContents);
  lockDown(ui.webContents);
  handleKeys(ui.webContents);
  ui.webContents.on('dom-ready', () => { paintTheme(ui.webContents); paintColors(ui.webContents); });
  // 言語の切り替えなどで画面を読み込み直したときは、今の状態を送り直す
  let uiStarted = false;
  ui.webContents.on('did-finish-load', () => { if (uiStarted) { layout(); sendState(); } uiStarted = true; });
  ui.webContents.loadURL(uiUrl('index.html'));
  ui.webContents.once('did-finish-load', () => {
    for (const p of settings.profiles) {
      // 「起動時に前回のタブを復元」がオフなら、固定タブだけ戻す
      const saved = settings.tabs.filter(t => t.profileId === p.id && (settings.restoreTabs || t.pinned));
      const created = saved.map(t => addTab(t, { activate: false, index: tabs.length }));
      const a = created[settings.active?.[p.id] ?? 0] || created[0];
      if (a) lastActive[p.id] = a.id;
    }
    const launchUrl = urlFromArgs(process.argv);
    const first = findTab(lastActive[settings.profileId]) || pickNext(null);
    if (launchUrl) newTab(launchUrl);
    else if (first) activateTab(first.id); else newTab();
    if (settings.sideOpen) setSide(true);
    watchPeek();
    layout();
    updater.start(settings.autoUpdate);
  });

  updater = createUpdater(() => sendSettings());

  nativeTheme.on('updated', () => { applyTheme(); sendState(); });
  win.on('resize', layout);
  // マウスのサイドボタン（Windows では「戻る・進む」のコマンドとして届く）
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') onSideButton('back');
    if (cmd === 'browser-forward') onSideButton('forward');
  });
  win.on('maximize', layout);
  win.on('unmaximize', layout);
  win.on('leave-full-screen', () => { if (fullscreenTab != null) { fullscreenByPage = false; forceExitFullscreen(); } });
  win.on('close', () => {
    settings.maximized = win.isMaximized();
    settings.bounds = win.getNormalBounds();
    clearTimeout(saveTimer);
    saveSettings();
    history.saveNow();
  });
  win.on('closed', () => app.quit());
  setInterval(() => sleepIdleTabs(false), 60 * 1000);
  setInterval(tickUsage, 5000);
  setInterval(archiveIdleTabs, 10 * 60 * 1000);
  setTimeout(archiveIdleTabs, 60 * 1000);
  // 広告ブロックのリストは、起動したままでも古くなったら更新する
  setInterval(() => { if (settings.adblock) adblock.init(app.getPath('userData')).then(() => sendSettings()); }, 60 * 60 * 1000);

  // ---- タブ ----
  on('new-tab', () => openPalette('new'));
  on('new-private-tab', () => openPalette('new', { private: true }));
  on('new-tab-menu', () => Menu.buildFromTemplate([
    { label: tr('menu.newTab'), accelerator: 'Ctrl+T', click: () => openPalette('new') },
    { label: tr('menu.newPrivateTab'), accelerator: 'Ctrl+Shift+N', click: () => openPalette('new', { private: true }) },
    { label: tr('menu.blankTab'), click: () => newTab() },
    { type: 'separator' },
    { label: tr('menu.reopenClosed'), accelerator: 'Ctrl+Shift+T', enabled: closedStack.length > 0, click: () => newTab(closedStack.pop()) },
  ]).popup());
  on('close-tab', id => closeTab(num(id)));
  on('switch-tab', id => activateTab(num(id)));
  on('move-tab', (id, beforeId, pinned, folderId) => moveTab(num(id), beforeId == null ? null : num(beforeId), !!pinned, folderId === undefined ? undefined : (folderId ? str(folderId, 40) : null)));
  on('folder-toggle', id => { const f = settings.folders.find(x => x.id === id); if (f) { f.open = f.open === false; sendState(); saveSoon(); } });
  on('folder-rename', (id, name) => { const f = settings.folders.find(x => x.id === id); const n = str(name, 40).trim(); if (f && n) { f.name = n; sendState(); saveSoon(); } });
  on('folder-create', () => createFolder(null));
  on('folder-menu', id => {
    const f = settings.folders.find(x => x.id === id);
    if (!f) return;
    Menu.buildFromTemplate([
      { label: tr('folder.rename'), click: () => ui.webContents.send('folder-rename', f.id) },
      { label: tr('folder.delete'), click: () => deleteFolder(f.id) },
    ]).popup();
  });
  on('clear-tabs', () => clearTabs());
  on('tab-menu', id => {
    const t = findTab(num(id));
    if (!t) return;
    Menu.buildFromTemplate([
      ...(t.private ? [] : [{ label: tr(t.pinned ? 'menu.unpin' : 'menu.pin'), click: () => moveTab(t.id, null, !t.pinned) }]),
      ...(t.private ? [] : [{
        label: tr('folder.moveTo'),
        submenu: [
          ...settings.folders.filter(f => f.profileId === t.profileId && f.id !== t.folderId).map(f => ({ label: f.name, click: () => moveTab(t.id, null, true, f.id) })),
          { label: tr('folder.newWith'), click: () => createFolder(t.id) },
          ...(t.folderId ? [{ type: 'separator' }, { label: tr('folder.takeOut'), click: () => moveTab(t.id, null, true, null) }] : []),
        ],
      }]),
      { label: tr('menu.addFavorite'), enabled: !isInternal(t.url) && !t.private, click: () => tabToFavorite(t.id) },
      { label: tr('menu.duplicate'), click: () => addTab({ url: isInternal(t.url) ? '' : savedUrl(t), private: t.private }) },
      { label: tr('menu.copyUrl'), enabled: !!displayUrl(t), click: () => clipboard.writeText(displayUrl(t)) },
      { label: tr(t.view?.webContents.isAudioMuted() ? 'menu.unmute' : 'menu.mute'), enabled: !!t.view, click: () => { t.view.webContents.setAudioMuted(!t.view.webContents.isAudioMuted()); } },
      { label: tr('menu.sleep'), enabled: !!t.view && !paneRects[t.id], click: () => { unloadView(t); sendState(); } },
      { type: 'separator' },
      ...(t.id !== activeId && !splitOf(activeId)?.includes(t.id) && activeTab() ? [{ label: tr('menu.splitWith'), click: () => splitWith(activeId, t.id) }] : []),
      ...(splitOf(t.id) ? [{ label: tr('menu.unsplit'), click: () => unsplit(t.id) }] : []),
      ...(settings.profiles.length > 1 && !t.private ? [{
        label: tr('menu.moveToProfile'),
        submenu: settings.profiles.filter(p => p.id !== t.profileId).map(p => ({
          label: profileName(p), click: () => { removeFromSplit(t.id); if (sessionKey(t.profileId) !== sessionKey(p.id)) unloadView(t); t.profileId = p.id; if (activeId === t.id) { const n = pickNext(t.id); if (n) activateTab(n.id); else newTab(); } else { sendState(); } saveSoon(); },
        })),
      }] : []),
      { type: 'separator' },
      { label: tr(t.pinned ? 'menu.sleepPinned' : 'menu.close'), click: () => closeTab(t.id) },
      ...(t.pinned ? [{ label: tr('menu.unpinAndClose'), click: () => { moveTab(t.id, null, false); closeTab(t.id); } }] : []),
    ]).popup();
  });
  on('navigate', input => { closePopup(); navigateActive(str(input)); });
  on('back', () => cur()?.navigationHistory.goBack());
  on('forward', () => cur()?.navigationHistory.goForward());
  on('reload', () => {
    const t = activeTab();
    if (t?.error) return onErrorSignal(t, 'retry');
    cur()?.reload();
  });
  on('zoom-reset', () => zoom(0));

  // ---- お気に入り ----
  on('open-favorite', id => openFavorite(str(id, 64)));
  on('tab-to-favorite', (id, beforeFavId) => tabToFavorite(num(id), beforeFavId ? str(beforeFavId, 64) : null));
  on('move-favorite', (id, beforeId) => moveFavorite(str(id, 64), beforeId ? str(beforeId, 64) : null));
  on('remove-favorite', id => removeFavorite(str(id, 64)));
  on('favorite-menu', id => {
    const f = settings.favorites.find(x => x.id === id);
    if (!f) return;
    const t = tabs.find(x => x.favId === id);
    Menu.buildFromTemplate([
      { label: tr('menu.open'), click: () => openFavorite(id) },
      { label: tr('menu.openNewTab'), click: () => newTab(f.url) },
      { label: tr('menu.copyUrl'), click: () => clipboard.writeText(f.url) },
      { type: 'separator' },
      { label: tr('menu.sleep'), enabled: !!t?.view, click: () => closeTab(t.id) },
      { label: tr('menu.removeFavorite'), click: () => removeFavorite(id) },
    ]).popup();
  });

  // ---- プロフィール ----
  on('switch-profile', id => switchProfile(str(id, 64)));
  on('add-profile', name => addProfile(str(name, 30)));
  on('rename-profile', (id, name) => renameProfile(str(id, 64), str(name, 30)));
  on('delete-profile', id => deleteProfile(str(id, 64)));
  on('profile-menu', id => {
    const p = settings.profiles.find(x => x.id === id);
    if (!p) return;
    Menu.buildFromTemplate([
      { label: tr('menu.switch'), click: () => switchProfile(id) },
      { label: tr('menu.rename'), click: () => openSettings('profiles') },
      { type: 'separator' },
      { label: tr('menu.delete'), enabled: settings.profiles.length > 1, click: () => deleteProfile(id) },
    ]).popup();
  });

  // ---- ウィンドウ・サイドバー ----
  on('toggle-sidebar', () => toggleSidebar());
  on('win-min', () => win.minimize());
  on('win-max', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  on('win-close', () => win.close());
  on('resize-start', which => resizeStart(str(which, 16)));
  on('resize-to', x => resizeTo(num(x)));
  on('resize-end', () => resizeEnd());

  // ---- 設定 ----
  on('open-settings', tab => toggleSettings(tab ? str(tab, 16) : undefined));
  on('close-settings', () => closeSettings());
  on('settings-tab', tab => { settingsTab = str(tab, 16); });
  on('set-search-engine', id => { if (ENGINES[id]) { settings.searchEngine = id; sendSettings(); saveSoon(); } });
  on('set-restore', v => { settings.restoreTabs = !!v; sendSettings(); saveSoon(); });
  on('set-theme', theme => {
    if (!['light', 'dark', 'system'].includes(theme)) return;
    settings.theme = theme;
    applyTheme();
    sendState();
    saveSoon();
  });
  on('set-colors', c => {
    if (!c || typeof c !== 'object') return;
    const cur = settings.colors;
    const col = v => (v === '' || HEX.test(String(v)) ? String(v) : undefined);
    settings.colors = {
      side: col(c.side) ?? cur.side, top: col(c.top) ?? cur.top,
      alpha: c.alpha != null ? Math.max(10, Math.min(100, Math.round(num(c.alpha)))) : cur.alpha,
    };
    applyWindowMaterial();
    paintColors(ui?.webContents);
    sendSettings();
    saveSoon();
  });
  on('side-button', d => onSideButton(d === 'back' ? 'back' : 'forward'));
  on('set-sync', async mode => {
    if (mode === 'off') settings.syncDir = '';
    else if (mode === 'onedrive') settings.syncDir = require('./lib/sync').defaultDir();
    else if (mode === 'pick') {
      const r = await dialog.showOpenDialog(win, { title: tr('sync.pickTitle'), properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return;
      settings.syncDir = r.filePaths[0];
    }
    startSync();
    sync.push();
    sendSettings();
    saveSoon();
  });
  on('set-archive-after', h => { if (ARCHIVE_CHOICES.includes(num(h))) { settings.archiveAfter = num(h); sendSettings(); saveSoon(); } });
  on('archive-open', url => {
    const a = settings.archive.find(x => x.url === str(url));
    if (!a) return;
    settings.archive = settings.archive.filter(x => x !== a);
    addTab({ url: a.url, title: a.title, favicon: a.favicon });
    sendSettings(); saveSoon();
  });
  on('archive-remove', url => { settings.archive = url == null ? [] : settings.archive.filter(x => x.url !== str(url)); sendSettings(); saveSoon(); });
  on('set-limit', (site, minutes) => {
    const host = hider.siteOf('https://' + str(site, 200).trim().replace(/^https?:\/\//, '').split('/')[0]);
    if (!host || !/\./.test(host)) return;
    const m = Math.round(num(minutes));
    if (m > 0 && m <= 24 * 60) settings.limits[host] = m; else delete settings.limits[host];
    sendSettings();
    saveSoon();
  });
  on('hide-start', () => startHide(cur()));
  on('hide-remove', (site, sel) => {
    const list = settings.hideRules[str(site, 200)];
    if (!list) return;
    if (sel == null) return clearHide(str(site, 200));
    settings.hideRules[site] = list.filter(x => x !== sel);
    if (!settings.hideRules[site].length) return clearHide(site);
    sendSettings(); saveSoon();
  });
  on('set-side-buttons', v => { if (['profile', 'history', 'off'].includes(v)) { settings.sideButtons = v; sendSettings(); saveSoon(); } });
  on('set-widths', w => setWidths({ sidebarW: w?.sidebarW, aiW: w?.aiW }));
  on('set-lang', lang => {
    if (!['ja', 'en', 'system'].includes(lang) || lang === settings.lang) return;
    settings.lang = lang;
    saveSoon();
    applyLanguage();
  });
  // オン/オフの設定
  const toggles = ['adblock', 'httpsOnly', 'gpc', 'saveHistory', 'askDownload', 'autoUpdate', 'passwordSave', 'sponsorSkip', 'autoPip'];
  on('set-option', (key, value) => {
    if (!toggles.includes(key)) return;
    settings[key] = !!value;
    if (key === 'adblock' && value) adblock.init(app.getPath('userData')).then(sendSettings);
    if (key === 'autoUpdate') updater.start(settings.autoUpdate);
    sendSettings();
    saveSoon();
  });
  on('set-sleep', minutes => { if (SLEEP_CHOICES.includes(num(minutes))) { settings.sleepAfter = num(minutes); sendSettings(); saveSoon(); } });
  // サイトごとの例外（広告ブロック・ポップアップ・HTTPS）の削除
  on('remove-exception', (list, host) => {
    if (!['adblockAllow', 'popupsAllow', 'httpsExceptions'].includes(list)) return;
    settings[list] = settings[list].filter(h => h !== host);
    sendSettings();
    saveSoon();
  });
  on('set-permission', (origin, key, value) => {
    if (!originOf(str(origin))) return;
    security.setDecision(str(origin), str(key, 64), str(value, 8));
    sendPopup();
  });
  on('clear-site-permissions', origin => { security.clearSite(str(origin)); });
  handle('clear-data', async kind => {
    const ses = session.defaultSession;
    if (kind === 'cache') { await ses.clearCache(); return tr('set.cacheCleared'); }
    if (kind === 'all') {
      for (const s of allSessions()) { await s.clearCache(); await s.clearStorageData(); }
      for (const t of tabs) if (!t.private) t.view?.webContents.reload();
      aiView?.webContents.reload();
      return tr('set.cookiesCleared');
    }
    return '';
  });
  handle('history-list', q => history.list(str(q, 200), 200));
  on('history-remove', url => { history.remove(str(url)); sendSettings(); });
  handle('history-clear', range => {
    const H = 60 * 60 * 1000;
    const since = { hour: Date.now() - H, day: Date.now() - 24 * H, week: Date.now() - 7 * 24 * H, all: 0 }[range];
    if (since == null) return '';
    history.clear(since);
    return tr('set.historyCleared');
  });
  on('history-open', url => { const u = str(url); if (/^https?:/i.test(u)) { newTab(u); closeSettings(); } });
  handle('metrics', () => metrics());
  handle('sleep-now', () => sleepIdleTabs(true));
  handle('choose-download-dir', async () => {
    const r = await dialog.showOpenDialog(win, { title: tr('set.downloadDirTitle'), defaultPath: downloads.dir(), properties: ['openDirectory', 'createDirectory'] });
    if (!r.canceled && r.filePaths[0]) { settings.downloadDir = r.filePaths[0]; saveSoon(); }
    sendSettings();
    return downloads.dir();
  });
  handle('make-default', () => makeDefaultBrowser());
  on('check-update', () => updater.check());
  on('install-update', () => updater.install());
  on('open-privacy', () => { newTab(uiUrl(curLang() === 'en' ? 'privacy-en.html' : 'privacy.html')); closeSettings(); });
  on('open-licenses', () => { newTab(licensesUrl()); closeSettings(); });
  on('open-data-folder', () => shell.openPath(app.getPath('userData')));

  // ---- ページ右上のカード ----
  on('overlay-size', h => { overlayHeight = Math.max(0, Math.min(800, num(h) || 0)); placeOverlay(); });
  on('card-action', (id, action) => cardAction(str(id, 64), str(action, 16)));
  on('find', (text, forward, next) => doFind(str(text, 500), forward !== false, !!next));
  on('find-close', () => { closeFind(); cur()?.focus(); });

  // ---- ポップアップ ----
  on('popup-open', (mode, anchor) => {
    if (!['suggest', 'site', 'downloads'].includes(mode) || !anchor) return;
    openPopup(mode, { x: num(anchor.x), y: num(anchor.y), width: num(anchor.width), align: anchor.align === 'right' ? 'right' : 'left' });
  });
  on('popup-close', () => closePopup());
  on('popup-size', (w, h) => { popupSize = { width: Math.max(160, Math.min(680, num(w) || 320)), height: Math.max(0, Math.min(700, num(h) || 0)) }; placePopup(); });
  handle('suggest', q => {
    const items = suggestions(str(q, 500));
    // 一番上の候補（Enter を押すと開くもの）へ先に接続しておく
    if (items[0]) {
      const t = activeTab();
      const wc = t?.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
      preconnect(wc ? wc.session : (t?.private ? getPrivateSession() : sessionFor(t ? tabPid(t) : settings.profileId)), items[0].url, '');
    }
    return items;
  });
  on('suggest-show', (items, sel, anchor) => {
    if (!Array.isArray(items) || !items.length) return closePopup();
    const data = { items: items.slice(0, 8).map(x => ({ kind: str(x.kind, 16), title: str(x.title, 300), url: str(x.url), engine: str(x.engine, 40), favicon: str(x.favicon) })), sel: num(sel) };
    if (popupMode === 'suggest') { popupData = data; sendPopup(); } else openPopup('suggest', { x: num(anchor?.x), y: num(anchor?.y), width: num(anchor?.width) }, data);
  });
  on('popup-pick', url => {
    const u = str(url);
    closePopup();
    ui.webContents.send('url-picked');
    if (/^(https?|file):/i.test(u)) navigateActive(u);
  });
  on('site-adblock', enabled => {
    const host = hostOf(displayUrl(activeTab() || {}));
    if (!host) return;
    settings.adblockAllow = settings.adblockAllow.filter(h => h !== host);
    if (!enabled) settings.adblockAllow.push(host);
    saveSoon();
    sendPopup();
    sendSettings();
  });
  on('site-popups', enabled => {
    const host = hostOf(displayUrl(activeTab() || {}));
    if (!host) return;
    settings.popupsAllow = settings.popupsAllow.filter(h => h !== host);
    if (enabled) settings.popupsAllow.push(host);
    saveSoon();
    sendPopup();
    sendSettings();
  });
  handle('site-clear', async () => {
    const t = activeTab();
    const origin = originOf(displayUrl(t || {}));
    if (!origin) return '';
    const ses = t.view?.webContents.session || (t.private ? getPrivateSession() : sessionFor(tabPid(t)));
    await ses.clearStorageData({ origin });
    return tr('site.cleared');
  });
  on('site-reload', () => { closePopup(); cur()?.reload(); });
  on('download-action', (id, action) => downloads.action(str(id, 32), str(action, 16)));
  on('downloads-clear', () => downloads.clearFinished());
  on('downloads-folder', () => downloads.openFolder());

  // ---- 新しいタブ・コマンドバー ----
  on('palette-open', mode => openPalette(['new', 'command', 'split'].includes(mode) ? mode : 'new'));
  on('palette-close', () => closePalette());
  handle('palette-query', (q, mode) => paletteItems(str(q, 500), str(mode, 16)));
  on('palette-run', (item, opts) => paletteRun(item && typeof item === 'object' ? {
    kind: str(item.kind, 16), url: str(item.url), tabId: num(item.tabId), cmd: str(item.cmd, 32), favId: str(item.favId, 64), text: str(item.text, 2000),
  } : null, { split: !!opts?.split }));

  // ---- リンクのプレビュー ----
  on('glance-action', action => {
    if (action === 'tab') glanceToTab(false);
    else if (action === 'split') glanceToTab(true);
    else closeGlance();
  });

  // ---- 翻訳 ----
  on('translate-toggle', () => toggleTranslate(activeTab()));
  on('set-translate', (engine, key) => {
    if (['google', 'deepl'].includes(engine)) settings.translateEngine = engine;
    if (typeof key === 'string') settings.deeplKey = sealSecret(str(key, 200).trim());
    saveSoon();
    sendSettings();
  });

  // ---- パスワード ----
  on('pw-fill', id => fillPassword(str(id, 64)));
  on('pw-manage', () => { closePopup(); openSettings('passwords'); });
  handle('pw-reveal', id => passwords.get(str(id, 64))?.password ?? '');
  on('pw-remove', id => { passwords.remove(str(id, 64)); sendSettings(); });
  on('pw-never-remove', origin => { passwords.removeNever(str(origin)); sendSettings(); });
  handle('pw-import-csv', async () => {
    const r = await dialog.showOpenDialog(win, { title: tr('pw.importTitle'), properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePaths[0]) return '';
    let text;
    try { text = fs.readFileSync(r.filePaths[0], 'utf8'); } catch { return tr('pw.importError'); }
    const res = passwords.importCsv(text);
    sendSettings();
    if (res.error === 'unavailable') return tr('pw.unavailable');
    if (res.error) return tr('pw.importFormat');
    return tr('pw.imported', res);
  });

  // ---- ほかのブラウザから読み込む・ブックマーク ----
  handle('import-sources', () => importer.detect().map(s => ({ id: s.id, browser: s.browser, profile: s.profile, bookmarks: s.bookmarks, history: s.history })));
  handle('import-run', async (id, what) => {
    const r = await runImport(str(id, 300), { bookmarks: !!what?.bookmarks, favorites: !!what?.favorites, history: !!what?.history });
    if (r.error && !r.bookmarks && !r.history) return r.error;
    return tr('imp.done', r) + (r.error ? '\n' + r.error : '');
  });
  on('bookmarks-clear', () => { settings.bookmarks = []; saveSoon(); sendSettings(); });

  // ---- プロフィールのログイン情報 ----
  on('set-profile-separate', (id, on2) => setProfileSeparate(str(id, 64), !!on2));

  // ---- 拡張機能 ----
  handle('ext-list', () => ({ items: extensions.list(), error: extensions.status().error }));
  handle('ext-remove', id => extensions.remove(str(id, 64)));
  on('ext-options', id => {
    const x = extensions.list().find(e => e.id === id);
    if (x?.options) { newTab(x.options); closeSettings(); }
  });
  on('open-webstore', () => { newTab('https://chromewebstore.google.com/'); closeSettings(); });

  // ---- AIパネル ----
  on('toggle-side', () => setSide(!settings.sideOpen));
  on('select-ai', i => {
    i = num(i);
    // -1 = 内蔵AI（自分のAPIキー）
    if (i === -1) {
      if (settings.aiMode !== 'api') { settings.aiMode = 'api'; rebuildAI(); }
    } else {
      if (!config.ai[i]) return;
      settings.aiIndex = i;
      if (settings.aiMode !== 'site') { settings.aiMode = 'site'; rebuildAI(); }
      else aiView?.webContents.loadURL(config.ai[i].url).catch(() => {});
    }
    sendState();
    sendSettings();
    saveSoon();
  });
  on('ai-reload', () => { if (settings.aiMode === 'api') aiView?.webContents.reload(); else aiView?.webContents.loadURL(config.ai[settings.aiIndex].url).catch(() => {}); });
  on('ai-open-tab', () => { if (settings.aiMode !== 'api') newTab(config.ai[settings.aiIndex].url); });
  handle('ai-chat-state', () => ({
    provider: settings.aiProvider, model: settings.aiModels?.[settings.aiProvider] || '', hasKey: !!aiKey(settings.aiProvider),
    providerName: aiapi.PROVIDERS[settings.aiProvider]?.name,
    providers: Object.entries(aiapi.PROVIDERS).map(([id, p]) => ({ id, name: p.name, model: p.model })),
  }));
  handle('ai-set-key', (provider, key, model) => {
    provider = str(provider, 20);
    if (!aiapi.PROVIDERS[provider]) return false;
    settings.aiProvider = provider;
    settings.aiModels = { ...(settings.aiModels || {}), [provider]: str(model, 80).trim() };
    key = str(key, 400).trim();
    if (key) {
      settings.aiKeys = { ...(settings.aiKeys || {}), [provider]: sealSecret(key) };
    }
    aiConv = { url: '', messages: [] };
    saveSoon();
    return true;
  });
  on('ai-chat-reset', () => { aiAbort?.abort(); aiConv = { url: '', messages: [] }; });
  on('ai-open-key-page', provider => { const p = aiapi.PROVIDERS[str(provider, 20)]; if (p) newTab(p.keyUrl); });
  handle('get-config', () => ({ ai: config.ai.map(a => a.name), prompts: promptsFor(curLang()) }));
  on('ai-action', prompt => aiAction(str(prompt, 2000)));
});

app.on('before-quit', () => { history?.saveNow(); });
