const { MessageFlags } = require('discord.js');

// The bot owner = the user whose ID is OWNER_ID in .env
const isOwner = (user) => Boolean(process.env.OWNER_ID) && user.id === process.env.OWNER_ID;

// For owner-only commands and buttons: replies privately and returns true if this isn't the owner
async function refuseNonOwner(interaction) {
  if (isOwner(interaction.user)) return false;
  if (!process.env.OWNER_ID) console.warn('OWNER_ID is not set in .env, so nobody can use the owner-only commands.');
  await interaction.reply({ content: 'Only the bot owner can use this.', flags: MessageFlags.Ephemeral });
  return true;
}

// DMs the owner. Throws if OWNER_ID isn't set or the DM fails (each caller decides what to do then).
async function dmOwner(client, message) {
  if (!process.env.OWNER_ID) throw new Error('OWNER_ID is not set in .env');
  const owner = await client.users.fetch(process.env.OWNER_ID);
  return owner.send(message);
}

module.exports = { isOwner, refuseNonOwner, dmOwner };
