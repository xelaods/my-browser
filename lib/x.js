// X（旧Twitter）の広告対策：タイムラインなどの「プロモーション」投稿を隠す
// ブラウザ側（main.js）からページに入れる保険。広告そのものはページ側（page-preload.js）で
// タイムラインのデータから取り除いている

const SCRIPT = `(() => {
  if (window.__mbXGuard) return;
  window.__mbXGuard = true;
  // 「プロモーション」の表示（言語ごと）
  const LABELS = new Set(['プロモーション', 'Promoted', 'Ad', '広告', 'Gesponsert', 'Sponsorisé', 'Promocionado', 'Promovido', '프로모션', '推廣', '推广']);
  const hide = el => { if (el && el.style.getPropertyValue('display') !== 'none') el.style.setProperty('display', 'none', 'important'); };
  const cellOf = el => el.closest('[data-testid="cellInnerDiv"]') || el.closest('article') || el;
  function isAdArticle(article) {
    if (article.querySelector('[data-testid="placementTracking"]')) return true;
    // 投稿の上部（名前の行）にある小さなラベルだけを見る（本文に「広告」と書かれた投稿は隠さない）
    for (const span of article.querySelectorAll('span')) {
      const t = span.textContent;
      if (!t || t.length > 12 || !LABELS.has(t.trim())) continue;
      if (span.closest('[data-testid="tweetText"]')) continue;
      if (span.children.length) continue;
      return true;
    }
    return false;
  }
  function sweep() {
    for (const el of document.querySelectorAll('[data-testid="placementTracking"]')) hide(cellOf(el));
    for (const a of document.querySelectorAll('article:not([data-mb-checked])')) {
      if (isAdArticle(a)) hide(cellOf(a));
      else if (a.querySelector('[data-testid="User-Name"]')) a.setAttribute('data-mb-checked', '1');
    }
    // 「おすすめユーザー」などに混ざる広告アカウント、サイドバーのプロモーション
    for (const el of document.querySelectorAll('[data-testid="UserCell"], [data-testid="trend"]')) {
      for (const span of el.querySelectorAll('span')) {
        if (!span.children.length && LABELS.has((span.textContent || '').trim())) { hide(cellOf(el)); break; }
      }
    }
  }
  // 変化があったときだけ、最大で 0.15 秒に1回調べる（スクロール中に重くならないように）
  let last = 0, timer = 0;
  const run = () => { timer = 0; last = Date.now(); try { sweep(); } catch (e) {} };
  new MutationObserver(() => { if (!timer) timer = setTimeout(run, Math.max(0, 150 - (Date.now() - last))); })
    .observe(document.documentElement, { childList: true, subtree: true });
  run();
})();`;

const isX = url => {
  try { return /(^|\.)(x\.com|twitter\.com)$/i.test(new URL(url).hostname); } catch { return false; }
};

module.exports = { SCRIPT, isX };
