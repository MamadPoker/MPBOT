const { GAP, sleep, httpError } = require('./http');

// YouTube without an API key (the API's daily quota is tiny): the bot reads the channel's public /live page.
// If the channel is live, that page is the live video; otherwise it's the channel page.

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'CONSENT=YES+cb; SOCS=CAI', // skips the "before you continue" cookie page in some countries
};

async function getPage(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw httpError('YouTube', res);
  if (new URL(res.url).hostname !== 'www.youtube.com') throw new Error(`YouTube sent us to ${new URL(res.url).hostname} (consent or robot check page)`);
  return res.text();
}

// Reads the JSON object that starts right after `marker` in the page (e.g. "videoDetails":{...})
function extractJson(html, marker) {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const from = html.indexOf('{', start);
  let depth = 0;
  let inString = false;
  for (let i = from; i >= 0 && i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(from, i + 1)); } catch { return null; }
    }
  }
  return null;
}

const decode = (text) => text
  .replace(/&#(x?)([0-9a-f]+);/gi, (m, hex, n) => String.fromCodePoint(parseInt(n, hex ? 16 : 10)))
  .replace(/&(amp|quot|lt|gt|apos);/g, (m, e) => ({ amp: '&', quot: '"', lt: '<', gt: '>', apos: "'" })[e]);

const canonical = (html) => html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];

// A live page -> stream info; not live (or only a premiere / scheduled stream / upload) -> null
function liveInfo(html, channelId) {
  const url = canonical(html);
  if (!url) throw new Error('YouTube sent an unexpected page (maybe a consent or robot check page)');
  if (!url.includes('/watch?v=')) return null; // not live: /live showed the channel page
  const video = extractJson(html, '"videoDetails":');
  if (!video?.videoId) throw new Error('Could not read the YouTube live page');
  // Only real live streams on air right now: premieres aren't live content, scheduled streams are "upcoming"
  if (video.isLive !== true || video.isLiveContent !== true || video.isUpcoming || video.channelId !== channelId) return null;
  return {
    id: video.videoId, // every stream has its own video id: one alert per stream
    name: video.author,
    title: video.title,
    category: extractJson(html, '"playerMicroformatRenderer":')?.category,
    thumbnail: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${video.videoId}`,
  };
}

const PAGES = { id: (v) => `channel/${v}`, handle: (v) => `@${v}`, custom: (v) => `c/${v}`, user: (v) => `user/${v}` };

module.exports = {
  id: 'youtube',
  label: 'YouTube',
  icon: '🔴',
  color: 0xff0000,

  // @handle, channel ID, /c/ or /user/ name -> { channelId: "UC...", name }, or null if it doesn't exist
  async resolve({ kind, value }) {
    const html = await getPage(`https://www.youtube.com/${PAGES[kind](encodeURIComponent(value))}`);
    if (!html) return null;
    const channelId = canonical(html)?.match(/\/channel\/(UC[\w-]{22})/)?.[1] ?? html.match(/"externalId":"(UC[\w-]{22})"/)?.[1];
    if (!channelId) throw new Error('YouTube sent an unexpected page (maybe a consent or robot check page)');
    const title = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1];
    return { channelId, name: title ? decode(title) : channelId };
  },

  async check(channelIds, onLive) {
    for (const [i, channelId] of channelIds.entries()) {
      if (i > 0) await sleep(GAP);
      const html = await getPage(`https://www.youtube.com/channel/${channelId}/live`);
      const stream = html && liveInfo(html, channelId);
      if (stream) await onLive(channelId, stream);
    }
  },
};
