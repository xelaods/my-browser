// 自動アップデート（インストール版のみ。GitHub Releases に置いた新しいバージョンを確認する）
const { app } = require('electron');

function createUpdater(onStatus) {
  // 状態は文字ではなく i18n.js のキー（key）で持ち、表示するときに言語に合わせて訳す
  let status = { key: '', vars: null, ready: false, busy: false };
  const set = s => { status = { ...status, ...s }; onStatus(status); };

  if (!app.isPackaged) {
    status.key = 'upd.dev';
    return { check() { set({}); }, install() {}, status: () => status, start() {} };
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    status.key = 'upd.loadFailed';
    return { check() { set({}); }, install() {}, status: () => status, start() {} };
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // 次に終了したときに入れ替える
  autoUpdater.on('checking-for-update', () => set({ key: 'upd.checking', vars: null, busy: true }));
  autoUpdater.on('update-available', info => set({ key: 'upd.downloading', vars: { v: info.version }, busy: true }));
  autoUpdater.on('update-not-available', () => set({ key: 'upd.latest', vars: null, busy: false }));
  autoUpdater.on('download-progress', p => set({ key: 'upd.progress', vars: { p: Math.round(p.percent) }, busy: true }));
  autoUpdater.on('update-downloaded', info => set({ key: 'upd.ready', vars: { v: info.version }, ready: true, busy: false }));
  autoUpdater.on('error', e => {
    console.warn('アップデートの確認に失敗:', e?.message);
    set({ key: 'upd.error', vars: null, busy: false });
  });

  let timer = null;
  return {
    check() { autoUpdater.checkForUpdates().catch(() => {}); },
    install() { if (status.ready) autoUpdater.quitAndInstall(); },
    status: () => status,
    // 起動から少し待って確認し、そのあとは6時間ごと
    start(enabled) {
      clearInterval(timer);
      if (!enabled) return;
      setTimeout(() => this.check(), 15000);
      timer = setInterval(() => this.check(), 6 * 60 * 60 * 1000);
    },
  };
}

module.exports = { createUpdater };
