// JSONファイルの読み書き（書き込み中に落ちても壊れないよう、一時ファイルに書いてから置き換える）
const fs = require('fs');

const queue = new Map(); // file → { running, next, gen }
let slowHook = null; // 調査用：時間のかかった保存を知らせる
const onSlow = fn => { slowHook = fn; };

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// すぐに書く（終了するときなど、待ってでも確実に保存したいとき）
function writeJSON(file, data) {
  const t = Date.now();
  // 裏で書いている途中の古い内容が、あとから上書きしないようにする
  const q = queue.get(file);
  if (q) { q.next = null; q.gen++; }
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error('保存に失敗しました:', file, e.message);
  }
  if (slowHook && Date.now() - t > 30) slowHook('sync', file, Date.now() - t);
}

// 裏で書く（ページの表示を止めないよう、ディスクへの書き込みを待たない）
// 同じファイルへの書き込みは順番に行い、待っている間に来た分は最新の1回にまとめる
function writeJSONLater(file, data) {
  const t = Date.now();
  let text;
  try { text = JSON.stringify(data); } catch (e) { return; }
  const q = queue.get(file) || { running: false, next: null, gen: 0 };
  queue.set(file, q);
  q.next = text;
  if (slowHook && Date.now() - t > 30) slowHook('stringify', file, Date.now() - t);
  if (q.running) return;
  const run = async () => {
    q.running = true;
    while (q.next != null) {
      const body = q.next;
      const gen = q.gen;
      q.next = null;
      const tmp = file + '.bg.tmp';
      try {
        await fs.promises.writeFile(tmp, body);
        if (gen === q.gen) await fs.promises.rename(tmp, file);
        else await fs.promises.unlink(tmp).catch(() => {});
      } catch (e) {
        console.error('保存に失敗しました:', file, e.message);
      }
    }
    q.running = false;
  };
  run();
}

module.exports = { readJSON, writeJSON, writeJSONLater, onSlow };
