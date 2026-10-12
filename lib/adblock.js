// 広告とトラッカーのブロック（EasyList / EasyPrivacy などのリストを Ghostery のエンジンで判定）
// リストは数日に1回だけダウンロードして、userData に保存したものを使い回す（起動を軽くするため）
const fs = require('fs');
const path = require('path');
const { net, utilityProcess } = require('electron');
// 部品が入っていない（npm install 前の）ときも、ブラウザ自体は動くようにする
let FiltersEngine = null, Request = null;
try { ({ FiltersEngine, Request } = require('@ghostery/adblocker')); } catch {}

const MAX_AGE = 12 * 60 * 60 * 1000; // 12時間ごとに更新（YouTube などは広告の出し方がよく変わるため）

// リストは公式の配布元から直接取る（つながらないときは Ghostery のミラーを使う）
const G = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets';
const U = 'https://ublockorigin.github.io/uAssets';
const UR = 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master';
const LISTS = [
  [`${U}/thirdparties/easylist.txt`, 'https://easylist.to/easylist/easylist.txt', `${G}/easylist/easylist.txt`],
  [`${U}/thirdparties/easyprivacy.txt`, 'https://easylist.to/easylist/easyprivacy.txt', `${G}/easylist/easyprivacy.txt`],
  [`${U}/filters/filters.txt`, `${UR}/filters/filters.txt`, `${G}/ublock-origin/filters.txt`],
  [`${U}/filters/quick-fixes.txt`, `${UR}/filters/quick-fixes.txt`, `${G}/ublock-origin/quick-fixes.txt`],
  [`${U}/filters/unbreak.txt`, `${UR}/filters/unbreak.txt`, `${G}/ublock-origin/unbreak.txt`],
  [`${U}/filters/privacy.txt`, `${UR}/filters/privacy.txt`, `${G}/ublock-origin/privacy.txt`],
  [`${U}/filters/badware.txt`, `${UR}/filters/badware.txt`, `${G}/ublock-origin/badware.txt`],
  [`${U}/filters/resource-abuse.txt`, `${UR}/filters/resource-abuse.txt`, `${G}/ublock-origin/resource-abuse.txt`],
  [`${G}/peter-lowe/serverlist.txt`],
];
// 広告を外すスクリプトの中身（uBlock Origin の resources を Ghostery がまとめたもの）
const RESOURCES = [`${G}/ublock-origin/resources.json`];

// リストが古くても効くように、YouTube の広告枠を隠す決まりを足しておく
const EXTRA_FILTERS = `
youtube.com##ytd-ad-slot-renderer
youtube.com##ytd-rich-item-renderer:has(ytd-ad-slot-renderer)
youtube.com##ytd-rich-section-renderer:has(ytd-ad-slot-renderer)
youtube.com##ytd-in-feed-ad-layout-renderer
youtube.com##ytd-rich-item-renderer:has(ytd-in-feed-ad-layout-renderer)
youtube.com###masthead-ad
youtube.com##ytd-banner-promo-renderer
youtube.com##ytd-statement-banner-renderer
youtube.com##ytd-display-ad-renderer
youtube.com##ytd-promoted-sparkles-web-renderer
youtube.com##ytd-promoted-video-renderer
youtube.com##ytd-companion-slot-renderer
youtube.com##ytd-action-companion-ad-renderer
youtube.com##ytd-player-legacy-desktop-watch-ads-renderer
youtube.com###player-ads
youtube.com##.ytd-merch-shelf-renderer
youtube.com##ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]
youtube.com##ytd-search-pyv-renderer
youtube.com##ytd-reel-video-renderer:has(ytd-ad-slot-renderer)
youtube.com##.ytp-ad-overlay-container
youtube.com##.ytp-featured-product
`;

// 候補のURLを順に試す
async function fetchFirst(urls) {
  let last;
  for (const url of urls) {
    try {
      const res = await net.fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      if (text.length < 50) throw new Error('empty');
      return text;
    } catch (e) { last = e; }
  }
  throw last || new Error('fetch failed');
}

// Electron の resourceType → フィルタの種類
const TYPES = {
  subFrame: 'sub_frame', stylesheet: 'stylesheet', script: 'script', image: 'image',
  font: 'font', object: 'object', xhr: 'xmlhttprequest', ping: 'ping', cspReport: 'csp_report',
  media: 'media', webSocket: 'websocket', other: 'other',
};

let engine = null;
let updatedAt = 0;
let loading = null;
const counts = new Map(); // webContents.id → このページでブロックした数

// v2: 公式の配布元のリストで作り直したもの（古い形式の保存ファイルは使わない）
function cacheFile(dir) { return path.join(dir, 'adblock-engine-v2.bin'); }

function loadCache(dir) {
  if (!FiltersEngine) return false;
  if (engine) return true; // 読み込み済み（あとは古いかどうかだけ見る）
  try {
    const file = cacheFile(dir);
    const st = fs.statSync(file);
    engine = FiltersEngine.deserialize(new Uint8Array(fs.readFileSync(file)));
    updatedAt = st.mtimeMs;
    return true;
  } catch {}
  // 新しいリストのダウンロードが終わるまでは、前のバージョンの保存ファイルを使う
  try {
    engine = FiltersEngine.deserialize(new Uint8Array(fs.readFileSync(path.join(dir, 'adblock-engine.bin'))));
    updatedAt = 0; // 古い扱いにして、すぐに作り直す
  } catch {}
  return false;
}

// 起動のあとで呼ぶ。保存済みのリストがあればそれを使い、古ければ裏で更新する
function init(dir, { force = false } = {}) {
  if (loading) return loading;
  if (!FiltersEngine) return Promise.resolve(false);
  const haveCache = !force && loadCache(dir);
  if (haveCache && Date.now() - updatedAt < MAX_AGE) return Promise.resolve(true);
  loading = (async () => {
    try {
      const bin = await build();
      // 作ったものを保存してから使い始める（読み込みは一瞬で終わる）
      await fs.promises.writeFile(cacheFile(dir), Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength));
      engine = FiltersEngine.deserialize(bin);
      updatedAt = Date.now();
      return true;
    } catch (e) {
      console.warn('広告ブロックのリストを更新できませんでした:', e.message);
      return !!engine;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

// リストをダウンロードしてエンジンを作る（どれか1つのリストが取れなくても、残りで作る）
// ダウンロードは本体で（通信は待つだけで本体を止めない）、重い組み立ては別プロセスで行う
async function build() {
  const texts = await Promise.all(LISTS.map(urls => fetchFirst(urls).catch(e => {
    console.warn('広告ブロックのリストを取得できませんでした:', urls[0], e.message);
    return '';
  })));
  if (!texts.some(Boolean)) throw new Error('no lists');
  let resources = '';
  try { resources = await fetchFirst(RESOURCES); } catch (e) { console.warn('広告ブロックのスクリプトを取得できませんでした:', e.message); }
  try {
    return await buildInWorker(texts, resources);
  } catch (e) {
    // 別プロセスが使えないときは、ここで作る（その間は少し重くなる）
    console.warn('広告ブロックのリストを別プロセスで作れませんでした:', e.message);
    const fresh = FiltersEngine.parse(texts.join('\n') + '\n' + EXTRA_FILTERS, { loadCosmeticFilters: true, loadNetworkFilters: true });
    if (resources) { try { fresh.updateResources(resources, '' + resources.length); } catch {} }
    return fresh.serialize();
  }
}

function buildInWorker(texts, resources) {
  return new Promise((resolve, reject) => {
    if (!utilityProcess) return reject(new Error('no utilityProcess'));
    let child;
    try { child = utilityProcess.fork(path.join(__dirname, 'adblock-build.js'), [], { serviceName: 'My Browser Adblock' }); } catch (e) { return reject(e); }
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); try { child.kill(); } catch {} fn(v); };
    const timer = setTimeout(() => finish(reject, new Error('timeout')), 120000);
    child.on('message', m => {
      if (m && m.ok && m.bin) finish(resolve, m.bin instanceof Uint8Array ? m.bin : new Uint8Array(m.bin));
      else finish(reject, new Error((m && m.error) || 'build failed'));
    });
    child.on('exit', code => finish(reject, new Error('exited ' + code)));
    child.postMessage({ texts, extra: EXTRA_FILTERS, resources });
  });
}

// テストや独自リスト用
function useFilters(text) {
  if (!FiltersEngine) return;
  engine = FiltersEngine.parse(text);
  updatedAt = Date.now();
}

// 1件のリクエストを判定する。ブロックするなら { cancel } か { redirectURL } を返す
function check(details, pageUrl) {
  if (!engine || !pageUrl) return null;
  const type = TYPES[details.resourceType];
  if (!type) return null;
  const { match, redirect } = engine.match(Request.fromRawDetails({ url: details.url, sourceUrl: pageUrl, type }));
  if (redirect) return { redirectURL: redirect.dataUrl };
  if (match) return { cancel: true };
  return null;
}

// ページ内で使う「要素を隠すCSS」と「広告を外すスクリプト」
// isMain: ページ本体（iframe ではない）なら、どのサイトにも使う共通ルールも返す
let getDomain = null;
try { ({ getDomain } = require('tldts-experimental')); } catch {}
function cosmetics(url, isMain) {
  if (!engine) return null;
  let hostname = '';
  try { hostname = new URL(url).hostname; } catch { return null; }
  const domain = (getDomain && getDomain(hostname)) || hostname;
  const r = engine.getCosmeticsFilters({
    url, hostname, domain,
    getBaseRules: isMain, getInjectionRules: true, getExtendedRules: false,
    getRulesFromDOM: false, getRulesFromHostname: true,
  });
  if (!r || r.active === false) return null;
  return { styles: r.styles || '', scripts: r.scripts || [] };
}

function countBlocked(wcId) { counts.set(wcId, (counts.get(wcId) || 0) + 1); }
function resetCount(wcId) { counts.delete(wcId); }
function blockedCount(wcId) { return counts.get(wcId) || 0; }

function status() {
  return { ready: !!engine, updatedAt, loading: !!loading, missing: !FiltersEngine };
}

module.exports = { init, useFilters, check, cosmetics, countBlocked, resetCount, blockedCount, status };
