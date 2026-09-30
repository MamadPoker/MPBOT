const { Events, Status } = require('discord.js');

const OFFLINE_LIMIT = 2 * 60_000; // offline this long -> restart
const CHECK_EVERY = 15_000;

// PM2 only restarts the bot when the process stops. After an internet/VPN drop, discord.js sometimes never
// manages to reconnect and the bot just sits there offline. This watchdog notices and exits, so PM2 starts it fresh.
function startWatchdog(client, exit = () => process.exit(1)) {
  // Last time we saw proof the connection works: starting up, (re)connecting, or Discord answering a heartbeat
  let lastAlive = Date.now();
  const markAlive = () => {
    lastAlive = Date.now();
  };
  client.on(Events.ShardReady, markAlive);
  client.on(Events.ShardResume, markAlive);

  return setInterval(() => {
    const heartbeats = client.ws.shards.map((shard) => shard.lastPingTimestamp); // -1 = no heartbeat yet
    if (heartbeats.length) lastAlive = Math.max(lastAlive, Math.min(...heartbeats));

    const offlineFor = Date.now() - lastAlive;
    if (offlineFor <= OFFLINE_LIMIT) return;
    const why = !client.isReady() ? 'never connected to Discord'
      : client.ws.shards.some((shard) => shard.status !== Status.Ready) ? 'disconnected from Discord'
      : 'no heartbeat from Discord';
    console.error(`Watchdog: ${why} for ${Math.round(offlineFor / 1000)}s. Exiting so PM2 restarts the bot fresh.`);
    exit();
  }, CHECK_EVERY);
}

module.exports = { startWatchdog, OFFLINE_LIMIT };
