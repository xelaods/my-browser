const { contextBridge, ipcRenderer } = require('electron');

const send = (ch, ...a) => ipcRenderer.send(ch, ...a);
const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const on = ch => cb => ipcRenderer.on(ch, (_, v) => cb(v));

// ブラウザ自身の画面（ui フォルダのページ）だけが使う橋渡し。Webサイトには付けない
// main.js 側でも、送り主がこの画面かどうかを確認してから受け付ける
contextBridge.exposeInMainWorld('browser', {
  // タブ
  newTab: () => send('new-tab'),
  newPrivateTab: () => send('new-private-tab'),
  newTabMenu: () => send('new-tab-menu'),
  closeTab: id => send('close-tab', id),
  switchTab: id => send('switch-tab', id),
  moveTab: (id, beforeId, pinned, folderId) => send('move-tab', id, beforeId, pinned, folderId),
  folderToggle: id => send('folder-toggle', id),
  folderRename: (id, name) => send('folder-rename', id, name),
  folderCreate: () => send('folder-create'),
  folderMenu: id => send('folder-menu', id),
  onFolderRename: fn => ipcRenderer.on('folder-rename', (_e, id) => fn(id)),
  clearTabs: () => send('clear-tabs'),
  tabMenu: id => send('tab-menu', id),
  navigate: input => send('navigate', input),
  back: () => send('back'),
  forward: () => send('forward'),
  reload: () => send('reload'),
  zoomReset: () => send('zoom-reset'),

  // お気に入り（全プロフィール共通）
  openFavorite: id => send('open-favorite', id),
  tabToFavorite: (tabId, beforeFavId) => send('tab-to-favorite', tabId, beforeFavId),
  moveFavorite: (id, beforeId) => send('move-favorite', id, beforeId),
  removeFavorite: id => send('remove-favorite', id),
  favoriteMenu: id => send('favorite-menu', id),

  // プロフィール
  switchProfile: id => send('switch-profile', id),
  addProfile: name => send('add-profile', name),
  renameProfile: (id, name) => send('rename-profile', id, name),
  deleteProfile: id => send('delete-profile', id),
  profileMenu: id => send('profile-menu', id),

  // ウィンドウ・サイドバー
  toggleSidebar: () => send('toggle-sidebar'),
  minimize: () => send('win-min'),
  maximize: () => send('win-max'),
  close: () => send('win-close'),
  resizeStart: which => send('resize-start', which),
  resizeTo: x => send('resize-to', x),
  resizeEnd: () => send('resize-end'),

  // 設定
  openSettings: tab => send('open-settings', tab),
  closeSettings: () => send('close-settings'),
  setSettingsTab: tab => send('settings-tab', tab),
  setSearchEngine: id => send('set-search-engine', id),
  setRestore: v => send('set-restore', v),
  setTheme: theme => send('set-theme', theme),
  setColors: c => send('set-colors', c),
  setSideButtons: v => send('set-side-buttons', v),
  hideRemove: (site, sel) => send('hide-remove', site, sel),
  hideStart: () => send('hide-start'),
  setLimit: (site, minutes) => send('set-limit', site, minutes),
  setArchiveAfter: h => send('set-archive-after', h),
  setSync: mode => send('set-sync', mode),
  aiChatState: () => invoke('ai-chat-state'),
  aiSetKey: (provider, key, model) => invoke('ai-set-key', provider, key, model),
  aiChatReset: () => send('ai-chat-reset'),
  aiOpenKeyPage: provider => send('ai-open-key-page', provider),
  onAiMsg: on('ai-msg'),
  archiveOpen: url => send('archive-open', url),
  archiveRemove: url => send('archive-remove', url),
  setWidths: w => send('set-widths', w),
  setOption: (key, value) => send('set-option', key, value),
  setSleep: minutes => send('set-sleep', minutes),
  removeException: (list, host) => send('remove-exception', list, host),
  setPermission: (origin, key, value) => send('set-permission', origin, key, value),
  clearSitePermissions: origin => send('clear-site-permissions', origin),
  clearData: kind => invoke('clear-data', kind),
  historyList: q => invoke('history-list', q),
  historyRemove: url => send('history-remove', url),
  historyClear: range => invoke('history-clear', range),
  historyOpen: url => send('history-open', url),
  metrics: () => invoke('metrics'),
  sleepNow: () => invoke('sleep-now'),
  chooseDownloadDir: () => invoke('choose-download-dir'),
  makeDefault: () => invoke('make-default'),
  checkUpdate: () => send('check-update'),
  installUpdate: () => send('install-update'),
  openPrivacy: () => send('open-privacy'),
  openLicenses: () => send('open-licenses'),
  openDataFolder: () => send('open-data-folder'),

  // ページ右上のカード（ページ内検索・確認・通知）
  overlaySize: h => send('overlay-size', h),
  cardAction: (id, action) => send('card-action', id, action),
  find: (text, forward, next) => send('find', text, forward, next),
  findClose: () => send('find-close'),

  // 小さなポップアップ（URL欄の候補・サイト情報・ダウンロード）
  openPopup: (mode, anchor) => send('popup-open', mode, anchor),
  closePopup: () => send('popup-close'),
  popupSize: (w, h) => send('popup-size', w, h),
  suggest: q => invoke('suggest', q),
  suggestShow: (items, sel, anchor) => send('suggest-show', items, sel, anchor),
  pick: url => send('popup-pick', url),
  siteAdblock: on => send('site-adblock', on),
  sitePopups: on => send('site-popups', on),
  siteClear: () => invoke('site-clear'),
  siteReload: () => send('site-reload'),
  downloadAction: (id, action) => send('download-action', id, action),
  downloadsClear: () => send('downloads-clear'),
  downloadsFolder: () => send('downloads-folder'),

  // 言語
  setLang: lang => send('set-lang', lang),

  // 新しいタブ・コマンドバー
  openPalette: mode => send('palette-open', mode),
  paletteClose: () => send('palette-close'),
  paletteQuery: (q, mode) => invoke('palette-query', q, mode),
  paletteRun: (item, opts) => send('palette-run', item, opts),
  onPalette: on('palette'),

  // リンクのプレビュー
  glanceAction: action => send('glance-action', action),
  onGlance: on('glance'),

  // 翻訳
  translateToggle: () => send('translate-toggle'),
  setTranslate: (engine, key) => send('set-translate', engine, key),

  // パスワード
  pwFill: id => send('pw-fill', id),
  pwManage: () => send('pw-manage'),
  pwReveal: id => invoke('pw-reveal', id),
  pwRemove: id => send('pw-remove', id),
  pwNeverRemove: origin => send('pw-never-remove', origin),
  pwImportCsv: () => invoke('pw-import-csv'),

  // ほかのブラウザから読み込む
  importSources: () => invoke('import-sources'),
  importRun: (id, what) => invoke('import-run', id, what),
  bookmarksClear: () => send('bookmarks-clear'),

  // プロフィールのログイン情報を分ける
  setProfileSeparate: (id, on) => send('set-profile-separate', id, on),

  // 拡張機能（ボタンの表示・押したとき。electron-chrome-extensions の仕組みをそのまま使う）
  extState: () => invoke('crx-msg-remote', '_self', 'browserAction.getState'),
  extActivate: details => invoke('crx-msg-remote', '_self', 'browserAction.activate', details),
  extObserve: () => invoke('crx-msg-remote', '_self', 'browserAction.addObserver'),
  onExtUpdate: cb => ipcRenderer.on('browserAction.update', () => cb()),
  extList: () => invoke('ext-list'),
  extRemove: id => invoke('ext-remove', id),
  extOptions: id => send('ext-options', id),
  openWebStore: () => send('open-webstore'),

  // AIパネル
  toggleSide: () => send('toggle-side'),
  selectAI: i => send('select-ai', i),
  reloadAI: () => send('ai-reload'),
  openAIInTab: () => send('ai-open-tab'),
  aiAction: prompt => send('ai-action', prompt),
  getConfig: () => invoke('get-config'),

  // main.js からの知らせ
  onState: on('state'),
  onLayout: on('layout'),
  onAIStatus: on('ai-status'),
  onFocusUrl: on('focus-url'),
  onUrlPicked: on('url-picked'),
  onOpenDownloads: on('open-downloads'),
  onResizing: on('resizing'),
  onSettings: on('settings'),
  onSettingsTab: on('settings-tab'),
  onSettingsOpen: on('settings-open'),
  onOverlay: on('overlay'),
  onFindFocus: on('find-focus'),
  onPopup: on('popup'),
});

// マウスのサイドボタン（ブラウザ自身の画面の上で押したとき）
window.addEventListener('mouseup', e => {
  if (e.button === 3 || e.button === 4) { e.preventDefault(); send('side-button', e.button === 3 ? 'back' : 'forward'); }
}, true);
