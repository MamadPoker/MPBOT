const { Events } = require('discord.js');
const { getSetting, setSetting } = require('../db');
const { dmOwner } = require('../owner');

// Tells the owner (DM) when MP Bot is added to or removed from a server. The server list is also saved,
// so servers added/removed while the bot was offline are reported at the next start.

const readKnown = () => JSON.parse(getSetting('_bot', 'known_servers') ?? 'null'); // { id: name }
function saveKnown(client) {
  const previous = readKnown() ?? {};
  // A server Discord says is temporarily unavailable has no name: keep the saved one
  const servers = client.guilds.cache.map((g) => [g.id, g.name ?? previous[g.id] ?? g.id]);
  setSetting('_bot', 'known_servers', JSON.stringify(Object.fromEntries(servers)));
}

async function addedText(guild) {
  const owner = await guild.client.users.fetch(guild.ownerId).catch(() => null);
  return `➕ Added to ${guild.name} (${guild.memberCount} members, owner: ${owner?.username ?? guild.ownerId})`;
}
const removedText = (name) => `➖ Removed from ${name}`;

async function notify(client, text) {
  console.log(text);
  await dmOwner(client, text).catch((err) => console.error(`Couldn't DM the owner (${err.message}): ${text}`));
}

module.exports = [
  {
    name: Events.GuildCreate, // only for servers joined while the bot is running
    async execute(guild) {
      saveKnown(guild.client);
      await notify(guild.client, await addedText(guild));
    },
  },
  {
    name: Events.GuildDelete, // kicked, server deleted, or /servers leave (not during Discord outages)
    async execute(guild) {
      saveKnown(guild.client);
      await notify(guild.client, removedText(guild.name));
    },
  },
  {
    // Added or removed while MP Bot was offline? (very first start: just remember the current servers)
    name: Events.ClientReady,
    once: true,
    async execute(client) {
      const known = readKnown();
      saveKnown(client);
      if (!known) return;
      for (const guild of client.guilds.cache.values()) {
        if (!(guild.id in known)) await notify(client, `${await addedText(guild)} (while I was offline)`);
      }
      for (const [id, name] of Object.entries(known)) {
        if (!client.guilds.cache.has(id)) await notify(client, `${removedText(name)} (while I was offline)`);
      }
    },
  },
];
