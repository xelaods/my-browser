// ダウンロードの管理（保存先の決定・危険なファイルの確認・進み具合の表示）
const fs = require('fs');
const path = require('path');
const { app, dialog, shell } = require('electron');

// 開くとプログラムが動くので、保存前に確認する種類
const DANGEROUS = new Set([
  'exe', 'msi', 'msix', 'appx', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'ps1', 'psm1', 'vbs', 'vbe',
  'js', 'jse', 'wsf', 'wsh', 'hta', 'jar', 'lnk', 'reg', 'dll', 'msc', 'iso', 'img', 'vhd', 'vhdx',
  'application', 'appref-ms', 'sh', 'command', 'dmg', 'pkg', 'app', 'deb', 'rpm', 'apk',
  // 開いただけで外部に接続したり、設定を書き換えたりできるもの
  'url', 'scf', 'library-ms', 'searchconnector-ms', 'settingcontent-ms', 'appinstaller', 'chm', 'msp', 'mst',
  'inf', 'xll', 'xlam', 'docm', 'dotm', 'xlsm', 'xltm', 'pptm', 'potm', 'ppsm', 'sldm', 'ws', 'wsc', 'gadget', 'diagcab',
]);

function createDownloads(ctx) {
  // ctx: { settings(), window(), onChange(list), onDone(item), isPrivate(session), userInitiated(webContents), t(key, vars) }
  const items = []; // 新しい順
  let seq = 1;
  let timer = null;

  const S = () => ctx.settings();
  const dir = () => {
    const d = S().downloadDir;
    if (d && fs.existsSync(d)) return d;
    const def = app.getPath('downloads');
    try { fs.mkdirSync(def, { recursive: true }); } catch {}
    return def;
  };

  // 同じ名前があれば「名前 (1).zip」のように番号を付ける
  function uniquePath(folder, name) {
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    let p = path.join(folder, name);
    for (let i = 1; fs.existsSync(p) || fs.existsSync(p + '.crdownload'); i++) p = path.join(folder, `${base} (${i})${ext}`);
    return p;
  }

  function safeName(name) {
    // Windowsで使えない文字や、フォルダをさかのぼる名前を取り除く
    const n = String(name || 'download').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim();
    return n.slice(0, 180) || 'download';
  }

  function snapshot(d) {
    const it = d.item;
    return {
      id: d.id, name: d.name, url: d.url, path: d.path, state: d.state,
      received: d.state === 'progressing' || d.state === 'paused' ? it.getReceivedBytes() : d.received,
      total: d.total, paused: d.state === 'paused', danger: d.danger, private: d.private,
    };
  }

  function emit() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; ctx.onChange(list()); }, 200);
  }

  function list() { return items.map(snapshot); }

  function handle(event, item, wc) {
    const name = safeName(item.getFilename());
    const ext = path.extname(name).slice(1).toLowerCase();
    const d = {
      id: 'd' + seq++, item, name, url: item.getURL(), path: '', state: 'progressing',
      received: 0, total: item.getTotalBytes(), danger: DANGEROUS.has(ext),
      private: ctx.isPrivate(wc?.session), started: Date.now(),
    };

    if (S().askDownload) {
      // 保存先をたずねる（Electron標準の保存ダイアログ）
      item.setSaveDialogOptions({ title: ctx.t('dl.saveAs'), defaultPath: path.join(dir(), name) });
    } else {
      item.setSavePath(uniquePath(dir(), name));
    }
    items.unshift(d);
    if (items.length > 100) items.length = 100;

    // プログラムなど危険な種類や、クリックなしで始まったダウンロードは、保存を続けるか確認する
    const auto = !ctx.userInitiated(wc);
    if (d.danger || auto) {
      item.pause();
      d.state = 'paused';
      dialog.showMessageBox(ctx.window(), {
        type: 'warning',
        buttons: [ctx.t('dl.save'), ctx.t('common.cancel')],
        defaultId: 1, cancelId: 1,
        title: ctx.t('dl.confirmTitle'),
        message: d.danger
          ? ctx.t('dl.dangerMessage', { name })
          : ctx.t('dl.autoMessage', { host: hostOf(d.url), name }),
        detail: ctx.t('dl.confirmDetail', { host: hostOf(d.url) }),
      }).then(({ response }) => {
        if (response === 0) { item.resume(); d.state = 'progressing'; } else item.cancel();
        emit();
      });
    }

    item.on('updated', (_, state) => {
      d.path = item.getSavePath();
      d.total = item.getTotalBytes();
      if (state === 'interrupted') d.state = 'interrupted';
      else if (d.state !== 'cancelled') d.state = item.isPaused() ? 'paused' : 'progressing';
      emit();
    });
    item.once('done', (_, state) => {
      d.path = item.getSavePath();
      d.received = item.getReceivedBytes();
      d.total = item.getTotalBytes() || d.received;
      d.state = state; // completed | cancelled | interrupted
      if (state === 'completed') markFromInternet(d);
      emit();
      if (state === 'completed') ctx.onDone(snapshot(d));
    });
    emit();
  }

  // Windows: 「インターネットから来たファイル」の印（Mark of the Web）を付ける。
  // 開くときに SmartScreen や Office の保護ビューが働くようになる
  function markFromInternet(d) {
    if (process.platform !== 'win32' || !d.path) return;
    try {
      const safe = u => String(u || '').replace(/[\r\n]/g, '');
      fs.writeFileSync(d.path + ':Zone.Identifier', `[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=${safe(d.url)}\r\n`);
    } catch {}
  }

  function find(id) { return items.find(d => d.id === id); }

  function action(id, what) {
    const d = find(id);
    if (!d) return;
    if (what === 'open' && d.state === 'completed') {
      if (d.danger) {
        // 実行ファイルは開く前にもう一度確認する
        const r = dialog.showMessageBoxSync(ctx.window(), {
          type: 'warning', buttons: [ctx.t('common.open'), ctx.t('common.cancel')], defaultId: 1, cancelId: 1,
          message: ctx.t('dl.openDangerMessage', { name: d.name }), detail: ctx.t('dl.openDangerDetail'),
        });
        if (r !== 0) return;
      }
      shell.openPath(d.path);
    }
    if (what === 'show' && d.path) shell.showItemInFolder(d.path);
    if (what === 'cancel' && /progressing|paused/.test(d.state)) d.item.cancel();
    if (what === 'pause' && d.state === 'progressing') d.item.pause();
    if (what === 'resume' && d.item.canResume()) d.item.resume();
    if (what === 'remove' && !/progressing|paused/.test(d.state)) items.splice(items.indexOf(d), 1);
    emit();
  }

  function clearFinished() {
    for (let i = items.length - 1; i >= 0; i--) if (!/progressing|paused/.test(items[i].state)) items.splice(i, 1);
    emit();
  }

  function activeCount() { return items.filter(d => /progressing|paused/.test(d.state)).length; }

  function openFolder() { shell.openPath(dir()); }

  return { handle, list, action, clearFinished, activeCount, openFolder, dir };
}

function hostOf(url) {
  try { return new URL(url).hostname || url; } catch { return url; }
}

module.exports = { createDownloads, DANGEROUS };
