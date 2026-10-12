// 広告ブロックのリストからエンジンを作る（別プロセスで動かす）
// リストの読み込みには数秒かかるので、ブラウザ本体で行うとその間すべてのページが止まってしまう。
// ここで作って、保存用の形（バイナリ）にしてから本体に返す
const { FiltersEngine } = require('@ghostery/adblocker');

process.parentPort.on('message', e => {
  const { texts, extra, resources } = e.data || {};
  try {
    const engine = FiltersEngine.parse((texts || []).join('\n') + '\n' + (extra || ''), { loadCosmeticFilters: true, loadNetworkFilters: true });
    if (resources) {
      try { engine.updateResources(resources, '' + resources.length); } catch {}
    }
    const bin = engine.serialize();
    process.parentPort.postMessage({ ok: true, bin });
  } catch (err) {
    process.parentPort.postMessage({ ok: false, error: String(err && err.message || err) });
  }
});
