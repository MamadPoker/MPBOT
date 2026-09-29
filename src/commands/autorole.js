const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const { setSetting } = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autorole')
    .setDescription('Give new members a role automatically')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // admins only
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s.setName('set').setDescription('Choose the role new members get')
        .addRoleOption((o) => o.setName('role').setDescription('Role to give').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('off').setDescription('Stop giving new members a role')),

  async execute(interaction) {
    const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

    if (interaction.options.getSubcommand() === 'off') {
      setSetting(interaction.guildId, 'autorole', null);
      return reply('✅ Auto-role is off.');
    }

    const role = interaction.options.getRole('role');
    if (role.id === interaction.guildId) return reply('❌ Everyone already has @everyone. Pick another role.');
    if (role.managed) return reply(`❌ ${role} belongs to a bot or integration and can't be given out.`);
    // Safety: never hand out admin rights to strangers automatically
    if (role.permissions.has(PermissionFlagsBits.Administrator)) return reply(`❌ ${role} has Administrator. That's too dangerous for an auto-role.`);

    setSetting(interaction.guildId, 'autorole', role.id);
    // role.editable = the bot has Manage Roles AND its own role is above this one
    const warning = role.editable
      ? ''
      : `\n⚠️ I can't give this role yet. In **Server Settings → Roles**, drag my role (**${interaction.guild.members.me.roles.highest.name}**) above ${role}, and make sure it has **Manage Roles**.`;
    return reply(`✅ New members will get ${role}.${warning}`);
  },
};
