const { GAP, sleep, httpError } = require('./http');

// ponytail: unofficial kick.com endpoint (no API key needed); switch to the official
// api.kick.com with an app token if Kick starts blocking it.
async function fetchChannel(slug) {
  const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw httpError('Kick', res);
  return res.json();
}

module.exports = {
  id: 'kick',
  label: 'Kick',
  icon: '🟢',
  color: 0x53fc18,

  // "xqc" -> { channelId, name }, or null if the channel doesn't exist
  async resolve({ value }) {
    const channel = await fetchChannel(value);
    return channel && { channelId: channel.slug, name: channel.user.username };
  },

  // Calls onLive(channelId, stream) for every followed channel that's live right now
  async check(channelIds, onLive) {
    for (const [i, slug] of channelIds.entries()) {
      if (i > 0) await sleep(GAP);
      const channel = await fetchChannel(slug);
      const live = channel?.livestream;
      if (!live) continue;
      await onLive(slug, {
        id: String(live.id), // every stream has its own id: one alert per stream
        name: channel.user.username,
        avatar: channel.user.profile_pic,
        title: live.session_title,
        category: live.categories?.[0]?.name,
        thumbnail: live.thumbnail?.url,
        url: `https://kick.com/${channel.slug}`,
      });
    }
  },
};
