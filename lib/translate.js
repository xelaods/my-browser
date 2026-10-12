// ページの翻訳：ページの文字を集めて翻訳サービスに送り、訳文に置き換える（元に戻せる）
// 標準は Google 翻訳（キー不要）。DeepL のAPIキーを設定すると DeepL を使う
const { session } = require('electron');

// 翻訳の通信はCookieを持たない専用のセッションで行う（ログイン情報などを送らないため）
let ses = null;
const S = () => ses || (ses = session.fromPartition('mb-translate'));

const BATCH_CHARS = 1800; // Google に1回で送る文字数の目安（URLの長さの上限を超えないように）
const PARALLEL = 3;

async function fetchJSON(url, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await S().fetch(url, { ...opts, signal: ctl.signal, credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

// ---- Google 翻訳 ----
async function googleOne(text, target) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl='
    + encodeURIComponent(target) + '&q=' + encodeURIComponent(text);
  const j = await fetchJSON(url);
  const out = Array.isArray(j?.[0]) ? j[0].map(seg => (Array.isArray(seg) ? seg[0] || '' : '')).join('') : '';
  return { text: out, lang: typeof j?.[2] === 'string' ? j[2] : '' };
}

async function google(texts, target) {
  // 改行でつないでまとめて送り、戻ってきた訳を改行で分ける。数が合わなければ1つずつ送り直す
  const batches = [];
  let cur = [];
  let len = 0;
  for (let i = 0; i < texts.length; i++) {
    const n = texts[i].length + 1;
    if (cur.length && len + n > BATCH_CHARS) { batches.push(cur); cur = []; len = 0; }
    cur.push(i);
    len += n;
  }
  if (cur.length) batches.push(cur);

  const out = new Array(texts.length);
  let lang = '';
  const runBatch = async idx => {
    const joined = idx.map(i => texts[i]).join('\n');
    try {
      const r = await googleOne(joined, target);
      lang ||= r.lang;
      const parts = r.text.split('\n');
      if (parts.length === idx.length) { idx.forEach((i, k) => { out[i] = parts[k]; }); return; }
    } catch (e) {
      if (idx.length === 1) throw e;
    }
    for (const i of idx) {
      const r = await googleOne(texts[i], target);
      lang ||= r.lang;
      out[i] = r.text;
    }
  };
  await pool(batches, PARALLEL, runBatch);
  return { texts: out, lang };
}

// ---- DeepL ----
async function deepl(texts, target, key) {
  const host = /:fx$/.test(key) ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const out = [];
  let lang = '';
  for (let i = 0; i < texts.length; i += 50) {
    const j = await fetchJSON(host + '/v2/translate', {
      method: 'POST',
      headers: { 'Authorization': 'DeepL-Auth-Key ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texts.slice(i, i + 50), target_lang: target.toUpperCase() === 'EN' ? 'EN-US' : target.toUpperCase() }),
    });
    for (const tr of j.translations || []) { out.push(tr.text); lang ||= (tr.detected_source_language || '').toLowerCase(); }
  }
  return { texts: out, lang };
}

async function pool(items, n, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

async function translate(texts, target, { engine = 'google', deeplKey = '' } = {}) {
  if (!texts.length) return { texts: [], lang: '' };
  if (engine === 'deepl' && deeplKey) return deepl(texts, target, deeplKey);
  return google(texts, target);
}

// ---- ページの中で動かすスクリプト（ページのスクリプトから見えない別の実行環境で動かす） ----
const WORLD = 1003;
const PAGE_SCRIPT = `(() => {
  if (window.__mbtr) return true;
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|CODE|PRE|TEXTAREA|INPUT|SELECT|OPTION|SVG|MATH|KBD|SAMP|VAR|TEMPLATE|IFRAME|CANVAS|HEAD|TITLE)$/;
  const st = { nodes: [], orig: [], applied: new WeakMap(), pending: new Set(), obs: null, chars: 0 };
  const okEl = el => {
    for (let e = el, d = 0; e && d < 40; e = e.parentElement, d++) {
      if (SKIP.test(e.tagName)) return false;
      if (e.getAttribute && (e.getAttribute('translate') === 'no' || e.isContentEditable)) return false;
      if (e.classList && e.classList.contains('notranslate')) return false;
    }
    return true;
  };
  const want = n => {
    const v = n.nodeValue;
    return v && /\\p{L}/u.test(v) && v.trim().length > 0 && !st.applied.has(n) && okEl(n.parentElement);
  };
  const walk = (root, out) => {
    if (!root) return;
    if (root.nodeType === 3) { if (want(root)) out.push(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n && out.length < 4000; n = w.nextNode()) if (want(n)) out.push(n);
  };
  window.__mbtr = {
    collect(all) {
      const list = [];
      if (all) walk(document.body, list);
      else { for (const r of st.pending) { if (r.isConnected) walk(r, list); } st.pending.clear(); }
      const uniq = [...new Set(list)];
      const start = st.nodes.length;
      const texts = [];
      for (const n of uniq) {
        if (st.chars > 200000) break;
        const v = n.nodeValue;
        st.nodes.push(n);
        st.orig.push(v);
        st.chars += v.length;
        texts.push(v.replace(/\\s+/g, ' ').trim());
      }
      if (!st.obs) {
        st.obs = new MutationObserver(ms => {
          for (const m of ms) {
            if (m.type === 'characterData') { if (st.applied.get(m.target) !== m.target.nodeValue) { st.applied.delete(m.target); st.pending.add(m.target); } }
            else for (const a of m.addedNodes) st.pending.add(a);
          }
        });
        st.obs.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
      return { start, texts };
    },
    apply(start, out) {
      for (let i = 0; i < out.length; i++) {
        const n = st.nodes[start + i];
        const o = st.orig[start + i];
        if (!n || typeof out[i] !== 'string' || !out[i]) continue;
        if (n.nodeValue !== o) continue; // 翻訳中にページが書き換えた
        const lead = o.match(/^\\s*/)[0];
        const trail = o.match(/\\s*$/)[0];
        const v = lead + out[i] + trail;
        n.nodeValue = v;
        st.applied.set(n, v);
      }
      return true;
    },
    restore() {
      if (st.obs) st.obs.disconnect();
      for (let i = 0; i < st.nodes.length; i++) {
        const n = st.nodes[i];
        if (n && st.applied.get(n) === n.nodeValue) n.nodeValue = st.orig[i];
      }
      delete window.__mbtr;
      return true;
    },
  };
  return true;
})()`;

// ページの言語（<html lang> と本文の文字の種類から推測）
const DETECT_SCRIPT = `(() => {
  const l = (document.documentElement.lang || '').toLowerCase().split(/[-_]/)[0];
  const s = ((document.body && document.body.innerText) || '').slice(0, 4000);
  const count = re => (s.match(re) || []).length;
  return { l, ja: count(/[\\u3040-\\u30ff]/g), han: count(/[\\u4e00-\\u9fff]/g), latin: count(/[A-Za-z]/g), letters: count(/\\p{L}/gu) };
})()`;

function guessLang(d) {
  if (!d || d.letters < 40) return d?.l || '';
  const kana = d.ja / d.letters;
  const han = d.han / d.letters;
  const latin = d.latin / d.letters;
  if (kana > 0.05) return 'ja';
  if (d.l && d.l !== 'en') return d.l;
  if (han > 0.3) return 'zh';
  if (latin > 0.6) return d.l || 'en';
  return d.l || 'und';
}

module.exports = { translate, WORLD, PAGE_SCRIPT, DETECT_SCRIPT, guessLang };
