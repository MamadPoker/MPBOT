const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType,
  PermissionFlagsBits: P, InteractionContextType, MessageFlags,
} = require('discord.js');
const { db, getSetting, setSetting } = require('../db');

const CHANNEL_NAME = 'get-roles';
const ABOUT = 'Click a button to get a role. Click it again to remove it.';
const COLOR = 0x5865f2;
const RERUN = 'then run `/rolemenu setup` again';

// The 3 menus: [role name, button emoji, role color]. Each menu is single-choice.
const MENUS = [
  {
    id: 'colors', title: 'Colors', roles: [
      ['Black', '🖤', 0x010101], // 0x000000 means "no color" in Discord
      ['Red', '❤️', 0xff0000], ['Blue', '💙', 0x1e90ff], ['Silver', '🩶', 0xc0c0c0], ['Orange', '🧡', 0xffa500],
      ['Cyan', '🩵', 0x00ffff], ['Pink', '🩷', 0xff69b4], ['Yellow', '💛', 0xffff00], ['Green', '💚', 0x32cd32], ['Purple', '💜', 0x9370db],
    ],
  },
  { id: 'age', title: 'Age', roles: [['13-15', '1️⃣'], ['16-18', '2️⃣'], ['19-21', '3️⃣'], ['22-24', '4️⃣'], ['25-27', '5️⃣'], ['28-30', '6️⃣']] },
  { id: 'gender', title: 'Gender', roles: [['Male', '🙋‍♂️'], ['Female', '🙋‍♀️'], ['Other', '👤']] },
].map((menu) => ({ ...menu, roles: menu.roles.map(([name, emoji, color]) => ({ name, emoji, color })) }));

const savedRoleId = (guildId, menu, name) =>
  db.prepare('SELECT role_id FROM rolemenu_roles WHERE guild_id = ? AND menu = ? AND name = ?').get(guildId, menu, name)?.role_id;
const saveRoleId = (guildId, menu, name, roleId) => db.prepare(`
  INSERT INTO rolemenu_roles (guild_id, menu, name, role_id) VALUES (?, ?, ?, ?)
  ON CONFLICT (guild_id, menu, name) DO UPDATE SET role_id = excluded.role_id
`).run(guildId, menu, name, roleId);

// The saved role, else an existing role with the same name (never a duplicate), else none (= create it)
const findRole = (guild, menu, name) => guild.roles.cache.get(savedRoleId(guild.id, menu.id, name))
  ?? guild.roles.cache.find((r) => !r.managed && r.name.toLowerCase() === name.toLowerCase());

// One embed with buttons in even rows (max 5 per row): 10 -> 5+5, 6 -> 3+3, 3 -> 3
function menuMessage(menu) {
  const buttons = menu.roles.map((r) =>
    new ButtonBuilder().setCustomId(`rolemenu:${menu.id}:${r.name}`).setLabel(r.name).setEmoji(r.emoji).setStyle(ButtonStyle.Secondary));
  const perRow = Math.ceil(buttons.length / Math.ceil(buttons.length / 5));
  const rows = [];
  for (let i = 0; i < buttons.length; i += perRow) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + perRow)));
  return { embeds: [new EmbedBuilder().setColor(COLOR).setTitle(menu.title).setDescription(ABOUT)], components: rows };
}

// Puts `roles` (top to bottom) right below the bot's highest role, so a member's color role shows over their other roles
async function placeBelowMe(guild, roles) {
  const top = () => guild.members.me.roles.highest;
  const below = [...guild.roles.cache.filter((r) => r.position < top().position).sort((a, b) => b.position - a.position).keys()];
  if (below.slice(0, roles.length).join() === roles.map((r) => r.id).join()) return; // already in place
  for (const role of [...roles].reverse()) await role.setPosition(top().position - 1);
}

async function setup(interaction) {
  const { guild } = interaction;
  const me = guild.members.me;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // creating roles and messages takes a while
  const fail = (text) => interaction.editReply(`❌ ${text}`);

  // ---- 1. Check everything first, so nothing is left half done ----
  const missing = [[P.ManageRoles, 'Manage Roles'], [P.ManageChannels, 'Manage Channels']]
    .filter(([perm]) => !me.permissions.has(perm)).map(([, name]) => `**${name}**`);
  if (missing.length) {
    return fail(`I need the ${missing.join(' and ')} permission${missing.length > 1 ? 's' : ''}. `
      + `Give it to my role in Server Settings → Roles, ${RERUN}.`);
  }
  if (me.roles.highest.id === guild.id) return fail(`I don't have a role of my own, so I can't give roles. Give me a role, ${RERUN}.`);

  const saved = getSetting(guild.id, 'rolemenu_channel');
  // By saved id first, so it's still found after an admin renames or moves it
  let channel = (saved && (await guild.channels.fetch(saved).catch(() => null)))
    || (await guild.channels.fetch()).find((c) => c.type === ChannelType.GuildText && c.name === CHANNEL_NAME);
  if (channel && !channel.permissionsFor(me).has([P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory])) {
    return fail(`I can't post in ${channel}. Give me View Channel, Send Messages, Embed Links and Read Message History there, ${RERUN}.`);
  }

  const tooHigh = MENUS.flatMap((menu) => menu.roles.map((r) => findRole(guild, menu, r.name))).filter((role) => role && !role.editable);
  if (tooHigh.length) {
    return fail(`My role **${me.roles.highest.name}** must be above these roles: ${tooHigh.map((r) => r.name).join(', ')}. `
      + `Drag it higher in Server Settings → Roles, ${RERUN}.`);
  }

  // ---- 2. The channel: everyone can read it, only the bot can post. An existing one isn't moved. ----
  const category = interaction.options.getChannel('category');
  const channelCreated = !channel;
  channel ??= await guild.channels.create({
    name: CHANNEL_NAME,
    type: ChannelType.GuildText,
    ...(category ? { parent: category.id } : { position: 0 }), // no category: at the top of the channel list
    permissionOverwrites: [
      {
        id: guild.roles.everyone,
        allow: [P.ViewChannel, P.ReadMessageHistory],
        deny: [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads],
      },
      { id: me, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory] },
    ],
    reason: 'Role menu (/rolemenu setup)',
  });
  setSetting(guild.id, 'rolemenu_channel', channel.id);

  // ---- 3. The roles: no permissions, not shown separately, not mentionable ----
  let rolesCreated = 0;
  for (const menu of MENUS) {
    for (const r of menu.roles) {
      let role = findRole(guild, menu, r.name);
      if (!role) {
        role = await guild.roles.create({
          name: r.name, permissions: [], hoist: false, mentionable: false, reason: 'Role menu (/rolemenu setup)',
          ...(r.color && { colors: { primaryColor: r.color } }),
        });
        rolesCreated++;
      }
      saveRoleId(guild.id, menu.id, r.name, role.id);
    }
  }
  const colors = MENUS[0];
  await placeBelowMe(guild, colors.roles.map((r) => findRole(guild, colors, r.name)));

  // ---- 4. The 3 menu messages: kept if they're still there (updated), posted again if deleted ----
  let posted = 0;
  for (const menu of MENUS) {
    const key = `rolemenu_message:${menu.id}`;
    const old = getSetting(guild.id, key);
    const message = old && (await channel.messages.fetch(old).catch(() => null));
    if (message) {
      await message.edit(menuMessage(menu));
    } else {
      setSetting(guild.id, key, (await channel.send(menuMessage(menu))).id);
      posted++;
    }
  }

  const total = MENUS.reduce((n, menu) => n + menu.roles.length, 0);
  return interaction.editReply([
    `✅ The role menu is ready in ${channel}.`,
    `• Channel: ${channelCreated ? 'created' : 'already there'}`,
    `• Roles: ${rolesCreated} created, ${total - rolesCreated} already there`,
    `• Menus: ${posted} posted, ${MENUS.length - posted} already there`,
  ].join('\n'));
}

// A button click: "rolemenu:<menu>:<role name>". Works after restarts: the role ids come from the database.
async function handleComponent(interaction) {
  const [, menuId, name] = interaction.customId.split(':');
  const menu = MENUS.find((m) => m.id === menuId);
  if (!menu || !interaction.inGuild()) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { guild, member } = interaction;

  const role = guild.roles.cache.get(savedRoleId(guild.id, menuId, name));
  if (!role) return interaction.editReply(`❌ The **${name}** role doesn't exist anymore. Ask an admin to run \`/rolemenu setup\` again.`);

  try {
    // Clicking the role you already have removes it
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, 'Role menu');
      return interaction.editReply(`❌ Removed ${role.name}`);
    }
    // Single-choice: your other role from this menu is removed
    const others = menu.roles.map((r) => savedRoleId(guild.id, menuId, r.name)).filter((id) => id !== role.id && member.roles.cache.has(id));
    await member.roles.add(role, 'Role menu');
    if (others.length) await member.roles.remove(others, 'Role menu');
    return interaction.editReply(`✅ You now have ${role.name}`);
  } catch (err) {
    console.error(`Role menu: could not change roles in ${guild.name}:`, err.message);
    return interaction.editReply('❌ I couldn\'t change your roles. Ask an admin to check that my role is above the role menu roles.');
  }
}

module.exports = {
  MENUS,
  data: new SlashCommandBuilder()
    .setName('rolemenu')
    .setDescription('Role buttons for colors, age and gender')
    .setDefaultMemberPermissions(P.ManageGuild) // admins only
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s.setName('setup').setDescription('Create (or repair) the #get-roles channel, its roles and the 3 role menus')
        .addChannelOption((o) =>
          o.setName('category').setDescription('Category for a new #get-roles channel (default: top of the channel list)')
            .addChannelTypes(ChannelType.GuildCategory),
        ),
    ),
  execute: setup, // setup is the only subcommand
  handleComponent,
};
