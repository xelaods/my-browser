// 閲覧履歴（このPCの中だけに保存。シークレットタブは記録しない）
const { readJSON, writeJSON, writeJSONLater } = require('./store');

const MAX_ITEMS = 5000;
const DAY = 24 * 60 * 60 * 1000;

class History {
  constructor(file) {
    this.file = file;
    this.map = new Map();
    const saved = readJSON(file, []);
    if (Array.isArray(saved)) {
      for (const it of saved) if (it && typeof it.url === 'string') this.map.set(it.url, it);
    }
    this.timer = null;
  }

  // ページを開いたとき
  visit(url, title) {
    if (!/^https?:\/\//i.test(url)) return;
    const it = this.map.get(url) || { url, title: '', n: 0, t: 0 };
    it.n += 1;
    it.t = Date.now();
    if (title) it.title = String(title).slice(0, 300);
    this.map.delete(url); // 新しい順に並ぶよう入れ直す
    this.map.set(url, it);
    this.trim();
    this.saveSoon();
  }

  // タイトルが後から分かったとき
  setTitle(url, title) {
    const it = this.map.get(url);
    if (!it || !title || it.title === title) return;
    it.title = String(title).slice(0, 300);
    this.saveSoon();
  }

  trim() {
    if (this.map.size <= MAX_ITEMS) return;
    const extra = this.map.size - MAX_ITEMS;
    let i = 0;
    for (const key of this.map.keys()) { if (i++ >= extra) break; this.map.delete(key); }
  }

  // 設定画面用：新しい順（検索語があれば絞り込み）
  list(query = '', limit = 100) {
    const terms = splitTerms(query);
    const out = [];
    const all = [...this.map.values()].sort((a, b) => b.t - a.t);
    for (const it of all) {
      if (terms.length && !matches(it, terms)) continue;
      out.push(it);
      if (out.length >= limit) break;
    }
    return out;
  }

  // URL欄の候補：よく見る・最近見たページを上に
  suggest(query, limit = 6) {
    const terms = splitTerms(query);
    if (!terms.length) return [];
    const now = Date.now();
    const q = terms[0];
    const scored = [];
    for (const it of this.map.values()) {
      if (!matches(it, terms)) continue;
      let score = Math.min(it.n, 20) * 2;
      if (now - it.t < DAY) score += 12; else if (now - it.t < 7 * DAY) score += 6;
      const host = hostOf(it.url);
      if (host.startsWith(q) || host.replace(/^www\./, '').startsWith(q)) score += 30;
      scored.push([score, it]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, limit).map(([, it]) => it);
  }

  // ほかのブラウザの履歴を取り込む（すでにあるページは、新しい方の日時と多い方の回数にする）
  importItems(items) {
    let added = 0;
    for (const it of items) {
      if (!it || !/^https?:\/\//i.test(it.url)) continue;
      const had = this.map.get(it.url);
      if (had) {
        had.n = Math.max(had.n, it.n || 1);
        if (it.t > had.t) had.t = it.t;
        if (!had.title && it.title) had.title = it.title;
      } else {
        this.map.set(it.url, { url: it.url, title: it.title || '', n: it.n || 1, t: it.t || Date.now() });
        added++;
      }
    }
    // 古い順に入れ直す（Map の順番＝新しさ）
    this.map = new Map([...this.map.values()].sort((a, b) => a.t - b.t).map(it => [it.url, it]));
    this.trim();
    this.saveNow();
    return added;
  }

  remove(url) {
    if (this.map.delete(url)) this.saveSoon();
  }

  // since: この時刻より後に見たものを消す（0なら全部）
  clear(since = 0) {
    if (!since) this.map.clear();
    else for (const [url, it] of this.map) if (it.t >= since) this.map.delete(url);
    this.saveNow();
  }

  saveSoon() {
    clearTimeout(this.timer);
    // ページを見ている間は裏で保存する（表示を止めない）
    this.timer = setTimeout(() => { this.timer = null; writeJSONLater(this.file, [...this.map.values()]); }, 2000);
  }

  saveNow() {
    clearTimeout(this.timer);
    writeJSON(this.file, [...this.map.values()]);
  }
}

function splitTerms(q) {
  return String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
}
function matches(it, terms) {
  const hay = (it.url + ' ' + (it.title || '')).toLowerCase();
  return terms.every(t => hay.includes(t));
}
function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

module.exports = { History };
