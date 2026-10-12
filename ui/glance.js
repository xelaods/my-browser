// リンクのプレビュー：背景（暗くした部分）と上の操作ボタン。ページ自体は main.js が上に重ねる
const $ = id => document.getElementById(id);
$('dim').addEventListener('mousedown', () => browser.glanceAction('close'));
$('close').onclick = () => browser.glanceAction('close');
$('tab').onclick = () => browser.glanceAction('tab');
$('split').onclick = () => browser.glanceAction('split');
window.addEventListener('keydown', e => { if (e.key === 'Escape') browser.glanceAction('close'); });

browser.onGlance(g => {
  document.body.classList.toggle('show', !!g && !!g.rect);
  if (!g || !g.rect) return;
  const r = g.rect;
  Object.assign($('frame').style, { left: r.x - 1 + 'px', top: r.y - 1 + 'px', width: r.width + 2 + 'px', height: r.height + 2 + 'px' });
  Object.assign($('bar').style, { left: r.x + 'px', top: r.y - 40 + 'px', width: r.width + 'px' });
  $('host').textContent = g.host || '';
  $('title').textContent = g.title && g.title !== g.host ? g.title : '';
  document.body.classList.toggle('loading', !!g.loading);
  document.body.classList.toggle('private', !!g.private);
  $('split').hidden = !g.canSplit;
});
