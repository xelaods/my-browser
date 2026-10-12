// 読み込みに失敗したときに表示するページ（Chromiumの空のエラーページに書き込む）
// ボタンは document.title に合図を入れ、main.js がそれを見て再読み込みなどをする

// エラーコード → [見出し, 説明] の i18n.js のキー
const MESSAGES = {
  '-105': ['err.notFound', 'err.notFoundBody'],
  '-106': ['err.offline', 'err.offlineBody'],
  '-7': ['err.timeout', 'err.timeoutBody'],
  '-118': ['err.timeout', 'err.timeoutBody'],
  '-102': ['err.refused', 'err.refusedBody'],
  '-109': ['err.unreachable', 'err.unreachableBody'],
  '-101': ['err.reset', 'err.retryBody'],
  '-100': ['err.closed', 'err.retryBody'],
  '-21': ['err.changed', 'err.retryBody'],
  '-111': ['err.proxy', 'err.proxyBody'],
  '-130': ['err.proxy', 'err.proxyBody'],
  '-20': ['err.blocked', ''],
  '-10': ['err.denied', ''],
  '-6': ['err.fileNotFound', 'err.fileNotFoundBody'],
};

function messageFor(code) {
  if (code <= -200 && code > -300) return ['err.cert', 'err.certBody'];
  return MESSAGES[String(code)] || ['err.generic', 'err.retryBody'];
}

// kind: 'error' | 'https' | 'crash'
function script({ kind, code, desc, url, dark, t }) {
  let title, body, buttons;
  if (kind === 'https') {
    title = t('err.https');
    body = t('err.httpsBody');
    buttons = [['#mb:back', t('err.back'), true], ['#mb:http', t('err.http'), false]];
  } else if (kind === 'crash') {
    title = t('err.crash');
    body = t('err.crashBody');
    buttons = [['#mb:retry', t('err.retry'), true]];
  } else {
    const [tk, bk] = messageFor(code);
    title = t(tk);
    body = bk ? t(bk) : '';
    buttons = code <= -200 && code > -300 ? [['#mb:back', t('err.back'), true]] : [['#mb:retry', t('err.retry'), true]];
  }
  const data = { title, body, buttons, url, detail: code ? `${desc || ''} (${code})` : '', dark };
  return `(() => {
    const d = ${JSON.stringify(data)};
    const c = d.dark
      ? { bg: '#161616', text: '#ededed', muted: '#a1a1a1', faint: '#6e6e6e', border: '#2a2a2a', pri: '#ededed', on: '#111' }
      : { bg: '#ffffff', text: '#111111', muted: '#6b6b6b', faint: '#a3a3a3', border: '#e5e5e5', pri: '#111111', on: '#fff' };
    document.documentElement.innerHTML = '<head><meta charset="utf-8"><title></title></head><body></body>';
    document.title = d.title;
    const s = document.createElement('style');
    s.textContent = \`
      html,body{height:100%;margin:0}
      body{display:grid;place-items:center;background:\${c.bg};color:\${c.text};
        font:14px/1.6 "Segoe UI","Yu Gothic UI","Noto Sans JP",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
      main{width:min(520px,86vw);margin-top:-8vh}
      .mark{width:40px;height:40px;border-radius:12px;border:1px solid \${c.border};display:grid;place-items:center;margin-bottom:20px;color:\${c.muted}}
      h1{font-size:20px;font-weight:600;letter-spacing:-.01em;margin:0 0 8px}
      p{color:\${c.muted};margin:0 0 6px}
      .url{color:\${c.faint};font-size:12.5px;word-break:break-all;margin-top:14px}
      .row{display:flex;gap:8px;margin-top:22px;flex-wrap:wrap}
      button{font:inherit;height:34px;padding:0 16px;border-radius:999px;cursor:pointer;border:1px solid \${c.border};background:none;color:\${c.muted}}
      button:hover{color:\${c.text};border-color:\${c.faint}}
      button.pri{background:\${c.pri};color:\${c.on};border-color:\${c.pri}}
    \`;
    document.head.append(s);
    const m = document.createElement('main');
    m.innerHTML = '<div class="mark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg></div><h1></h1><p class="body"></p><div class="url"></div><div class="row"></div>';
    m.querySelector('h1').textContent = d.title;
    m.querySelector('.body').textContent = d.body;
    m.querySelector('.url').textContent = d.url + (d.detail ? '  ·  ' + d.detail : '');
    for (const [sig, label, pri] of d.buttons) {
      const b = document.createElement('button');
      b.textContent = label;
      if (pri) b.className = 'pri';
      b.onclick = () => { document.title = sig; };
      m.querySelector('.row').append(b);
    }
    document.body.append(m);
  })()`;
}

module.exports = { script };
