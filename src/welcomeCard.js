const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');
const { getSetting } = require('./db');

// Vazirmatn draws both Persian and English letters
const fontDir = path.join(path.dirname(require.resolve('vazirmatn/package.json')), 'fonts', 'ttf');
GlobalFonts.registerFromPath(path.join(fontDir, 'Vazirmatn-Regular.ttf'), 'Vazirmatn');

// Layout measured from the old ProBot card
const WIDTH = 1024;
const HEIGHT = 450;
const AVATAR = { x: 512, y: 204, radius: 101, ring: 17 };

// Download with a time limit, so a slow image server can't hang the welcome
async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Image download failed (HTTP ${res.status})`);
  return loadImage(Buffer.from(await res.arrayBuffer()));
}

async function renderWelcomeCard(member) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  const avatar = await fetchImage(member.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }));

  // Black first, so transparent avatars don't leave see-through gaps
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Background: the server's custom image, or the member's own avatar blurred and darkened
  const background = getSetting(member.guild.id, 'welcome_background');
  if (background) {
    ctx.drawImage(await loadImage(Buffer.from(background, 'base64')), 0, 0);
  } else {
    ctx.filter = 'blur(60px)';
    drawCover(ctx, avatar, 120); // drawn a bit past the edges so the blur doesn't fade them
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // Avatar, cut into a circle
  const { x, y, radius, ring } = AVATAR;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(avatar, x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();

  // Gray ring (1px wider on each side so no gap shows next to the avatar)
  ctx.beginPath();
  ctx.arc(x, y, radius + ring / 2, 0, Math.PI * 2);
  ctx.lineWidth = ring + 2;
  ctx.strokeStyle = '#808080';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'; // dark halo so the ring stands out on any background
  ctx.shadowBlur = 20;
  ctx.stroke();

  // Username, centered below the avatar (shrinks to fit if it's very long).
  // To draw a Persian sentence, set ctx.direction = 'rtl' first so the words come out in the right order.
  ctx.font = '38px Vazirmatn';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'; // keeps white text readable on bright backgrounds
  ctx.shadowBlur = 8;
  ctx.fillText(member.user.username, WIDTH / 2, 364, WIDTH - 60);

  return new AttachmentBuilder(await canvas.encode('png'), { name: 'welcome.png' });
}

// Scales an image to fill the whole card, centered (the overflow is cropped off).
// `bleed` pixels extra on every side.
function drawCover(ctx, img, bleed = 0) {
  const scale = Math.max((WIDTH + bleed * 2) / img.width, (HEIGHT + bleed * 2) / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
}

// Crops any uploaded image to fill the card, and returns it as text we can save in the database
async function prepareBackground(url) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  drawCover(canvas.getContext('2d'), await fetchImage(url));
  return (await canvas.encode('jpeg', 90)).toString('base64');
}

module.exports = { renderWelcomeCard, prepareBackground };
