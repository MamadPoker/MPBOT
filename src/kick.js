const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { db, getSetting } = require('./db');

const CHECK_EVERY = 20_000; // normal time between checks
const GAP = 1_000; // pause between Kick requests within one check, to go easy on Kick
const MAX_BACKOFF = 5 * 60_000; // longest wait after errors (unless Kick asks for longer)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ponytail: unofficial kick.com endpoint (no API key needed); switch to the official
// api.kick.com with an app token if Kick starts blocking it.
async function fetchKickChannel(slug) {
  const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(`Kick returned HTTP ${res.status} for "${slug}"`);
    // 429 = too many requests; Retry-After says how many seconds Kick wants us to wait
    err.retryAfter = Number(res.headers.get('retry-after')) * 1000 || 0;
    throw err;
  }
  return res.json();
}

// "https://kick.com/MamadPoker/" -> "mamadpoker"
function parseSlug(input) {
  return input.trim().toLowerCase().replace(/\/+$/, '').split('/').pop();
}

function roleMention(guildId, roleId) {
  if (!roleId) return '';
  return roleId === guildId ? '@everyone' : `<@&${roleId}>`;
}

function buildLiveMessage(channel, mention) {
  const live = channel.livestream;
  const url = `https://kick.com/${channel.slug}`;
  const name = channel.user.username;
  const embed = new EmbedBuilder()
    .setColor(0x53fc18)
    .setAuthor({ name: `${name} is live on Kick!`, iconURL: channel.user.profile_pic || null, url })
    .setTitle(live.session_title || `${name} is live!`)
    .setURL(url)
    .addFields({ name: 'Category', value: live.categories?.[0]?.name ?? 'Unknown', inline: true })
    // ?t= stops Discord from showing an old cached thumbnail
    .setImage(live.thumbnail?.url ? `${live.thumbnail.url}?t=${Date.now()}` : null)
    .setTimestamp();
  const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Watch Stream').setURL(url);
  return {
    content: `${mention} **${name}** is now live!`.trim(),
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
  };
}

// Checks every followed Kick channel, one request at a time. If Kick fails or says "slow down",
// this throws and the rest waits for the next check (see startKickAlerts).
async function checkKickChannels(client) {
  const rows = db.prepare('SELECT guild_id, slug, last_live_id FROM kick_channels').all();

  // Fetch each Kick channel once, even if several servers follow it
  for (const [i, slug] of [...new Set(rows.map((r) => r.slug))].entries()) {
    if (i > 0) await sleep(GAP);
    const channel = await fetchKickChannel(slug);
    const live = channel?.livestream;
    if (!live) continue;

    // Each stream has its own id: alert once per stream, per server
    for (const row of rows.filter((r) => r.slug === slug && r.last_live_id !== live.id)) {
      const alertChannelId = getSetting(row.guild_id, 'kick_alert_channel');
      if (!alertChannelId || !client.guilds.cache.has(row.guild_id)) continue; // not set up yet, try next round

      db.prepare('UPDATE kick_channels SET last_live_id = ? WHERE guild_id = ? AND slug = ?').run(live.id, row.guild_id, slug);
      try {
        const alertChannel = await client.channels.fetch(alertChannelId);
        await alertChannel.send(buildLiveMessage(channel, roleMention(row.guild_id, getSetting(row.guild_id, 'kick_role'))));
        console.log(`Live alert sent: ${slug} -> server ${row.guild_id}`);
      } catch (err) {
        console.error(`Could not send live alert for ${slug} in server ${row.guild_id}:`, err.message);
      }
    }
  }
}

// Checks every 20 seconds. After an error (429 rate limit, blocked, Kick down, no internet) it waits
// longer each time (40s, 80s, 160s, up to 5 min, or as long as Kick asks), then goes back to 20s once a check works.
function startKickAlerts(client) {
  let wait = CHECK_EVERY;
  const loop = async () => {
    const started = Date.now();
    try {
      await checkKickChannels(client);
      wait = CHECK_EVERY;
    } catch (err) {
      wait = Math.max(Math.min(wait * 2, MAX_BACKOFF), err.retryAfter ?? 0);
      console.error(`Kick check failed (${err.message}). Next check in ${Math.round(wait / 1000)}s.`);
    }
    setTimeout(loop, Math.max(wait - (Date.now() - started), 0)); // 20s from the start of this check
  };
  loop();
}

module.exports = { fetchKickChannel, parseSlug, roleMention, buildLiveMessage, startKickAlerts };
