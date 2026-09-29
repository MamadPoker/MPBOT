const { getSetting } = require('./db');
const { renderWelcomeCard } = require('./welcomeCard');

const DEFAULT_MESSAGES = {
  welcome: '{user} به سرور {server} خوش آمدی 🌹',
  goodbye: '**{username}** has left the server.',
};

// "Hi {user}!" -> "Hi @Mamad!"   (\n typed in the slash command becomes a real new line)
function formatGreeting(template, member) {
  const vars = {
    user: `<@${member.id}>`,
    username: member.user.username,
    server: member.guild.name,
    count: member.guild.memberCount,
  };
  return template.replaceAll('\\n', '\n').replace(/\{(user|username|server|count)\}/g, (_, key) => vars[key]);
}

// type is 'welcome' or 'goodbye'. Returns false if no channel is set for this server.
async function sendGreeting(type, member) {
  const channelId = getSetting(member.guild.id, `${type}_channel`);
  if (!channelId) return false;
  const template = getSetting(member.guild.id, `${type}_message`) ?? DEFAULT_MESSAGES[type];
  const channel = await member.client.channels.fetch(channelId);

  // Welcome messages get the image card. If the image fails, the text is still sent.
  const files = [];
  if (type === 'welcome') {
    try {
      files.push(await renderWelcomeCard(member));
    } catch (err) {
      console.error(`Welcome image failed in ${member.guild.name}:`, err.message);
    }
  }

  // Only allow user pings, so a member named "@everyone" can't ping the whole server
  await channel.send({ content: formatGreeting(template, member), files, allowedMentions: { parse: ['users'] } });
  return true;
}

module.exports = { DEFAULT_MESSAGES, formatGreeting, sendGreeting };
