// ほかのブラウザ（Chrome・Edge・Brave・Vivaldi）からブックマークと履歴を読み込む
// パスワードは各ブラウザが暗号化しているので、ブラウザの「エクスポート」で書き出したCSVから読み込む
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME_EPOCH_OFFSET = 11644473600000; // 1601-01-01 から 1970-01-01 までのミリ秒

function browserRoots() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      ['chrome', 'Google Chrome', path.join(local, 'Google', 'Chrome', 'User Data')],
      ['edge', 'Microsoft Edge', path.join(local, 'Microsoft', 'Edge', 'User Data')],
      ['brave', 'Brave', path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')],
      ['vivaldi', 'Vivaldi', path.join(local, 'Vivaldi', 'User Data')],
    ];
  }
  if (process.platform === 'darwin') {
    const sup = path.join(home, 'Library', 'Application Support');
    return [
      ['chrome', 'Google Chrome', path.join(sup, 'Google', 'Chrome')],
      ['edge', 'Microsoft Edge', path.join(sup, 'Microsoft Edge')],
      ['brave', 'Brave', path.join(sup, 'BraveSoftware', 'Brave-Browser')],
      ['vivaldi', 'Vivaldi', path.join(sup, 'Vivaldi')],
    ];
  }
  const cfg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [
    ['chrome', 'Google Chrome', path.join(cfg, 'google-chrome')],
    ['chromium', 'Chromium', path.join(cfg, 'chromium')],
    ['edge', 'Microsoft Edge', path.join(cfg, 'microsoft-edge')],
    ['brave', 'Brave', path.join(cfg, 'BraveSoftware', 'Brave-Browser')],
    ['vivaldi', 'Vivaldi', path.join(cfg, 'vivaldi')],
  ];
}

// 読み込めるブラウザとプロフィールの一覧
function detect() {
  const out = [];
  for (const [key, label, root] of browserRoots()) {
    if (!fs.existsSync(root)) continue;
    let names = {};
    try { names = JSON.parse(fs.readFileSync(path.join(root, 'Local State'), 'utf8')).profile?.info_cache || {}; } catch {}
    let dirs = Object.keys(names);
    if (!dirs.length) {
      try { dirs = fs.readdirSync(root).filter(d => d === 'Default' || /^Profile \d+$/.test(d)); } catch {}
    }
    for (const d of dirs) {
      const dir = path.join(root, d);
      const bookmarks = fs.existsSync(path.join(dir, 'Bookmarks'));
      const history = fs.existsSync(path.join(dir, 'History'));
      if (!bookmarks && !history) continue;
      out.push({ id: key + ':' + d, browser: label, profile: names[d]?.name || d, dir, bookmarks, history });
    }
  }
  return out;
}

// ブックマーク（Bookmarks ファイルは JSON）
function readBookmarks(dir) {
  let json;
  try { json = JSON.parse(fs.readFileSync(path.join(dir, 'Bookmarks'), 'utf8')); } catch { return []; }
  const out = [];
  const walk = (node, folder, bar, depth) => {
    if (!node || depth > 30) return;
    if (node.type === 'url' && /^https?:/i.test(node.url || '')) {
      out.push({ url: node.url, title: String(node.name || '').slice(0, 300), folder, bar: bar && depth === 1 });
    }
    for (const c of node.children || []) walk(c, node.type === 'folder' && depth > 0 ? (folder ? folder + ' / ' : '') + node.name : folder, bar, depth + 1);
  };
  const roots = json.roots || {};
  walk(roots.bookmark_bar, '', true, 0);
  walk(roots.other, '', false, 0);
  walk(roots.synced, '', false, 0);
  return out;
}

// 履歴（History ファイルは SQLite。ブラウザが開いていると使用中なので、コピーしてから読む）
function readHistory(dir, limit = 5000) {
  const src = path.join(dir, 'History');
  const tmp = path.join(os.tmpdir(), `mb-import-${process.pid}-${Date.now()}.sqlite`);
  try {
    fs.copyFileSync(src, tmp);
  } catch (e) {
    return { error: 'locked', items: [] };
  }
  let db;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(tmp, { readOnly: true });
    const rows = db.prepare(
      // last_visit_time はマイクロ秒で JavaScript の数に収まらないので、SQLの中でミリ秒にする
      'SELECT url, title, visit_count, (last_visit_time / 1000) AS ms FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?',
    ).all(limit);
    const items = rows
      .filter(r => /^https?:/i.test(r.url))
      .map(r => ({
        url: String(r.url),
        title: String(r.title || '').slice(0, 300),
        n: Math.max(1, Number(r.visit_count) || 1),
        t: Math.round(Number(r.ms) - CHROME_EPOCH_OFFSET),
      }))
      .filter(r => r.t > 0 && r.t <= Date.now() + 86400000);
    return { items };
  } catch (e) {
    return { error: 'read', items: [] };
  } finally {
    try { db?.close(); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
  }
}

module.exports = { detect, readBookmarks, readHistory };
