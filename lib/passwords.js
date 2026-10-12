// 保存したパスワード（OSの仕組みで暗号化してこのPCだけに保存する。Windows では DPAPI）
const { safeStorage } = require('electron');
const { readJSON, writeJSON } = require('./store');
const { originOf } = require('./security');

function createPasswords(file) {
  let data = readJSON(file, null);
  if (!data || !Array.isArray(data.entries)) data = { entries: [], never: [] };
  if (!Array.isArray(data.never)) data.never = [];

  const save = () => writeJSON(file, data);
  const newId = () => 'pw' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // 暗号化できないとき（Linux でキーリングが無いなど）は保存しない
  function available() {
    try {
      // Linux でキーリングが無いときは、Chrome と同じく簡易的な暗号化（basic_text）を使う
      if (process.platform === 'linux' && !safeStorage.isEncryptionAvailable() &&
          safeStorage.getSelectedStorageBackend?.() === 'basic_text') safeStorage.setUsePlainTextEncryption?.(true);
      return safeStorage.isEncryptionAvailable();
    } catch { return false; }
  }
  const enc = s => safeStorage.encryptString(String(s)).toString('base64');
  const dec = s => { try { return safeStorage.decryptString(Buffer.from(s, 'base64')); } catch { return null; } };

  const pub = e => ({ id: e.id, origin: e.origin, username: e.username, created: e.created, used: e.used || 0 });

  function forOrigin(origin) {
    return data.entries.filter(e => e.origin === origin).sort((a, b) => (b.used || 0) - (a.used || 0)).map(pub);
  }
  function find(origin, username) {
    const e = data.entries.find(x => x.origin === origin && x.username === username);
    return e ? pub(e) : null;
  }
  function get(id) {
    const e = data.entries.find(x => x.id === id);
    if (!e) return null;
    const password = dec(e.password);
    return password == null ? null : { ...pub(e), password };
  }
  function upsert(origin, username, password) {
    if (!available() || !originOf(origin) || !password) return null;
    let e = data.entries.find(x => x.origin === origin && x.username === username);
    if (e) e.password = enc(password);
    else {
      e = { id: newId(), origin, username: String(username || ''), password: enc(password), created: Date.now(), used: 0 };
      data.entries.push(e);
    }
    data.never = data.never.filter(o => o !== origin);
    save();
    return pub(e);
  }
  function remove(id) {
    const before = data.entries.length;
    data.entries = data.entries.filter(e => e.id !== id);
    if (data.entries.length !== before) save();
  }
  function markUsed(id) {
    const e = data.entries.find(x => x.id === id);
    if (e) { e.used = Date.now(); save(); }
  }
  function list() {
    return data.entries.map(pub).sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username));
  }

  // 「このサイトでは保存しない」
  const isNever = origin => data.never.includes(origin);
  function never(origin) { if (!isNever(origin)) { data.never.push(origin); save(); } }
  function removeNever(origin) { data.never = data.never.filter(o => o !== origin); save(); }
  const neverList = () => [...data.never];

  // Chrome・Edge・Firefox などが書き出したCSV（name,url,username,password,...）を取り込む
  function importCsv(text) {
    if (!available()) return { error: 'unavailable' };
    const rows = parseCsv(String(text || '').replace(/^﻿/, ''));
    if (rows.length < 2) return { added: 0, updated: 0, skipped: 0 };
    const head = rows[0].map(h => h.trim().toLowerCase());
    const col = names => head.findIndex(h => names.includes(h));
    const iu = col(['url', 'origin', 'login_uri', 'website', 'web site']);
    const in_ = col(['username', 'user', 'login', 'login_username', 'email']);
    const ip = col(['password', 'login_password']);
    if (iu < 0 || ip < 0) return { error: 'format' };
    let added = 0, updated = 0, skipped = 0;
    for (const r of rows.slice(1)) {
      const origin = originOf((r[iu] || '').trim());
      const password = r[ip] || '';
      const username = in_ >= 0 ? (r[in_] || '') : '';
      if (!origin || !password) { skipped++; continue; }
      const had = data.entries.find(x => x.origin === origin && x.username === username);
      if (had && dec(had.password) === password) { skipped++; continue; }
      if (had) { had.password = enc(password); updated++; } else {
        data.entries.push({ id: newId(), origin, username, password: enc(password), created: Date.now(), used: 0 });
        added++;
      }
    }
    save();
    return { added, updated, skipped };
  }

  return { available, forOrigin, find, get, upsert, remove, markUsed, list, isNever, never, removeNever, neverList, importCsv, count: () => data.entries.length };
}

// ダブルクォートで囲まれた値（中の "" や改行）にも対応したCSVの読み取り
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

module.exports = { createPasswords, parseCsv };
