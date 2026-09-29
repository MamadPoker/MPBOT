const { PermissionFlagsBits } = require('discord.js');
const { getSetting, setSetting } = require('./db');
const { field, logEmbed, userText, sendLog } = require('./logs');

// Lowercase, and treat Arabic ي/ك the same as Persian ی/ک (they look identical)
const normalize = (text) => text.normalize('NFKC').toLowerCase().replaceAll('ي', 'ی').replaceAll('ك', 'ک');

const getWords = (guildId) => JSON.parse(getSetting(guildId, 'automod_words') ?? '[]');
const setWords = (guildId, words) => setSetting(guildId, 'automod_words', words.length ? JSON.stringify(words) : null);

// Whole-word match that also works for Persian (regex \b only knows English letters).
// "*" means "any letters", e.g. "bad*" also catches "badly". So "ass" doesn't match "class".
function wordPattern(word) {
  const escaped = normalize(word).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[\\p{L}\\p{N}]*');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u');
}

const INVITE_LINK = /(?:discord(?:app)?\.com\/invite|discord\.gg)\/([\w-]+)/gi;

async function findProblem(message) {
  const text = normalize(message.content);
  const word = getWords(message.guild.id).find((w) => wordPattern(w).test(text));
  if (word) return { why: 'it contained a blocked word', detail: `Blocked word: ||${word}||` };

  if (getSetting(message.guild.id, 'automod_invites')) {
    for (const [link, code] of message.content.matchAll(INVITE_LINK)) {
      const invite = await message.client.fetchInvite(code).catch(() => null);
      // Invites to this same server are fine
      if (invite?.guild?.id !== message.guild.id) return { why: 'invite links to other servers aren\'t allowed', detail: `Invite link: ${link}` };
    }
  }
  return null;
}

// Auto-mod is off unless an admin runs /automod enable
const automodEnabled = (guildId) => Boolean(getSetting(guildId, 'automod_enabled'));

// Deletes the message if it breaks a rule. Returns true if it was removed.
async function checkAutomod(message) {
  if (!automodEnabled(message.guild.id) || !message.content) return false;
  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (member?.permissions.has(PermissionFlagsBits.ManageMessages)) return false; // mods are exempt

  const problem = await findProblem(message);
  if (!problem) return false;

  await message.delete().catch(() => {});
  const warning = await message.channel
    .send({ content: `⚠️ ${message.author}, your message was removed: ${problem.why}.`, allowedMentions: { users: [message.author.id] } })
    .catch(() => null);
  setTimeout(() => warning?.delete().catch(() => {}), 5000); // the warning disappears after 5 seconds
  await sendLog(message.guild, 'automod_logger', logEmbed('red', 'Message blocked by auto-mod', [
    field('Member', userText(message.author), true),
    field('Channel', `${message.channel}`, true),
    field('Reason', problem.detail),
    field('Message', message.content),
  ]));
  return true;
}

module.exports = { normalize, getWords, setWords, wordPattern, automodEnabled, checkAutomod };
