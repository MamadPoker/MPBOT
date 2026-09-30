const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { startWatchdog } = require('./watchdog');
const { PRESENCE, keepPresence } = require('./presence');
const { startOfflineNotices, recordShutdown } = require('./offline');

// Read DISCORD_TOKEN from .env (built into Node, no dotenv needed)
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  console.error('No .env file found. Copy .env.example to .env and put your bot token in it.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // join/leave/member updates (needs "Server Members Intent" in the Developer Portal)
    GatewayIntentBits.GuildModeration, // audit log entries, bans
    GatewayIntentBits.GuildInvites, // invite tracking
    GatewayIntentBits.GuildMessages, // message edit/delete logs
    GatewayIntentBits.MessageContent, // message text (needs "Message Content Intent" in the Developer Portal)
    GatewayIntentBits.GuildVoiceStates, // voice logs
  ],
  // Lets us see leaves/deletes/edits even for members and messages from before the bot started
  partials: [Partials.GuildMember, Partials.Message],
  presence: PRESENCE, // "Playing /help", sent with every login
});
keepPresence(client); // ...and again after every resumed reconnect

// Every file in src/commands exports { data, execute } (or a list of them)
client.commands = new Collection();
for (const file of fs.readdirSync(path.join(__dirname, 'commands')).filter((f) => f.endsWith('.js'))) {
  for (const command of [require(`./commands/${file}`)].flat()) client.commands.set(command.data.name, command);
}

// Every file in src/events exports { name, once?, execute } (or a list of them)
for (const file of fs.readdirSync(path.join(__dirname, 'events')).filter((f) => f.endsWith('.js'))) {
  for (const event of [require(`./events/${file}`)].flat()) {
    client[event.once ? 'once' : 'on'](event.name, (...args) => event.execute(...args));
  }
}

// Log errors instead of crashing the whole bot
process.on('unhandledRejection', (err) => console.error('Unhandled error:', err));

// Remember why the bot stopped, so the "I was offline" DM to the owner can say why
const stop = (reason, exitCode) => {
  recordShutdown(reason, client);
  process.exit(exitCode);
};
process.on('SIGINT', () => stop('clean', 0)); // Ctrl+C
process.on('SIGTERM', () => stop('clean', 0));
// pm2 stop/restart on Windows sends this message instead of a signal (shutdown_with_message in ecosystem.config.js)
process.on('message', (msg) => msg === 'shutdown' && stop('clean', 0));
process.on('uncaughtException', (err) => {
  console.error('Crashed:', err);
  stop('crash', 1);
});
startOfflineNotices(client);

// Offline from Discord for 2+ minutes (e.g. after a VPN drop)? Exit, and PM2 starts the bot fresh.
startWatchdog(client, () => stop('watchdog', 1));

// No internet at startup? Exit right away, and PM2 tries again a little later.
client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error('Could not log in to Discord:', err.message);
  process.exit(1);
});
