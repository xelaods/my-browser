// 2台のPCの設定をそろえる（OneDrive などのフォルダに1つのファイルを置いて、お互いに読み書きする）
// そろえるのは、お気に入り・ブックマーク・プロフィール・色・隠した部分・使いすぎ防止などの「設定」だけ。
// 開いているタブ・履歴・パスワードは、それぞれのPCに残す
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeJSONLater } = require('./store');

const FILE = 'my-browser-sync.json';
const KEYS = [
  'favorites', 'bookmarks', 'profiles', 'colors', 'theme', 'hideRules', 'limits', 'archiveAfter',
  'sponsorSkip', 'autoPip', 'searchEngine', 'sideButtons', 'adblock', 'adblockAllow', 'popupsAllow', 'gpc', 'httpsOnly',
];

// OneDrive のフォルダ（Windows では環境変数に入っている）
function defaultDir() {
  const od = process.env.OneDrive || process.env.OneDriveConsumer || process.env.OneDriveCommercial || '';
  return od ? path.join(od, 'My Browser') : '';
}

function createSync({ settings, onRemote, log = () => {} }) {
  let watching = '';
  let lastHash = '';   // 最後に書いた／読んだ内容（同じ内容を何度も書かないため）
  let lastSeen = 0;    // 最後に読んだファイルの更新時刻

  const fileOf = () => (settings().syncDir ? path.join(settings().syncDir, FILE) : '');
  const pick = s => { const o = {}; for (const k of KEYS) if (s[k] !== undefined) o[k] = s[k]; return o; };
  const hash = o => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex');

  // 設定を保存したときに呼ぶ：変わっていたら同期ファイルに書く
  function push() {
    const file = fileOf();
    if (!file) return;
    const data = pick(settings());
    const h = hash(data);
    if (h === lastHash) return;
    lastHash = h;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch {}
    writeJSONLater(file, { app: 'my-browser', version: 1, device: settings().deviceId, updatedAt: Date.now(), data });
  }

  // 同期ファイルが変わっていたら読み込む（ほかのPCが書いたものだけ）
  function pull() {
    const file = fileOf();
    if (!file) return;
    let st;
    try { st = fs.statSync(file); } catch { return; }
    if (st.mtimeMs <= lastSeen) return;
    lastSeen = st.mtimeMs;
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
    if (!doc || doc.app !== 'my-browser' || !doc.data || doc.device === settings().deviceId) return;
    const h = hash(pick(doc.data));
    if (h === lastHash) return;
    lastHash = h;
    log('[sync] apply from', doc.device);
    onRemote(pick(doc.data));
  }

  function start() {
    stop();
    const file = fileOf();
    if (!file) return;
    watching = file;
    // OneDrive は書き込みの通知が遅れることがあるので、定期的に見に行く
    fs.watchFile(file, { interval: 10000 }, () => pull());
    pull();
    // まだ一度も書いていなければ、今の設定を書いておく
    if (!fs.existsSync(file)) push();
  }
  function stop() {
    if (watching) { fs.unwatchFile(watching); watching = ''; }
  }
  return { start, stop, push, pull, defaultDir, fileOf };
}

module.exports = { createSync, defaultDir, KEYS };
