const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');

// Read DISCORD_TOKEN from .env (built into Node, no dotenv needed)
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  console.error('No .env file found. Copy .env.example to .env and put your bot token in it.');
  process.exit(1);
}

const client = new Client({
  // GuildMembers = join/leave events (needs "Server Members Intent" in the Developer Portal)
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  // Lets us see members leave even if the bot started after they joined
  partials: [Partials.GuildMember],
});

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

client.login(process.env.DISCORD_TOKEN);
