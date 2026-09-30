# MP Bot

Discord bot for the MamadPoker community: live alerts for Kick, Twitch and YouTube, welcome cards,
server logs, moderation and more. Built with Node.js and discord.js v14 (slash commands). Every server
has its own settings, stored in a local SQLite database (`data.db`).

Type `/help` in Discord to see all commands you can use, with examples.

## Setup

1. Install [Node.js](https://nodejs.org) 22 or newer, then run `npm install` in this folder.
2. Copy `.env.example` to `.env` and fill it in (never share or commit `.env`):
   - `DISCORD_TOKEN`: your bot token (Discord Developer Portal → your app → Bot → Reset Token).
   - `OWNER_ID`: your own Discord user ID (Developer Mode on → right-click your name → Copy User ID).
   - `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`: only needed for Twitch alerts (see below).
3. In the Developer Portal (Bot tab), turn on **Server Members Intent** and **Message Content Intent**.
4. Run it 24/7 with PM2:
   ```
   npm install -g pm2
   pm2 start ecosystem.config.js
   pm2 save
   ```
   Useful: `pm2 logs mpbot` (logs with timestamps), `pm2 restart mpbot` (after `git pull`).
   After changing `ecosystem.config.js`, run `pm2 delete mpbot`, `pm2 start ecosystem.config.js`, `pm2 save`.

## Features

| Feature | Commands | Notes |
|---|---|---|
| Live alerts (Kick, Twitch, YouTube) | `/live` | See below. |
| Welcome & goodbye | `/welcome`, `/goodbye` | Custom text with `{user}`, `{username}`, `{server}`, `{count}`, `\n`; welcome picture card. |
| Auto-role | `/autorole` | Waits for rules screening; bots don't get it. |
| Moderation | `/ban`, `/kick`, `/timeout`, `/clear` | DMs the member the reason; everything is logged. |
| Server logs | `/log setup`, `/log set`, `/log list` | 24 log channels in a private LOGs category (ProBot style). |
| Leveling | `/level`, `/rank`, `/leaderboard` | Off by default. |
| Auto-mod | `/automod` | Bad words and invite links. Off by default. |
| Owner tools | `/servers`, `/backup` | Only for `OWNER_ID`; also work in your DM with the bot. |

The bot also backs up `data.db` every night at 4 AM (7 kept in `backups/`, one DMed to you weekly),
DMs you when it was offline for more than 3 minutes, and restarts itself if it loses Discord (watchdog).

## Live alerts

```
/live set-channel channel:#live          (where alerts are posted, all platforms)
/live set-role role:@Live                (optional ping)
/live add platform:Kick channel:mamadpoker
/live add platform:Twitch channel:twitch.tv/xqc
/live add platform:YouTube channel:@mrbeast
/live list
/live remove channel:<pick from the list or paste a link>
```

- `platform` is required. `channel` takes a name or a link: `kick.com/name`, `twitch.tv/name`,
  `youtube.com/@handle`, `youtube.com/channel/UC…`, `youtube.com/c/name` (with or without `https://`, `www.`, `m.`).
  A link for a different platform than the one you picked is refused.
- Each platform is checked every 20 seconds, on its own: if one platform has a problem (rate limit,
  site down), it waits longer before trying again (up to 5 minutes), and the others keep working.
- One alert per stream. YouTube: only real live streams, never premieres, scheduled streams or uploads.
- Kick and YouTube need no keys. YouTube is read from the channel's public `/live` page (no API key,
  because the YouTube API's daily quota is very small).

### Getting the Twitch keys (free, about 5 minutes)

1. Go to <https://dev.twitch.tv/console/apps> and log in with your Twitch account.
   (Twitch may ask you to turn on two-factor authentication first.)
2. Click **Register Your Application**.
3. Fill in:
   - **Name**: anything unique, e.g. `MP Bot Alerts`.
   - **OAuth Redirect URLs**: `http://localhost` (it's not used, but the form needs one).
   - **Category**: `Chat Bot` (or `Other`).
   - **Client Type**: **Confidential**.
4. Click **Create**, then **Manage** next to your new app.
5. Copy the **Client ID** into `.env` as `TWITCH_CLIENT_ID=...`.
6. Click **New Secret**, and copy the secret into `.env` as `TWITCH_CLIENT_SECRET=...`.
   (It's shown only once. Keep it private, like your bot token.)
7. Restart the bot: `pm2 restart mpbot`. Now `/live add platform:Twitch channel:...` works.

## Restoring a backup

1. `pm2 stop mpbot`
2. Rename `data.db` to `data.db.broken` (and delete `data.db-journal` if there is one).
3. Copy a file from `backups/` (or the one from your DMs) into this folder and name it `data.db`.
4. `pm2 start mpbot`
