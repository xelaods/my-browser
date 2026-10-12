// YouTube の広告対策（リストのルールが効かなかったときの保険）
// ブラウザ側（main.js）からページに入れる。ページ側のスクリプト（preload）が動かなくても効くようにするため
//  - 「スポンサー」などの広告カードを、カードごと隠す
//  - 動画広告が流れたら、音を消して最後まで飛ばし、「スキップ」を押す（終わったら音と速さを元に戻す）

const SCRIPT = `(() => {
  if (window.__mbYouTube) return;
  window.__mbYouTube = true;

  // 広告そのものの部品
  const AD = [
    'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ad-badge-view-model', 'feed-ad-metadata-view-model',
    'ytd-promoted-sparkles-web-renderer', 'ytd-promoted-video-renderer', 'ytd-display-ad-renderer', 'ytd-banner-promo-renderer',
    'ytd-statement-banner-renderer', 'ytd-companion-slot-renderer', 'ytd-action-companion-ad-renderer', 'ytd-search-pyv-renderer',
    'ytd-player-legacy-desktop-watch-ads-renderer', 'ytd-merch-shelf-renderer', '#masthead-ad', '#player-ads',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
  ].join(',');
  // 広告を含んでいたら、まるごと隠す入れ物（一覧の1枠）
  const BOX = 'ytd-rich-item-renderer, ytd-rich-section-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-reel-video-renderer, ytd-search-pyv-renderer';

  // 一覧の広告カードは CSS でも隠す（スクリプトが動く前の一瞬にも見えないように）
  try {
    const css = document.createElement('style');
    css.textContent = 'ytd-rich-item-renderer:has(ad-badge-view-model, feed-ad-metadata-view-model, ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer),' +
      'ytd-rich-section-renderer:has(ytd-ad-slot-renderer, ytd-statement-banner-renderer),' +
      'ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-banner-promo-renderer, ytd-statement-banner-renderer, #masthead-ad,' +
      'ytd-compact-promoted-video-renderer, ytd-promoted-sparkles-web-renderer, ytd-search-pyv-renderer, #player-ads' +
      '{display:none!important}';
    (document.head || document.documentElement).appendChild(css);
  } catch (e) {}

  const hide = el => { if (el && el.style.getPropertyValue('display') !== 'none') el.style.setProperty('display', 'none', 'important'); };
  function sweep() {
    for (const el of document.querySelectorAll(AD)) hide(el.closest(BOX) || el);
  }

  // 動画プレーヤーごとの状態（本編のプレーヤーと、サムネイルにマウスを乗せたときのプレビュー用プレーヤー）
  const state = new WeakMap();
  function skipIn(player) {
    const video = player.querySelector('video.html5-main-video') || player.querySelector('video');
    const ad = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
    let st = state.get(player);
    if (!st) { st = { adOn: false, wasMuted: false, oldRate: 1 }; state.set(player, st); }
    if (ad && video) {
      if (!st.adOn) { st.adOn = true; st.wasMuted = video.muted; st.oldRate = video.playbackRate > 2 ? 1 : video.playbackRate; st.saved = 0; }
      // 飛ばした広告の長さ（節約した時間として数える）
      if (Number.isFinite(video.duration) && video.duration > 0) st.saved = Math.max(st.saved || 0, video.duration - (video.currentTime || 0));
      video.muted = true;
      try { video.playbackRate = 16; } catch (e) {}
      // 最後の少し手前まで飛ばして再生を続ける（ぴったり最後にすると、止まったまま次へ進まないことがある）
      if (Number.isFinite(video.duration) && video.duration > 0.5 && video.currentTime < video.duration - 0.3) {
        try { video.currentTime = video.duration - 0.1; } catch (e) {}
      }
      if (video.paused) {
        const pl = video.play && video.play();
        if (pl && pl.catch) pl.catch(() => {});
        // それでも止まっているときは、YouTube のプレーヤーに再生を頼む
        try { if (typeof player.playVideo === 'function') player.playVideo(); } catch (e) {}
      }
      for (const b of player.querySelectorAll('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-container button, button[id^="skip-button"]')) {
        try { b.click(); } catch (e) {}
      }
    } else if (st.adOn) {
      // 広告が終わったら元に戻す
      st.adOn = false;
      if (st.saved > 0.5 && player.id === 'movie_player') console.log('[mb-stat] ad ' + Math.round(st.saved));
      if (video) {
        video.muted = st.wasMuted;
        try { video.playbackRate = st.oldRate || 1; } catch (e) {}
      }
    }
    for (const b of player.querySelectorAll('.ytp-ad-overlay-close-button')) { try { b.click(); } catch (e) {} }
  }
  function skip() {
    for (const player of document.querySelectorAll('.html5-video-player')) skipIn(player);
  }

  // YouTube のページはいつも中身が書き換わっているので、変化のたびに全体を調べると重くなる。
  // 広告カードの確認は「変化があったとき」に最大で 0.25 秒に1回だけ、動画広告の確認はプレーヤーだけを見る軽い処理にする
  let last = 0, timer = 0;
  const sweepNow = () => { timer = 0; last = Date.now(); try { sweep(); } catch (e) {} };
  const soon = () => {
    if (timer) return;
    timer = setTimeout(sweepNow, Math.max(0, 250 - (Date.now() - last)));
  };
  new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true });
  // 動画広告は始まったらすぐ飛ばしたいので、プレーヤーの状態だけを短い間隔で見る（裏のタブで音楽を流しているときも飛ばす）
  setInterval(() => { try { skip(); } catch (e) {} }, 250);
  // 広告が流れ始めた瞬間（長さが分かった瞬間）にもすぐ飛ばす
  for (const ev of ['playing', 'durationchange', 'loadedmetadata']) {
    document.addEventListener(ev, e => { if (e.target instanceof HTMLVideoElement) { try { skip(); } catch (x) {} } }, true);
  }
  sweepNow(); try { skip(); } catch (e) {}
})();`;


// 動画の中の「案件（スポンサー）」区間を飛ばす。区間のデータは SponsorBlock（みんなで登録している共有データ）から
// ブラウザ本体が取ってきて、window.__mbSponsor.set() で渡す
const SPONSOR_SCRIPT = `(() => {
  if (window.__mbSponsor) return;
  let vid = '', segs = [], lastSkip = 0;
  const idNow = () => { try { return new URL(location.href).searchParams.get('v') || ''; } catch (e) { return ''; } };
  const LABEL = { sponsor: '案件', selfpromo: '宣伝', interaction: 'チャンネル登録のお願い', intro: 'オープニング', outro: 'エンディング' };
  let toastEl = null, toastTimer = 0;
  function toast(text) {
    const player = document.getElementById('movie_player');
    if (!player) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:absolute;left:12px;bottom:64px;z-index:60;padding:7px 12px;border-radius:10px;background:rgba(17,17,17,.82);color:#fff;font:500 13px/1.3 system-ui,sans-serif;pointer-events:none;transition:opacity .25s;opacity:0';
    }
    if (toastEl.parentNode !== player) player.appendChild(toastEl);
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 2600);
  }
  function check() {
    if (!segs.length || vid !== idNow()) return;
    const player = document.getElementById('movie_player');
    if (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) return;
    const v = document.querySelector('#movie_player video.html5-main-video');
    if (!v || !Number.isFinite(v.currentTime)) return;
    const t = v.currentTime;
    for (const s of segs) {
      if (t >= s.start && t < s.end - 0.4 && Date.now() - lastSkip > 800) {
        lastSkip = Date.now();
        const len = Math.round(s.end - t);
        v.currentTime = s.end;
        toast((LABEL[s.category] || '案件') + 'の区間を飛ばしました（' + len + '秒）');
        console.log('[mb-stat] sponsor ' + len);
        return;
      }
    }
  }
  window.__mbSponsor = { set(id, list) { vid = id; segs = Array.isArray(list) ? list : []; check(); } };
  document.addEventListener('timeupdate', e => { if (e.target instanceof HTMLVideoElement) check(); }, true);
  setInterval(check, 500);
})();`;

// 調査用：動画が再生され始めるまでの時間を記録する（debug.flag があるときだけ入れる）
const PERF_SCRIPT = `(() => {
  if (window.__mbYtPerf) return;
  window.__mbYtPerf = true;
  let start = 0, done = false, adSeen = false;
  const reset = () => { start = performance.now(); done = false; adSeen = false; };
  document.addEventListener('yt-navigate-start', reset, true);
  document.addEventListener('playing', e => {
    const v = e.target;
    if (done || !(v instanceof HTMLVideoElement) || !v.classList.contains('html5-main-video')) return;
    const p = v.closest('.html5-video-player');
    if (!p || p.id !== 'movie_player') return;
    if (p.classList.contains('ad-showing')) {
      if (!adSeen) console.log('[mb-perf] ad-start ' + Math.round(performance.now() - start) + 'ms');
      adSeen = true; return;
    }
    done = true;
    console.log('[mb-perf] video-start ' + Math.round(performance.now() - start) + 'ms ad=' + adSeen + ' ' + location.pathname + location.search.slice(0, 20));
  }, true);
  setTimeout(() => { if (!done && /watch/.test(location.pathname)) console.log('[mb-perf] video-not-started-after-30s ad=' + adSeen); }, 30000);
})();`;

const isYouTube = url => {
  try { return /(^|\.)youtube\.com$/i.test(new URL(url).hostname); } catch { return false; }
};

const videoIdOf = url => {
  try { const u = new URL(url); return /(^|\.)youtube\.com$/i.test(u.hostname) && /^\/watch\/?$/.test(u.pathname) ? (u.searchParams.get('v') || '') : ''; } catch { return ''; }
};

module.exports = { SCRIPT, PERF_SCRIPT, SPONSOR_SCRIPT, isYouTube, videoIdOf };
