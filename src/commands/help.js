const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  InteractionContextType, MessageFlags, ApplicationCommandOptionType: T, PermissionsBitField,
} = require('discord.js');
const { LOG_TYPES } = require('../logs');
const { levelingEnabled } = require('../leveling');
const { automodEnabled } = require('../automod');

const KICK_URL = 'https://kick.com/mamadpoker';
const COLOR = 0x53fc18;
const FOOTER = { text: 'Only commands you can use are shown.' };

// Command descriptions and options come from the commands themselves; categories, tips and examples live here.
const CATEGORIES = [
  { id: 'general', emoji: '🔧', name: 'General', about: 'Check the bot and get help', commands: ['ping', 'help'] },
  {
    id: 'kick', emoji: '🟢', name: 'Kick alerts', about: 'Post an alert when a Kick channel goes live', commands: ['live'],
    notes: 'The bot checks Kick every minute and posts one alert per stream (title, category, thumbnail, link), with an optional role ping.',
  },
  {
    id: 'welcome', emoji: '👋', name: 'Welcome', about: 'Welcome & goodbye messages with a picture card', commands: ['welcome', 'goodbye'],
    notes: [
      '**Variables** you can use in `set-message`:',
      '`{user}` mentions the member',
      '`{username}` their username',
      '`{server}` the server name',
      '`{count}` the member count',
      '`\\n` starts a new line',
      'Welcome messages also get a picture card (the member\'s avatar on a blurred background). Use `/welcome set-background` to use your own picture instead.',
    ].join('\n'),
  },
  {
    id: 'autorole', emoji: '🎭', name: 'Auto-role', about: 'Give new members a role automatically', commands: ['autorole'],
    notes: 'My role must be above the auto-role in Server Settings → Roles. Bots don\'t get it, and if your server has rules screening, members get it after accepting the rules.',
  },
  {
    id: 'moderation', emoji: '🔨', name: 'Moderation', about: 'Ban, kick, time out and clear messages', commands: ['ban', 'kick', 'timeout', 'clear'],
    notes: 'You can\'t act on members whose top role is equal to or higher than yours. The member gets a DM with the reason, and every action is logged.',
  },
  {
    id: 'logs', emoji: '📜', name: 'Logs', about: 'Log server events, one channel per event type', commands: ['log'],
    notes: `\`/log setup\` links channels that already have these names, or creates them in a private **LOGs** category:\n${LOG_TYPES.map((t) => `\`${t}\``).join(' ')}`,
  },
  {
    id: 'leveling', emoji: '⭐', name: 'Leveling', about: 'Earn XP by chatting, /rank and /leaderboard', commands: ['rank', 'leaderboard', 'level'],
    isOff: (guildId) => !levelingEnabled(guildId),
    notes: 'Off by default: an admin turns it on with `/level enable`. Members earn 15–25 XP per message, at most once a minute.',
  },
  {
    id: 'automod', emoji: '🚫', name: 'Auto-mod', about: 'Delete bad words and invite links', commands: ['automod'],
    isOff: (guildId) => !automodEnabled(guildId),
    notes: 'Off by default: an admin turns it on with `/automod enable`. Moderators (Manage Messages) are never filtered. In `add-word`, `*` matches any letters: `bad*` also blocks "badly".',
  },
];

const EXAMPLES = {
  'ping': '/ping',
  'help': '/help command:welcome',
  'live add': '/live add channel:mamadpoker',
  'live remove': '/live remove channel:mamadpoker',
  'live set-channel': '/live set-channel channel:#live-alerts',
  'live set-role': '/live set-role role:@Live',
  'live list': '/live list',
  'welcome set-channel': '/welcome set-channel channel:#welcome',
  'welcome set-message': '/welcome set-message message:{user} به سرور {server} خوش آمدی 🌹',
  'welcome test': '/welcome test',
  'welcome disable': '/welcome disable',
  'welcome set-background': '/welcome set-background image:(upload a picture)',
  'goodbye set-channel': '/goodbye set-channel channel:#goodbye',
  'goodbye set-message': '/goodbye set-message message:**{username}** left us. We are now {count}.',
  'goodbye test': '/goodbye test',
  'goodbye disable': '/goodbye disable',
  'autorole set': '/autorole set role:@Member',
  'autorole off': '/autorole off',
  'ban': '/ban user:@spammer reason:Spam links delete-messages:Last 24 hours',
  'kick': '/kick user:@someone reason:Breaking the rules',
  'timeout': '/timeout user:@someone duration:10 minutes reason:Calm down',
  'clear': '/clear amount:20 user:@spammer',
  'log set': '/log set event:ban-logger channel:#ban-logger',
  'log setup': '/log setup',
  'log list': '/log list',
  'rank': '/rank user:@friend',
  'leaderboard': '/leaderboard',
  'level enable': '/level enable',
  'level disable': '/level disable',
  'automod enable': '/automod enable',
  'automod disable': '/automod disable',
  'automod add-word': '/automod add-word word:bad*',
  'automod remove-word': '/automod remove-word word:bad*',
  'automod invite-filter': '/automod invite-filter enabled:True',
  'automod status': '/automod status',
};

const OPTION_TYPES = { [T.String]: 'text', [T.Integer]: 'number', [T.Boolean]: 'true/false', [T.User]: 'user', [T.Channel]: 'channel', [T.Role]: 'role', [T.Attachment]: 'file' };
const PERMISSION_NAMES = { ManageGuild: 'Admin only (Manage Server)', ModerateMembers: 'Timeout Members' };

function permissionText(json) {
  if (!json.default_member_permissions) return '✅ Everyone';
  const names = new PermissionsBitField(BigInt(json.default_member_permissions)).toArray();
  return `🔒 ${names.map((p) => PERMISSION_NAMES[p] ?? p.replace(/([a-z])([A-Z])/g, '$1 $2')).join(', ')}`;
}

const canUse = (interaction, command) => {
  const needed = command.data.toJSON().default_member_permissions;
  return !needed || interaction.memberPermissions.has(BigInt(needed));
};

// One field per command (or per subcommand): what it does, its options, an example
function commandFields(command) {
  const json = command.data.toJSON();
  const subs = (json.options ?? []).filter((o) => o.type === T.Subcommand);
  const entries = subs.length ? subs.map((s) => [`${json.name} ${s.name}`, s]) : [[json.name, json]];
  return entries.map(([path, cmd]) => {
    const options = (cmd.options ?? []).map((o) => {
      const kind = o.choices ? 'pick one' : OPTION_TYPES[o.type];
      const choices = !o.choices ? '' : o.choices.length > 10 ? ` (${o.choices.length} choices)` : `: ${o.choices.map((c) => c.name).join(', ')}`;
      return `• \`${o.name}\` (${kind}, ${o.required ? 'required' : 'optional'}): ${o.description}${choices}`;
    });
    const example = EXAMPLES[path] ?? `/${path}${(cmd.options ?? []).filter((o) => o.required).map((o) => ` ${o.name}:…`).join('')}`;
    return {
      name: `/${path}  ·  ${permissionText(json)}`,
      value: [cmd.description, ...options, `**Example:** \`${example}\``].join('\n').slice(0, 1024),
    };
  });
}

// The categories this person can see, each with only the commands they can use
function visibleCategories(interaction) {
  const { commands } = interaction.client;
  const listed = CATEGORIES.flatMap((c) => c.commands);
  const other = { id: 'other', emoji: '📦', name: 'Other', about: 'Other commands', commands: [...commands.keys()].filter((n) => !listed.includes(n)) };
  return [...CATEGORIES, other]
    .map((c) => ({ ...c, commands: c.commands.map((n) => commands.get(n)).filter((cmd) => cmd && canUse(interaction, cmd)) }))
    .filter((c) => c.commands.length);
}

const offLabel = (category, guildId) => (category.isOff?.(guildId) ? ' (off on this server)' : '');

function components(categories, current) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('help:category')
    .setPlaceholder('Pick a category')
    .addOptions(
      { label: 'Main page', value: 'home', emoji: { name: '🏠' }, default: current === 'home' },
      ...categories.map((c) => ({ label: c.name, value: c.id, emoji: { name: c.emoji }, description: c.about, default: current === c.id })),
    );
  const kick = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Watch MamadPoker on Kick').setURL(KICK_URL);
  return [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(kick)];
}

function mainPage(interaction) {
  const categories = visibleCategories(interaction);
  const lines = categories.map((c) => `${c.emoji} **${c.name}**${offLabel(c, interaction.guildId)}: ${c.about}`);
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('MP Bot help')
    .setDescription([
      '**MP Bot**, made by **MamadPoker**.',
      'Pick a category from the menu below to see its commands, or use `/help command:<name>` for one command.',
      '',
      ...lines,
    ].join('\n'))
    .setFooter(FOOTER);
  return { embeds: [embed], components: components(categories, 'home') };
}

function categoryPage(interaction, id) {
  const categories = visibleCategories(interaction);
  const category = categories.find((c) => c.id === id);
  if (!category) return mainPage(interaction);
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`${category.emoji} ${category.name}${offLabel(category, interaction.guildId)}`)
    .setDescription([category.about, category.notes].filter(Boolean).join('\n\n'))
    .addFields(category.commands.flatMap(commandFields))
    .setFooter(FOOTER);
  return { embeds: [embed], components: components(categories, id) };
}

// Detailed help for one command, or null if it doesn't exist or this person can't use it
function commandPage(interaction, name) {
  const categories = visibleCategories(interaction);
  const category = categories.find((c) => c.commands.some((cmd) => cmd.data.name === name));
  if (!category) return null;
  const command = category.commands.find((cmd) => cmd.data.name === name);
  const json = command.data.toJSON();
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`/${name}`)
    .setDescription([
      json.description,
      `**Category:** ${category.emoji} ${category.name}${offLabel(category, interaction.guildId)}`,
      `**Who can use it:** ${permissionText(json)}`,
      category.notes,
    ].filter(Boolean).join('\n\n'))
    .addFields(commandFields(command))
    .setFooter(FOOTER);
  return { embeds: [embed], components: components(categories, null) };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show the commands you can use')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('command').setDescription('Get detailed help for one command').setAutocomplete(true)),

  async execute(interaction) {
    // "/Live add" -> "live"
    const name = interaction.options.getString('command')?.trim().toLowerCase().replace(/^\//, '').split(/\s+/)[0];
    if (!name) return interaction.reply({ ...mainPage(interaction), flags: MessageFlags.Ephemeral });
    const page = commandPage(interaction, name);
    if (!page) {
      return interaction.reply({ content: `❌ There's no command called \`/${name}\` that you can use. Run \`/help\` to see your commands.`, flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ ...page, flags: MessageFlags.Ephemeral });
  },

  // Suggest only the commands this person can use
  async autocomplete(interaction) {
    const typed = interaction.options.getFocused().toLowerCase().replace(/^\//, '');
    const names = visibleCategories(interaction).flatMap((c) => c.commands.map((cmd) => cmd.data.name));
    await interaction.respond(names.filter((n) => n.includes(typed)).slice(0, 25).map((n) => ({ name: `/${n}`, value: n })));
  },

  // A category was picked from the menu: show that page in the same (private) message
  async handleComponent(interaction) {
    const [picked] = interaction.values;
    await interaction.update(picked === 'home' ? mainPage(interaction) : categoryPage(interaction, picked));
  },
};
