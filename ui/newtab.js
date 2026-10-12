// 入力は #q=... としてブラウザ本体に渡し、設定で選んだ検索エンジン（またはURL）で開いてもらう
const q = document.getElementById('q');
// シークレットタブなら説明を出す
if (new URLSearchParams(location.search).get('private') === '1') document.getElementById('private-note').hidden = false;
document.title = t(new URLSearchParams(location.search).get('private') === '1' ? 'common.privateTab' : 'common.newTab');
window.addEventListener('focus', () => q.focus());
document.getElementById('f').addEventListener('submit', e => {
  e.preventDefault();
  const text = q.value.trim();
  if (text) location.hash = 'q=' + encodeURIComponent(text);
});

// 今月ブロックした広告の数と、飛ばした広告・案件の時間（ブラウザ本体から届く）
window.mbStats = st => {
  if (new URLSearchParams(location.search).get('private') === '1') return;
  const el = document.getElementById('stats');
  const sec = (st.adSec || 0) + (st.sponsorSec || 0);
  if (!st.blocked && !sec) return;
  const fmt = n => Number(n).toLocaleString();
  const time = sec >= 3600 ? t('nt.hours', { h: (sec / 3600).toFixed(1) }) : t('nt.minutes', { m: Math.max(1, Math.round(sec / 60)) });
  el.innerHTML = '';
  const b = x => Object.assign(document.createElement('b'), { textContent: x });
  const parts = t('nt.stats', { n: '\u0001', time: '\u0002' }).split(/(\u0001|\u0002)/);
  for (const p of parts) el.append(p === '\u0001' ? b(fmt(st.blocked || 0)) : p === '\u0002' ? b(sec ? time : t('nt.minutes', { m: 0 })) : p);
  el.hidden = false;
};
