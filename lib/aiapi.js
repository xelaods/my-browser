// 自分のAPIキーで使う「ページを読むAI」（Anthropic / OpenAI / Google Gemini）
// 答えは少しずつ届く（ストリーミング）ので、届いた分から onDelta で画面に出す
const { net } = require('electron');

const PROVIDERS = {
  anthropic: { name: 'Claude (Anthropic)', model: 'claude-haiku-5-5', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { name: 'ChatGPT (OpenAI)', model: 'gpt-4o-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  gemini: { name: 'Gemini (Google)', model: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com/apikey' },
};

// Server-Sent Events を1行ずつ読む
async function readSSE(res, onData, signal) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    if (signal?.aborted) { try { reader.cancel(); } catch {} return; }
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try { onData(JSON.parse(data)); } catch {}
    }
  }
}

async function errorText(res) {
  let msg = 'HTTP ' + res.status;
  try { const j = await res.json(); msg = j.error?.message || j.message || msg; } catch {}
  return msg;
}

// messages: [{ role: 'user' | 'assistant', content: '…' }]
async function streamChat({ provider, key, model, system, messages, onDelta, signal }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error('unknown provider');
  model = model || p.model;
  let res;
  if (provider === 'anthropic') {
    res = await net.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 2048, system, messages, stream: true }),
    });
    if (!res.ok) throw new Error(await errorText(res));
    await readSSE(res, d => { if (d.type === 'content_block_delta' && d.delta?.text) onDelta(d.delta.text); if (d.type === 'error') throw new Error(d.error?.message || 'error'); }, signal);
  } else if (provider === 'openai') {
    res = await net.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: system }, ...messages] }),
    });
    if (!res.ok) throw new Error(await errorText(res));
    await readSSE(res, d => { const t = d.choices?.[0]?.delta?.content; if (t) onDelta(t); }, signal);
  } else if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    res = await net.fetch(url, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      }),
    });
    if (!res.ok) throw new Error(await errorText(res));
    await readSSE(res, d => { for (const part of d.candidates?.[0]?.content?.parts || []) if (part.text) onDelta(part.text); }, signal);
  }
}

module.exports = { PROVIDERS, streamChat };
