# MP Bot

A multi-server Discord bot with Kick live alerts, welcome cards, moderation, ProBot-style logs, leveling and auto-mod.
Everything is set up with slash commands, and each server has its own settings.

> **MP Bot itself is a private bot**, so you can't invite it to your server. This repository lets you **host your
> own copy**: you create your own bot in Discord, and it runs on your own computer or server.

## What it does

- **Kick live alerts:** posts an alert (title, category, thumbnail, "Watch Stream" button) when a Kick channel goes
  live, optionally pinging a role. Checks every 20 seconds and slows down by itself if Kick rate-limits it.
- **Welcome and goodbye messages:** with a picture card (avatar, name, blurred or custom background).
- **Auto-role:** gives every new member a role.
- **Role menu:** `/rolemenu setup` creates a read-only **#get-roles** channel with three button menus (Colors, Age and
  Gender) and the roles they give. Each menu is single-choice, and clicking your role again removes it. Running it
  again only recreates what was deleted, and the buttons keep working after restarts.
- **Moderation:** `/ban`, `/kick`, `/timeout` and `/clear`, with safety checks (role order, server owner, yourself).
- **Logs (ProBot style):** 24 log types, one channel each: joins and leaves (with account age and the invite used),
  kicks, bans, timeouts, nickname and role changes, channel, role and permission changes, edited and deleted messages,
  voice activity, and auto-mod actions. `/log setup` creates all log channels in one go.
- **Leveling:** members earn XP by chatting, with `/rank` and `/leaderboard`. Off until you turn it on.
- **Auto-mod:** deletes blocked words (Persian included) and invite links to other servers. Off until you turn it on.
- **For the bot owner:** a nightly database backup (the last 7 are kept), a weekly backup in your DMs, a DM when the
  bot was offline, and `/servers` to see and leave the servers your copy is in.

## Requirements

- **Node.js 24 LTS** or newer (the bot uses Node's built-in SQLite, so no database server is needed)
- **Git**, to download the code and get updates
- A computer or server that stays on while the bot should be online

## 1. Create your bot in the Discord Developer Portal

1. Go to <https://discord.com/developers/applications> and click **New Application**. Give it a name.
2. Open the **Bot** page:
   - Click **Reset Token** and copy the token. You'll need it in step 3. **Never share it or commit it.**
   - Turn on these **Privileged Gateway Intents**:
     - **Server Members Intent** (join/leave logs, auto-role, member data)
     - **Message Content Intent** (auto-mod, leveling, message logs)
   - Optional: turn off **Public Bot**, so only you can add it to servers.
3. Open **OAuth2 → URL Generator**, tick the scopes **`bot`** and **`applications.commands`**, and tick these bot
   permissions:
   View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Mention Everyone, Manage Messages,
   Manage Roles, Manage Channels, Kick Members, Ban Members, Moderate Members, View Audit Log, Manage Server.
4. Open the generated link and add the bot to your server.
5. In your server, drag the bot's role **above** the roles it should manage (auto-role, moderation).

Instead of step 3, you can use this link with your application ID (from **General Information**):
`https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&scope=bot+applications.commands&permissions=1099780320438`

## 2. Download and install

```
git clone https://github.com/MamadPoker/MPBOT.git
cd MPBOT
npm install
```

## 3. Fill in `.env`

Copy `.env.example` to `.env` and fill in the values:

| Variable | What to put there |
|---|---|
| `DISCORD_TOKEN` | Your bot token from step 1 |
| `OWNER_ID` | Your own Discord user ID (Discord Settings → Advanced → turn on Developer Mode, then right-click your name → Copy User ID) |

`.env` is in `.gitignore`, so it's never committed.

## 4. Start the bot

```
npm start
```

The slash commands are registered automatically when the bot starts. The bot creates its database (`data.db`)
in the bot folder by itself. To keep the bot running all the time, use a process manager such as
[PM2](https://pm2.keymetrics.io/) (`pm2 start ecosystem.config.js`). See the Windows notes at the end.

## Slash commands

Commands for admins and moderators are only shown to members with the right permission.

| Command | What it does | Who can use it |
|---|---|---|
| `/help` | Shows the commands you can use, by category | Everyone |
| `/ping` | Checks that the bot is alive | Everyone |
| `/live add` · `remove` · `set-channel` · `set-role` · `list` | Kick live alerts: which channels, where to post, which role to ping | Manage Server |
| `/welcome set-channel` · `set-message` · `set-background` · `test` · `disable` | Welcome messages and card | Manage Server |
| `/goodbye set-channel` · `set-message` · `test` · `disable` | Goodbye messages | Manage Server |
| `/autorole set` · `off` | The role new members get | Manage Server |
| `/rolemenu setup` | Creates (or repairs) **#get-roles** with the Colors, Age and Gender role buttons. Optional `category` for the new channel | Manage Server |
| `/ban` · `/kick` · `/timeout` | Moderate a member, with a reason | Ban / Kick / Timeout Members |
| `/clear` | Deletes up to 100 recent messages, optionally from one user | Manage Messages |
| `/log set` · `setup` · `list` | Choose log channels, or create them all with `setup` | Manage Server |
| `/level enable` · `disable` | Turns leveling on or off | Manage Server |
| `/rank` · `/leaderboard` | Your level and XP, and the top 10 members | Everyone |
| `/automod enable` · `disable` · `add-word` · `remove-word` · `invite-filter` · `status` | Auto-mod settings | Manage Server |
| `/backup` | Backs up the database now and DMs it to you | Bot owner |
| `/servers list` · `leave` | The servers your copy is in, and leaving one | Bot owner |

Welcome and goodbye texts can use `{user}` (mention), `{username}`, `{server}` and `{count}` (member count).

## Good to know

- **Dates in logs and DMs** use Istanbul time. To change it, edit `Europe/Istanbul` in `src/logs.js` and `src/offline.js`.
- **The "Watch Stream" button** uses MP Bot's own Kick emoji. In your copy, Discord can't find that emoji, so the
  button is sent without it. To get an emoji, upload one under **Emojis** in the Developer Portal and put its ID in
  `KICK_EMOJI` in `src/kick.js`.
- **Kick alerts** use Kick's public website API, so no Kick API key is needed.
- **Backups** are saved in `backups/`. They contain saved messages, so keep them private. How to restore one is
  explained at the top of `src/backup.js`.

## Self-hosting on Windows

These are the notes for how MP Bot runs on a Windows laptop with PM2. Use them if you host your copy the same way.

### Keep it running with PM2

```
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```

`pm2 logs mpbot` shows the bot's output with the date and time, and `pm2 list` shows whether it's **online**.
PM2 never gives up restarting the bot: after a crash or without internet it waits a little longer each time
(up to 15 seconds), so the bot comes back by itself once the connection is back.

### Using a VPN (for example Cloudflare WARP)

If Discord only works through a VPN on your network, the bot handles the VPN dropping out: if it's offline from
Discord for 2 minutes, it restarts itself, and PM2 keeps retrying until the connection is back. The autostart task
below waits 30 seconds after boot so the VPN can connect first. Never turn off TLS certificate checks to get around
a network problem; connect the VPN instead.

### Updating the bot

**Double-click `scripts\update.cmd`** (in the bot folder) and click **Yes** when Windows asks for administrator rights.
It then:

1. downloads the latest version (`git pull`),
2. runs `npm install`, but only if `package.json` or `package-lock.json` changed,
3. restarts the bot (`pm2 restart mpbot`); if PM2's settings in `ecosystem.config.js` changed, it reloads the bot
   with the new settings and saves them (`pm2 delete` + `pm2 start ecosystem.config.js` + `pm2 save`),
4. shows `pm2 list`, and waits for a key so you can read the result. `mpbot` should be **online**.

It needs administrator rights because PM2 is started by the Windows task with admin rights. If something fails, the
window stays open and says which step went wrong.

### Start the bot automatically when Windows starts

This makes Windows start the bot about 30 seconds after the computer boots, even before you log in,
without any window.

**Before you start:** the bot must be running in PM2 and saved. In a normal terminal in the bot folder:

```
pm2 start ecosystem.config.js
pm2 save
```

(If `pm2 list` already shows `mpbot` as online, just run `pm2 save`.)

#### Set it up (once)

1. **Open PowerShell as administrator:** click Start, type `PowerShell`, right-click **Windows PowerShell**,
   choose **Run as administrator**, and click **Yes**.
2. **Go to the bot folder** (the one with `ecosystem.config.js`), for example:
   ```
   cd C:\path\to\MPBOT
   ```
3. **Run the script:**
   ```
   powershell -ExecutionPolicy Bypass -File .\scripts\setup-autostart.ps1
   ```
4. **A Windows window asks for your password.** Type the password you use to sign in to Windows
   (your Microsoft account password if you sign in with one, **not** your PIN) and click **OK**.
   Windows keeps it safely for the task; it isn't saved in any file.
5. **Read the messages.** Every line should start with `[OK]`. If you see `[X]`, it says what to fix.

#### Test it with a reboot

1. **Restart** the computer (Start → Power → Restart).
2. **Don't log in.** Wait about 1 minute at the lock screen, then check Discord on your phone: the bot should be online.
3. Log in and run `pm2 list`: `mpbot` should be **online**.
   Each start is written to `%USERPROFILE%\.pm2\mpbot-autostart.log`.

#### Good to know

- **Changed your Windows password?** Run the setup script again (step 3).
- **Changed what PM2 runs** (`pm2 start` / `pm2 delete`)? Run `pm2 save`, so the next boot starts the right list.
- **Restart always works.** If the bot doesn't start after *Shut down* + switching on, Windows "Fast startup" may be
  skipping a real boot: Control Panel → Power Options → *Choose what the power buttons do* → *Change settings that
  are currently unavailable* → untick **Turn on fast startup**.
- **See or run the task by hand:** open *Task Scheduler* and look for **MPBOT** in the Task Scheduler Library.
- **Turn it off:** in PowerShell as administrator, in the bot folder:
  ```
  powershell -ExecutionPolicy Bypass -File .\scripts\remove-autostart.ps1
  ```
  The bot keeps running; it just won't start by itself at the next boot.

## License

MIT © 2026 MamadPoker. See [LICENSE](LICENSE).
