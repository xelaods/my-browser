// Chrome拡張機能（Chromeウェブストアから追加・ツールバーのボタン・ポップアップ）
// electron-chrome-web-store（MIT）と electron-chrome-extensions（GPL-3.0）を使う
const path = require('path');
const { session, dialog } = require('electron');

function createExtensions(ctx) {
  // ctx: { window(), openTab(url, active) => webContents, selectWc(wc), closeWc(wc), onChange(), t(key, vars) }
  let ext = null;
  let store = null;
  let error = '';
  let ready = false;
  const ses = () => session.defaultSession;

  // ウェブストアの「Chromeに追加」を押したときに、追加してよいか確認する
  async function confirmInstall(details) {
    const perms = [...(details.manifest.permissions || []), ...(details.manifest.host_permissions || [])]
      .filter(p => typeof p === 'string').slice(0, 12);
    const { response } = await dialog.showMessageBox(ctx.window(), {
      type: 'question',
      buttons: [ctx.t('ext.add'), ctx.t('common.cancel')],
      defaultId: 1, cancelId: 1,
      title: ctx.t('ext.addTitle'),
      message: ctx.t('ext.addMessage', { name: details.localizedName }),
      detail: (perms.length ? ctx.t('ext.permissions') + '\n・' + perms.join('\n・') + '\n\n' : '') + ctx.t('ext.addNote'),
      icon: details.icon && !details.icon.isEmpty() ? details.icon : undefined,
    });
    return { action: response === 0 ? 'allow' : 'deny' };
  }

  async function init() {
    try {
      const { ElectronChromeExtensions } = require('electron-chrome-extensions');
      store = require('electron-chrome-web-store');
      ext = new ElectronChromeExtensions({
        // このライブラリは GPL-3.0 か有償ライセンスで使う。GPL-3.0 で配布する場合はソースの公開が必要
        license: 'GPL-3.0',
        session: ses(),
        createTab: async details => [ctx.openTab(details.url, details.active !== false), ctx.window()],
        selectTab: wc => ctx.selectWc(wc),
        removeTab: wc => ctx.closeWc(wc),
        createWindow: async details => {
          const url = Array.isArray(details.url) ? details.url[0] : details.url;
          ctx.openTab(url, true);
          return ctx.window();
        },
        removeWindow: () => {},
      });
      ElectronChromeExtensions.handleCRXProtocol(ses());
      ext.on('browser-action-popup-created', popup => fixPopupSize(popup));
      await store.installChromeWebStore({
        session: ses(),
        extensionsPath: path.join(require('electron').app.getPath('userData'), 'Extensions'),
        beforeInstall: confirmInstall,
        autoUpdate: true,
      });
      const api = ses().extensions || ses();
      api.on('extension-loaded', () => ctx.onChange());
      api.on('extension-unloaded', () => ctx.onChange());
      ready = true;
    } catch (e) {
      error = e.message;
      console.warn('拡張機能を有効にできませんでした:', e.message);
    }
    ctx.onChange();
  }

  // 拡張機能のポップアップが小さいまま（25px）になる環境があるので、中身に合わせて大きさを直す
  function fixPopupSize(popup) {
    popup.whenReady?.().then(async () => {
      await new Promise(r => setTimeout(r, 200));
      const win = popup.browserWindow;
      if (popup.isDestroyed() || !win || win.isDestroyed()) return;
      const b = win.getBounds();
      if (b.width > 30 && b.height > 30) return; // 正しく大きさが決まっている
      popup.setSize({ width: 800, height: 600 });
      await new Promise(r => setTimeout(r, 80));
      if (popup.isDestroyed() || win.isDestroyed()) return;
      const size = await win.webContents.executeJavaScript(`(() => {
        const r = document.body.getBoundingClientRect();
        return { width: Math.ceil(r.right + Math.max(0, r.left)), height: Math.ceil(Math.max(r.bottom + Math.max(0, r.top), document.body.scrollHeight)) };
      })()`).catch(() => null);
      if (!size || popup.isDestroyed()) return;
      popup.setSize(size);
      popup.updatePosition();
      popup.show();
    }).catch(() => {});
  }

  // タブを拡張機能に知らせる
  function addTab(wc, win) { if (ext) try { ext.addTab(wc, win); } catch {} }
  function selectTab(wc) { if (ext) try { ext.selectTab(wc); } catch {} }
  function contextMenuItems(wc, params) {
    if (!ext) return [];
    try { return ext.getContextMenuItems(wc, params); } catch { return []; }
  }

  function list() {
    const api = ses().extensions || ses();
    return api.getAllExtensions()
      .filter(e => !e.manifest?.theme)
      .map(e => {
        const m = e.manifest || {};
        const options = m.options_ui?.page || m.options_page || '';
        return { id: e.id, name: e.name, version: e.version, options: options ? `chrome-extension://${e.id}/${options}` : '' };
      });
  }

  async function remove(id) {
    if (!store) return;
    try { await store.uninstallExtension(id, { session: ses(), extensionsPath: path.join(require('electron').app.getPath('userData'), 'Extensions') }); } catch (e) { console.warn(e.message); }
    ctx.onChange();
  }

  return { init, addTab, selectTab, contextMenuItems, list, remove, status: () => ({ ready, error }) };
}

module.exports = { createExtensions };
