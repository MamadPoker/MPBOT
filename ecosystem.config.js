// PM2 config: `pm2 start ecosystem.config.js` keeps the bot running and restarts it whenever it stops
module.exports = {
  apps: [
    {
      name: 'mpbot',
      script: 'src/index.js',
      cwd: __dirname,
      autorestart: true,
      // Never give up restarting. PM2 normally stops after 16 quick crashes in a row (e.g. no internet).
      // Not Infinity: PM2 sends this config as JSON, which turns Infinity into null (= stop at the first crash).
      max_restarts: Number.MAX_SAFE_INTEGER,
      // Wait a bit longer after each crash: 1s, 1.5s, 2.3s, ... up to 15s (PM2's maximum),
      // so it keeps retrying until the internet is back. Resets once the bot has been up for 30s.
      exp_backoff_restart_delay: 1000,
      // On Windows, PM2 can't send a real stop signal; this makes it send a "shutdown" message instead,
      // so the bot can record a clean stop/restart (for the "I was offline" DM) before exiting.
      shutdown_with_message: true,
      // Put the date and time in front of every line in `pm2 logs` (laptop time)
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
