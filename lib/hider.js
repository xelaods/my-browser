// クリックでページの一部を隠す（ArcのBoostのような機能）
// 右クリック →「この部分を隠す」→ 隠したい部分をクリック。サイトごとに覚えて、次からも隠す

// ページの上で、マウスの下の部分を枠で囲み、クリックした部分の CSS セレクターを返す（Esc でやめる）
// ページの JavaScript に邪魔されないよう、別の実行環境（isolated world）で動かす
const PICKER = (labels) => `new Promise(resolve => {
  if (window.__mbPicking) return resolve(null);
  window.__mbPicking = true;
  const L = ${JSON.stringify(labels)};
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #7c3aed;background:rgba(124,58,237,.12);border-radius:4px;transition:all .06s;';
  const tip = document.createElement('div');
  tip.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:14px;transform:translateX(-50%);padding:8px 14px;border-radius:999px;background:#111;color:#fff;font:500 13px/1.3 system-ui,sans-serif;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.25)';
  tip.textContent = L.hint;
  document.documentElement.append(box, tip);
  let cur = null;
  // あまりに小さい部分・大きすぎる部分（ページ全体）は選ばない
  const pick = el => {
    while (el && el !== document.body && el !== document.documentElement) {
      const r = el.getBoundingClientRect();
      if (r.width * r.height > 400 && !(r.width >= innerWidth * .98 && r.height >= innerHeight * .9)) return el;
      el = el.parentElement;
    }
    return null;
  };
  const move = e => {
    const el = pick(document.elementFromPoint(e.clientX, e.clientY));
    cur = el;
    if (!el) { box.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  };
  // 自動で付けられたような名前（数字が多い・長すぎる）は使わない
  const stable = c => c && c.length < 40 && !/\\d{3,}|[_-][a-z0-9]{6,}$|^(css|sc|jsx|emotion)-/i.test(c) && !/^(active|hover|focus|selected|is-|has-)/.test(c);
  const part = el => {
    const tag = el.tagName.toLowerCase();
    if (el.id && stable(el.id) && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    const cls = [...el.classList].filter(stable).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
    return tag + cls;
  };
  const selectorOf = el => {
    // 部品の名前（カスタム要素）やクラスで決まるならそれだけ（同じ種類の部分をまとめて隠せる）
    let sel = part(el);
    if ((el.tagName.includes('-') || sel.includes('.') || sel.startsWith('#')) && document.querySelectorAll(sel).length <= 30) return sel;
    // そうでなければ親をたどって絞り込む
    let node = el, chain = [sel];
    for (let i = 0; i < 4 && node.parentElement && node.parentElement !== document.body; i++) {
      node = node.parentElement;
      chain.unshift(part(node));
      const s = chain.join(' > ');
      if (document.querySelectorAll(s).length === 1) return s;
    }
    // 最後の手段：兄弟の中の何番目か
    const idx = [...el.parentElement.children].filter(c => c.tagName === el.tagName).indexOf(el) + 1;
    return chain.join(' > ') + ':nth-of-type(' + idx + ')';
  };
  const stop = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  const done = val => {
    window.__mbPicking = false;
    box.remove(); tip.remove();
    removeEventListener('mousemove', move, true);
    removeEventListener('click', click, true);
    removeEventListener('mousedown', stop, true);
    removeEventListener('mouseup', stop, true);
    removeEventListener('keydown', key, true);
    resolve(val);
  };
  const click = e => {
    stop(e);
    if (!cur) return done(null);
    const sel = selectorOf(cur);
    try { document.querySelectorAll(sel).forEach(x => x.style.setProperty('display', 'none', 'important')); } catch (err) { return done(null); }
    done(sel);
  };
  const key = e => { if (e.key === 'Escape') { stop(e); done(null); } };
  addEventListener('mousemove', move, true);
  addEventListener('click', click, true);
  addEventListener('mousedown', stop, true);
  addEventListener('mouseup', stop, true);
  addEventListener('keydown', key, true);
})`;

// サイトの名前（www. は取る）
const siteOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

const cssFor = list => (list || []).filter(s => typeof s === 'string' && s.length < 400 && !/[{}]/.test(s))
  .map(s => `${s} { display: none !important; }`).join('\n');

module.exports = { PICKER, siteOf, cssFor };
