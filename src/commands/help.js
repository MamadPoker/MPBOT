const { SlashCommandBuilder, EmbedBuilder, InteractionContextType, MessageFlags, ApplicationCommandOptionType } = require('discord.js');
const { levelingEnabled } = require('../leveling');
const { automodEnabled } = require('../automod');

const CATEGORIES = [
  ['⚙️ General', ['ping', 'help']],
  ['🟢 Kick alerts', ['live']],
  ['👋 Welcome', ['welcome', 'goodbye']],
  ['🎭 Auto-role', ['autorole']],
  ['🔨 Moderation', ['ban', 'kick', 'timeout', 'clear']],
  ['📜 Logs', ['log']],
  ['⭐ Leveling', ['rank', 'leaderboard', 'level']],
  ['🛡️ Auto-mod', ['automod']],
];

// "`/live` Kick live alerts" + its subcommands on the next line
function commandLine(command) {
  const json = command.data.toJSON();
  const subs = (json.options ?? []).filter((o) => o.type === ApplicationCommandOptionType.Subcommand).map((o) => `\`${o.name}\``);
  return `\`/${json.name}\` ${json.description}${subs.length ? `\n↳ ${subs.join(' ')}` : ''}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show the commands you can use')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { commands } = interaction.client;
    // Commands without a required permission are for everyone; admins have every permission
    const canUse = (command) => {
      const needed = command.data.toJSON().default_member_permissions;
      return !needed || interaction.memberPermissions.has(BigInt(needed));
    };

    // Anything not in CATEGORIES (e.g. a command added later) still shows up
    const listed = CATEGORIES.flatMap(([, names]) => names);
    const other = [...commands.keys()].filter((name) => !listed.includes(name));
    const off = { '⭐ Leveling': !levelingEnabled(interaction.guildId), '🛡️ Auto-mod': !automodEnabled(interaction.guildId) };

    const fields = [...CATEGORIES, ['📦 Other', other]]
      .map(([category, names]) => {
        const lines = names.map((name) => commands.get(name)).filter((c) => c && canUse(c)).map(commandLine);
        return { name: off[category] ? `${category} (off on this server)` : category, value: lines.join('\n').slice(0, 1024) };
      })
      .filter((f) => f.value);

    const embed = new EmbedBuilder()
      .setColor(0x53fc18)
      .setTitle('MP Bot commands')
      .setDescription('Here are the commands you can use on this server:')
      .addFields(...fields, { name: '📺 Watch live', value: '[kick.com/mamadpoker](https://kick.com/mamadpoker)' })
      .setFooter({ text: 'Only commands you have permission to use are shown.' });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
