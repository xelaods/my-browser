// SponsorBlock（動画の中の案件・宣伝区間を、みんなで登録している共有データ）から区間を取ってくる
// どの動画を見ているかを知られないよう、動画IDのハッシュの先頭4文字だけを送り、手元で絞り込む
const crypto = require('crypto');
const { net } = require('electron');

const API = 'https://sponsor.ajay.app/api/skipSegments/';
const CATEGORIES = ['sponsor', 'selfpromo', 'interaction'];
const cache = new Map(); // videoId → { at, segs }

async function segmentsFor(videoId) {
  if (!/^[\w-]{6,20}$/.test(videoId || '')) return [];
  const hit = cache.get(videoId);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.segs;
  const prefix = crypto.createHash('sha256').update(videoId).digest('hex').slice(0, 4);
  const url = API + prefix + '?categories=' + encodeURIComponent(JSON.stringify(CATEGORIES));
  let segs = [];
  try {
    const res = await net.fetch(url, { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const list = await res.json();
      const item = Array.isArray(list) ? list.find(x => x && x.videoID === videoId) : null;
      segs = (item?.segments || [])
        .filter(s => Array.isArray(s.segment) && CATEGORIES.includes(s.category) && s.actionType !== 'mute')
        .map(s => ({ start: Number(s.segment[0]), end: Number(s.segment[1]), category: s.category }))
        .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end - s.start >= 1)
        .sort((a, b) => a.start - b.start);
    }
    // 404 = この動画には登録がない
  } catch { return []; }
  cache.set(videoId, { at: Date.now(), segs });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return segs;
}

module.exports = { segmentsFor };
