// 使いすぎ防止：1日の上限を超えたサイトの代わりに出す画面
// ボタンの結果は #more / #close としてブラウザ本体に伝える
const q = new URLSearchParams(location.search);
const site = q.get('site') || '';
const mins = Number(q.get('mins')) || 0;
document.title = t('limit.tabTitle');
document.getElementById('title').textContent = t('limit.title', { site });
document.getElementById('text').textContent = t('limit.text', { m: mins });
document.getElementById('more').textContent = t('limit.more');
document.getElementById('close').textContent = t('limit.close');
document.getElementById('more').onclick = () => { location.hash = 'more'; };
document.getElementById('close').onclick = () => { location.hash = 'close'; };
