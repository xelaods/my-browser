// 内蔵AI（自分のAPIキー）：AIパネルの中の会話画面
// 質問は上のAIパネル（要約・要点などのボタン、質問欄）から届き、答えは少しずつ表示される
const $ = id => document.getElementById(id);
const log = $('log');
let state = null;
let current = null; // 書いている途中の答え

function empty() {
  log.innerHTML = '';
  const e = document.createElement('div');
  e.className = 'empty';
  e.textContent = t('aic.empty');
  log.append(e);
}
function add(role, text) {
  log.querySelector('.empty')?.remove();
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  if (role === 'assistant') {
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = state?.providerName || 'AI';
    const body = document.createElement('div');
    body.className = 'body cursor';
    body.textContent = text || '';
    el.append(label, body);
  } else el.textContent = text;
  log.append(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

async function load() {
  state = await browser.aiChatState();
  const sel = $('provider');
  if (!sel.options.length) for (const p of state.providers) sel.append(new Option(p.name, p.id));
  sel.value = state.provider;
  $('model').placeholder = state.providers.find(p => p.id === sel.value)?.model || '';
  $('model').value = state.model || '';
  $('setup').hidden = state.hasKey;
  log.hidden = !state.hasKey;
  $('foot').hidden = !state.hasKey;
  $('setup-note').textContent = state.hasKey ? '' : t('aic.keyNote');
  if (state.hasKey && !log.children.length) empty();
}
$('provider').onchange = () => {
  const p = state.providers.find(x => x.id === $('provider').value);
  $('model').placeholder = p?.model || '';
  $('model').value = '';
};
$('get-key').onclick = () => browser.aiOpenKeyPage($('provider').value);
$('save').onclick = async () => {
  const key = $('key').value.trim();
  if (!key && !state.hasKey) return;
  await browser.aiSetKey($('provider').value, key, $('model').value.trim());
  $('key').value = '';
  await load();
};
$('settings').onclick = () => { $('setup').hidden = false; log.hidden = true; $('foot').hidden = true; $('setup-note').textContent = t('aic.keyKeep'); };
$('reset').onclick = () => { browser.aiChatReset(); empty(); };

browser.onAiMsg(m => {
  if (m.type === 'context') { $('page-title').textContent = m.title || ''; return; }
  if (m.type === 'reset') { empty(); return; }
  if (m.type === 'user') { add('user', m.text); return; }
  if (m.type === 'start') { current = add('assistant', ''); return; }
  if (m.type === 'delta' && current) { current.querySelector('.body').textContent += m.text; log.scrollTop = log.scrollHeight; return; }
  if (m.type === 'done' && current) { current.querySelector('.body').classList.remove('cursor'); current = null; return; }
  if (m.type === 'error') {
    if (current) { current.querySelector('.body').classList.remove('cursor'); current = null; }
    const e = add('error', m.text);
    e.className = 'msg error';
    // キーが無い・間違っているときは、キーを入れる画面を出す
    if (m.needKey) load().then(() => { $('setup').hidden = false; log.hidden = true; $('foot').hidden = true; $('setup-note').textContent = m.text; });
  }
});
load();
