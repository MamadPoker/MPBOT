const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { db, getSetting } = require('./db');

// ponytail: unofficial kick.com endpoint (no API key needed); switch to the official
// api.kick.com with an app token if Kick starts blocking it.
async function fetchKickChannel(slug) {
  const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Kick returned HTTP ${res.status} for "${slug}"`);
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

async function checkKickChannels(client) {
  const rows = db.prepare('SELECT guild_id, slug, last_live_id FROM kick_channels').all();

  // Fetch each Kick channel once, even if several servers follow it
  for (const slug of new Set(rows.map((r) => r.slug))) {
    let channel;
    try {
      channel = await fetchKickChannel(slug);
    } catch (err) {
      console.error(`Kick check failed for ${slug}:`, err.message);
      continue;
    }
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

function startKickAlerts(client) {
  const run = () => checkKickChannels(client).catch((err) => console.error('Kick check error:', err));
  run();
  setInterval(run, 60_000);
}

module.exports = { fetchKickChannel, parseSlug, roleMention, buildLiveMessage, startKickAlerts };
