const { ActivityType, Events } = require('discord.js');

// Bot status: "Playing /help"
const PRESENCE = { activities: [{ name: '/help', type: ActivityType.Playing }] };

// Discord gets PRESENCE with every fresh login (it's passed to the Client in index.js).
// A resumed connection doesn't log in again, so set it again then too.
function keepPresence(client) {
  client.on(Events.ShardResume, (shardId) => client.user.setPresence({ ...PRESENCE, shardId }));
}

module.exports = { PRESENCE, keepPresence };
