const { httpError } = require('./http');

// Official Twitch API (Helix) with an app access token. Needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET
// in .env (a free Twitch developer app, see the README).

let token = null; // { value, expiresAt }

const hasKeys = () => Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);

async function getToken() {
  if (token && Date.now() < token.expiresAt - 60_000) return token.value;
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw httpError('Twitch login (check TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET)', res);
  const data = await res.json();
  token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return token.value;
}

async function helix(path) {
  if (!hasKeys()) throw new Error('TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are not set in .env');
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.twitch.tv/helix${path}`, {
      headers: { 'Client-Id': process.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${await getToken()}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 && attempt === 1) { token = null; continue; } // token expired or revoked: get a new one once
    // 429: Twitch says when the limit resets (Ratelimit-Reset = unix time in seconds)
    const reset = Number(res.headers.get('ratelimit-reset')) * 1000;
    if (!res.ok) throw httpError('Twitch', res, res.status === 429 && reset ? Math.max(reset - Date.now(), 0) : 0);
    return res.json();
  }
}

const query = (key, values) => values.map((v) => `${key}=${encodeURIComponent(v)}`).join('&');

module.exports = {
  id: 'twitch',
  label: 'Twitch',
  icon: '🟣',
  color: 0x9146ff,
  hasKeys,

  // "xqc" -> { channelId: Twitch user ID, name }, or null if the channel doesn't exist
  async resolve({ value }) {
    const { data } = await helix(`/users?${query('login', [value])}`);
    return data[0] ? { channelId: data[0].id, name: data[0].display_name } : null;
  },

  // Up to 100 channels per request
  async check(channelIds, onLive) {
    for (let i = 0; i < channelIds.length; i += 100) {
      const { data: streams } = await helix(`/streams?first=100&${query('user_id', channelIds.slice(i, i + 100))}`);
      const live = streams.filter((s) => s.type === 'live');
      if (!live.length) continue;
      const { data: users } = await helix(`/users?${query('id', live.map((s) => s.user_id))}`); // profile pictures
      for (const s of live) {
        await onLive(s.user_id, {
          id: s.id, // every stream has its own id: one alert per stream
          name: s.user_name,
          avatar: users.find((u) => u.id === s.user_id)?.profile_image_url,
          title: s.title,
          category: s.game_name || undefined,
          thumbnail: s.thumbnail_url?.replace('{width}', '1280').replace('{height}', '720'),
          url: `https://www.twitch.tv/${s.user_login}`,
        });
      }
    }
  },
};
