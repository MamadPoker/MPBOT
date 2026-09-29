// PM2 config: `pm2 start ecosystem.config.js` keeps the bot running and restarts it on crash
module.exports = {
  apps: [
    {
      name: 'mpbot',
      script: 'src/index.js',
      cwd: __dirname,
      restart_delay: 5000,
    },
  ],
};
