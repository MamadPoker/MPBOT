const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { db, getSetting } = require('../db');

// Live alerts for Kick, Twitch and YouTube. Each platform file knows how to find a channel (resolve)
// and which followed channels are live (check); everything else is shared here.
const PLATFORMS = Object.fromEntries([require('./kick'), require('./twitch'), require('./youtube')].map((p) => [p.id, p]));

const CHECK_EVERY = 20_000; // normal time between checks, per platform
const MAX_BACKOFF = 5 * 60_000; // longest wait after errors (unless the site asks for longer)

// Same setting names as before Twitch/YouTube existed, so existing setups keep working
const ALERT_CHANNEL = 'kick_alert_channel';
const PING_ROLE = 'kick_role';

// ---- Understanding what was typed: a name or a link ----

const HOSTS = { 'kick.com': 'kick', 'twitch.tv': 'twitch', 'youtube.com': 'youtube', 'youtu.be': 'youtube' };

// Which platform a link is for ("https://www.twitch.tv/xqc" -> "twitch"), or null if it's not a link we know
function platformOfLink(input) {
  const cleaned = input.trim().replace(/^https?:\/\//i, '').replace(/^(www\.|m\.)/i, '').toLowerCase();
  return Object.entries(HOSTS).find(([host]) => cleaned === host || cleaned.startsWith(`${host}/`))?.[1] ?? null;
}

// Returns { ref, shown } (what to look up) or { error } (message for the user)
function parseChannel(platformId, input) {
  const platform = PLATFORMS[platformId];
  const text = input.trim();
  const invalid = { error: `❌ "${text}" isn't a valid ${platform.label} channel name or link.` };
  const linkPlatform = platformOfLink(text);
  if (!linkPlatform && /^https?:\/\//i.test(text)) return { error: '❌ That link isn\'t a Kick, Twitch or YouTube channel link.' };
  if (linkPlatform && linkPlatform !== platformId) {
    const other = PLATFORMS[linkPlatform].label;
    return { error: `❌ That's a ${other} link, but you chose ${platform.label}. Please pick ${other}.` };
  }

  // The part that names the channel: from a link, or the whole text
  let parts = [text];
  if (linkPlatform) {
    const path = text.replace(/^https?:\/\//i, '').replace(/^[^/]+/, '').split(/[?#]/)[0];
    parts = path.split('/').filter(Boolean);
    if (linkPlatform === 'youtube' && (/youtu\.be/i.test(text) || ['watch', 'live', 'shorts', 'embed'].includes(parts[0]))) {
      return { error: '❌ That\'s a YouTube video link. Please use the channel link instead (like youtube.com/@name).' };
    }
    if (!parts.length) return invalid;
  }

  if (platformId === 'kick') {
    const name = parts[0].replace(/^@/, '').toLowerCase();
    return /^[a-z0-9_-]{1,30}$/.test(name) ? { ref: { value: name }, shown: name } : invalid;
  }
  if (platformId === 'twitch') {
    const name = parts[0].replace(/^@/, '').toLowerCase();
    return /^[a-z0-9_]{1,25}$/.test(name) ? { ref: { value: name }, shown: name } : invalid;
  }
  // YouTube: youtube.com/@handle, /channel/UC..., /c/name, /user/name, a bare /name, or typed "@handle" / "handle" / "UC..."
  const [first, second] = parts;
  let ref = null;
  if (linkPlatform && first === 'channel' && second) ref = { kind: 'id', value: second };
  else if (linkPlatform && (first === 'c' || first === 'user') && second) ref = { kind: first === 'c' ? 'custom' : 'user', value: second };
  else if (/^UC[\w-]{22}$/.test(first)) ref = { kind: 'id', value: first };
  else if (/^@?[\w.-]{3,30}$/.test(first)) ref = { kind: first.startsWith('@') || !linkPlatform ? 'handle' : 'custom', value: first.replace(/^@/, '') };
  if (!ref || !/^[\w.-]+$/.test(ref.value)) return invalid;
  return { ref, shown: ref.kind === 'handle' ? `@${ref.value}` : ref.value };
}

// ---- Alerts ----

function roleMention(guildId, roleId) {
  if (!roleId) return '';
  return roleId === guildId ? '@everyone' : `<@&${roleId}>`;
}

function buildLiveMessage(platform, stream, mention) {
  const embed = new EmbedBuilder()
    .setColor(platform.color)
    .setAuthor({ name: `${stream.name} is live on ${platform.label}!`, iconURL: stream.avatar || null, url: stream.url })
    .setTitle((stream.title || `${stream.name} is live!`).slice(0, 256))
    .setURL(stream.url)
    // ?t= stops Discord from showing an old cached thumbnail
    .setImage(stream.thumbnail ? `${stream.thumbnail}${stream.thumbnail.includes('?') ? '&' : '?'}t=${Date.now()}` : null)
    .setTimestamp();
  if (stream.category) embed.addFields({ name: 'Category', value: stream.category.slice(0, 1024), inline: true });
  const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Watch Stream').setURL(stream.url);
  return {
    content: `${mention} **${stream.name}** is now live on ${platform.label}!`.trim(),
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
  };
}

// A followed channel is live: alert every server following it, once per stream
async function announce(client, platform, rows, stream) {
  for (const row of rows.filter((r) => r.last_live_id !== stream.id)) {
    const alertChannelId = getSetting(row.guild_id, ALERT_CHANNEL);
    if (!alertChannelId || !client.guilds.cache.has(row.guild_id)) continue; // not set up yet, try next round

    db.prepare('UPDATE live_channels SET last_live_id = ? WHERE guild_id = ? AND platform = ? AND channel_id = ?')
      .run(stream.id, row.guild_id, platform.id, row.channel_id);
    try {
      const alertChannel = await client.channels.fetch(alertChannelId);
      await alertChannel.send(buildLiveMessage(platform, stream, roleMention(row.guild_id, getSetting(row.guild_id, PING_ROLE))));
      console.log(`Live alert sent: ${platform.label} ${stream.name} -> server ${row.guild_id}`);
    } catch (err) {
      console.error(`Could not send ${platform.label} live alert for ${stream.name} in server ${row.guild_id}:`, err.message);
    }
  }
}

const warned = new Set();
async function checkPlatform(client, platform) {
  const rows = db.prepare('SELECT guild_id, channel_id, last_live_id FROM live_channels WHERE platform = ?').all(platform.id);
  const channelIds = [...new Set(rows.map((r) => r.channel_id))]; // each channel checked once, even if several servers follow it
  if (!channelIds.length) return;
  if (platform.hasKeys && !platform.hasKeys()) {
    if (!warned.has(platform.id)) console.warn(`${platform.label} alerts are paused: TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET aren't set in .env.`);
    warned.add(platform.id);
    return;
  }
  await platform.check(channelIds, (channelId, stream) => announce(client, platform, rows.filter((r) => r.channel_id === channelId), stream));
}

// Every platform has its own loop: every 20 seconds, and after an error (rate limit, blocked, site down,
// no internet) it waits longer each time (40s, 80s, ... up to 5 min, or as long as the site asks), then
// goes back to 20s once a check works. A problem with one platform never stops the others.
function startLiveAlerts(client) {
  for (const platform of Object.values(PLATFORMS)) {
    let wait = CHECK_EVERY;
    const loop = async () => {
      const started = Date.now();
      try {
        await checkPlatform(client, platform);
        wait = CHECK_EVERY;
      } catch (err) {
        wait = Math.max(Math.min(wait * 2, MAX_BACKOFF), err.retryAfter ?? 0);
        console.error(`${platform.label} check failed (${err.message}). Next ${platform.label} check in ${Math.round(wait / 1000)}s.`);
      }
      setTimeout(loop, Math.max(wait - (Date.now() - started), 0)); // 20s from the start of this check
    };
    loop();
  }
}

// Followed channels of a server, for /live list, /live remove and /servers
const followed = (guildId) => db.prepare('SELECT platform, channel_id, name FROM live_channels WHERE guild_id = ? ORDER BY platform, name').all(guildId);

module.exports = {
  PLATFORMS, ALERT_CHANNEL, PING_ROLE,
  platformOfLink, parseChannel, roleMention, buildLiveMessage, startLiveAlerts, followed,
};
