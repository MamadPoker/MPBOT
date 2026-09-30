# MPBOT
Discord bot for MamadPoker Kick channel

## Start the bot automatically when Windows starts

This makes Windows start the bot about 30 seconds after the laptop boots, even before you log in,
without any window. (It replaces the old `start-mpbot.bat` in the Startup folder; the script removes that file.)

**Before you start:** the bot must be running in PM2 and saved. In a normal terminal in the bot folder:

```
pm2 start ecosystem.config.js
pm2 save
```

(If `pm2 list` already shows `mpbot` as online, just run `pm2 save`.)

### Set it up (once)

1. **Open PowerShell as administrator:** click Start, type `PowerShell`, right-click **Windows PowerShell**,
   choose **Run as administrator**, and click **Yes**.
2. **Go to the bot folder** (the one with `ecosystem.config.js`), for example:
   ```
   cd C:\Users\MG\MPBOT
   ```
3. **Run the script:**
   ```
   powershell -ExecutionPolicy Bypass -File .\scripts\setup-autostart.ps1
   ```
4. **A Windows window asks for your password.** Type the password you use to sign in to Windows
   (your Microsoft account password if you sign in with one, **not** your PIN) and click **OK**.
   Windows keeps it safely for the task; it isn't saved in any file.
5. **Read the messages.** Every line should start with `[OK]`. If you see `[X]`, it says what to fix.

### Test it with a reboot

1. **Restart** the laptop (Start → Power → Restart).
2. **Don't log in.** Wait about 1 minute at the lock screen, then check Discord on your phone: MP Bot should be online.
3. Log in and run `pm2 list`: `mpbot` should be **online**.
   Each start is written to `C:\Users\MG\.pm2\mpbot-autostart.log`.

### Good to know

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
