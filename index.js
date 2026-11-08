const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const express = require('express');

// Serveur web pour garder le bot éveillé sur Render
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot bankiozi actif 🚀'));
app.listen(PORT, () => console.log(`🌍 Serveur anti-sleep démarré sur le port ${PORT}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

let db;
const CREATOR_NAME = "bankiozi";

async function initDB() {
  db = await open({ filename: './database.sqlite', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (userId TEXT, guildId TEXT, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 0, PRIMARY KEY (userId, guildId));
    CREATE TABLE IF NOT EXISTS config (guildId TEXT PRIMARY KEY, notifChannelId TEXT);
    CREATE TABLE IF NOT EXISTS locked_voices (channelId TEXT PRIMARY KEY, ownerId TEXT, sanctionType TEXT);
    CREATE TABLE IF NOT EXISTS allowed_members (channelId TEXT, userId TEXT, PRIMARY KEY (channelId, userId));
    CREATE TABLE IF NOT EXISTS blacklisted_members (channelId TEXT, userId TEXT, PRIMARY KEY (channelId, userId));
  `);
  console.log("📂 Base de données connectée avec succès !");
}

async function checkAndApplyLevelRoles(member, newLevel, channel) {
  if (!member || !member.guild) return;
  const roleMap = { 10: 'Novice des messages', 30: 'Avancé des messages', 50: 'Semi-Pro message', 80: 'Légendaire des messages', 100: 'Légende du message' };
  const allRoles = Object.values(roleMap);
  const rolesToRemove = member.roles.cache.filter(r => allRoles.includes(r.name));

  let targetName = null;
  for (const [lvl, name] of Object.entries(roleMap)) {
    if (newLevel >= parseInt(lvl)) targetName = name;
  }

  let targetRole = targetName ? member.guild.roles.cache.find(r => r.name === targetName) : null;
  if (targetName && !targetRole) {
    try { targetRole = await member.guild.roles.create({ name: targetName, color: '#5865F2' }); } catch (e) {}
  }

  try {
    for (const r of rolesToRemove.values()) {
      if (!targetRole || r.id !== targetRole.id) await member.roles.remove(r).catch(() => {});
    }
    if (targetRole && !member.roles.cache.has(targetRole.id)) await member.roles.add(targetRole).catch(() => {});
  } catch (e) {}

  if (channel) {
    const embed = new EmbedBuilder()
      .setColor('#00FFCC')
      .setTitle('🎉 Montée de Niveau !')
      .setDescription(`Félicitations <@${member.id}>, tu passes au **niveau ${newLevel}** ! 🚀`)
      .setFooter({ text: `Créateur : ${CREATOR_NAME}` })
      .setTimestamp();
    channel.send({ embeds: [embed] }).catch(() => {});
  }
}

const commands = [
  new SlashCommandBuilder().setName('rank').setDescription('Afficher ton profil et ta progression XP'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Afficher le classement des membres du serveur'),
  new SlashCommandBuilder().setName('setsalon').setDescription('Définir le salon des annonces (Admin)').addChannelOption(o => o.setName('salon').setDescription('Salon cible').setRequired(true)),
  new SlashCommandBuilder().setName('addxp').setDescription('Ajouter de l’XP à un membre (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(o => o.setName('montant').setDescription('Quantité d’XP').setRequired(true)),
  new SlashCommandBuilder().setName('setlevel').setDescription('Modifier le niveau d’un membre (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(o => o.setName('niveau').setDescription('Niveau').setRequired(true)),
  new SlashCommandBuilder().setName('resetlevel').setDescription('Réinitialiser le niveau d’un membre (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)),
  new SlashCommandBuilder().setName('menu').setDescription('Panneau de gestion centralisé').addSubcommand(sub =>
    sub.setName('vocal').setDescription('Gérer la sécurité de tes salons vocaux (Niveau 100+)')
  )
].map(c => c.toJSON());

client.once('ready', async () => {
  await initDB();
  console.log(`🤖 Bot connecté : ${client.user.tag}`);
  
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("🔄 Commandes Slash enregistrées avec succès !");
  } catch (e) {
    console.error("❌ Erreur enregistrement commandes :", e);
  }
  
  client.user.setPresence({ activities: [{ name: '/menu vocal | Sécurité 🛡️', type: 0 }], status: 'online' });
});

// --- GESTION DES MESSAGES (XP) ---
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;
  const userId = message.author.id;
  const guildId = message.guild.id;

  let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);

  if (!user) {
    await db.run(`INSERT INTO users (userId, guildId, xp, level) VALUES (?, ?, 10, 0)`, [userId, guildId]);
  } else {
    let newXp = user.xp + 10;
    let newLevel = user.level;
    let xpNeeded = 100 + (newLevel * 25);
    let config = await db.get(`SELECT * FROM config WHERE guildId = ?`, [guildId]);
    let targetChannel = config && config.notifChannelId ? message.guild.channels.cache.get(config.notifChannelId) : message.channel;

    while (newXp >= xpNeeded) {
      newXp -= xpNeeded;
      newLevel += 1;
      xpNeeded = 100 + (newLevel * 25);
      await checkAndApplyLevelRoles(message.member, newLevel, targetChannel);
    }
    await db.run(`UPDATE users SET xp = ?, level = ? WHERE userId = ? AND guildId = ?`, [newXp, newLevel, userId, guildId]);
  }
});

// --- SURVEILLANCE VOCALE ET SANCTIONS ---
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!newState.channelId || newState.member.user.bot) return;
  const channelId = newState.channelId;
  const member = newState.member;

  const blacklisted = await db.get(`SELECT * FROM blacklisted_members WHERE channelId = ? AND userId = ?`, [channelId, member.id]);
  if (blacklisted) {
    try { await member.voice.disconnect("Tu es blacklisté de ce salon vocal"); } catch (e) {}
    return;
  }

  const lock = await db.get(`SELECT * FROM locked_voices WHERE channelId = ?`, [channelId]);
  if (!lock) return;

  if (member.id === lock.ownerId) return;
  const allowed = await db.get(`SELECT * FROM allowed_members WHERE channelId = ? AND userId = ?`, [channelId, member.id]);
  if (allowed) return;

  try {
    await member.voice.disconnect("Salon vocal sécurisé et verrouillé");
    if (lock.sanctionType === 'timeout') {
      await member.timeout(60 * 1000, "Tentative d'accès non autorisée à un salon vocal verrouillé");
    }
  } catch (e) {}
});

// --- GESTION DES INTERACTIONS (CORRIGÉE ET BLINDÉE) ---
client.on('interactionCreate', async interaction => {
  try {
    if (!interaction.isChatInputCommand() && !interaction.isStringSelectMenu()) return;

    const guildId = interaction.guild ? interaction.guild.id : null;
    const userId = interaction.user.id;

    if (interaction.isChatInputCommand()) {
      const { commandName, options } = interaction;

      if (commandName === 'menu' && options.getSubcommand() === 'vocal') {
        let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);
        const currentLevel = user ? user.level : 0;

        if (currentLevel < 100) {
          const embed = new EmbedBuilder()
            .setColor('#E74C3C')
            .setTitle('⛔ Accès Restreint')
            .setDescription(`Il te faut être minimum **niveau 100** pour utiliser le panneau vocal.\nTon niveau actuel : **${currentLevel}** 📊`)
            .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
          return await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setColor('#3498DB')
          .setTitle('🛡️ Centre de Contrôle Vocal Sécurisé')
          .setDescription('Sélectionne l\'action de sécurité que tu souhaites exécuter via le menu déroulant ci-dessous :')
          .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('vocal_menu_select')
            .setPlaceholder('Choisis une option de gestion...')
            .addOptions([
              { label: 'Verrouiller (Kick instantané)', description: 'Sécuriser une vocale', value: 'lock_kick', emoji: '🔒' },
              { label: 'Verrouiller (Kick + Timeout)', description: 'Sécuriser une vocale avec sanction', value: 'lock_timeout', emoji: '⚡' },
              { label: 'Whitelist (Autoriser un membre)', description: 'Donner l’accès à un ami sur ta vocale', value: 'whitelist_add', emoji: '✅' },
              { label: 'Blacklist (Bannir un membre de ta vocale)', description: 'Interdire l’accès à quelqu’un', value: 'blacklist_add', emoji: '⛔' },
              { label: 'Rendre public (VPU)', description: 'Retirer le verrouillage de ton salon', value: 'make_public', emoji: '🔓' }
            ])
        );

        return await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }

      const adminCommands = ['setsalon', 'addxp', 'setlevel', 'resetlevel'];
      if (adminCommands.includes(commandName)) {
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || userId === interaction.guild.ownerId;
        if (!isAdmin) {
          return await interaction.reply({ content: '❌ **Sécurité :** Accès refusé. Réservé aux administrateurs.', ephemeral: true });
        }
      }

      if (commandName === 'rank') {
        let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]) || { xp: 0, level: 0 };
        let xpNeeded = 100 + (user.level * 25);
        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle(`📊 Profil de ${interaction.user.username}`)
          .setThumbnail(interaction.user.displayAvatarURL())
          .addFields(
            { name: 'Niveau Actuel', value: `**${user.level}**`, inline: true },
            { name: 'Progression XP', value: `**${user.xp} / ${xpNeeded}**`, inline: true }
          )
          .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
        return await interaction.reply({ embeds: [embed] });
      } else if (commandName === 'leaderboard') {
        const top = await db.all(`SELECT * FROM users WHERE guildId = ? ORDER BY level DESC, xp DESC LIMIT 5`, [guildId]);
        let desc = top && top.length > 0 ? top.map((u, i) => `**#${i + 1}** <@${u.userId}> — Niveau **${u.level}**`).join('\n') : 'Aucun classement disponible.';
        const embed = new EmbedBuilder()
          .setColor('#FFD700')
          .setTitle('🏆 Classement Global du Serveur')
          .setDescription(desc)
          .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
        return await interaction.reply({ embeds: [embed] });
      } else if (commandName === 'setsalon') {
        const channel = options.getChannel('salon');
        await db.run(`INSERT OR REPLACE INTO config (guildId, notifChannelId) VALUES (?, ?)`, [guildId, channel.id]);
        return await interaction.reply({ content: `✅ Salon des notifications défini sur <#${channel.id}> !`, ephemeral: true });
      } else if (commandName === 'addxp') {
        const target = options.getUser('membre');
        const amount = options.getInteger('montant');
        let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [target.id, guildId]) || { xp: 0, level: 0 };
        let newXp = user.xp + amount, newLevel = user.level, xpNeeded = 100 + (newLevel * 25);
        while (newXp >= xpNeeded) { newXp -= xpNeeded; newLevel += 1; xpNeeded = 100 + (newLevel * 25); }
        await db.run(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, ?, ?)`, [target.id, guildId, newXp, newLevel]);
        return await interaction.reply({ content: `✅ Ajout de **${amount} XP** à <@${target.id}> (Niveau : ${newLevel}).`, ephemeral: true });
      } else if (commandName === 'setlevel') {
        const target = options.getUser('membre');
        const lvl = options.getInteger('niveau');
        await db.run(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, ?)`, [target.id, guildId, lvl]);
        return await interaction.reply({ content: `✅ Niveau de <@${target.id}> fixé à **${lvl}**.`, ephemeral: true });
      } else if (commandName === 'resetlevel') {
        const target = options.getUser('membre');
        await db.run(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, 0)`, [target.id, guildId]);
        return await interaction.reply({ content: `✅ Progression de <@${target.id}> réinitialisée.`, ephemeral: true });
      }
    }

    else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'vocal_menu_select') {
        const choice = interaction.values[0];
        const memberVoice = interaction.member.voice.channel;

        if (!memberVoice && choice !== 'make_public') {
          return await interaction.reply({ content: `❌ **Erreur :** Tu dois être connecté dans un salon vocal pour effectuer cette action.`, ephemeral: true });
        }

        if (choice === 'lock_kick' || choice === 'lock_timeout') {
          const sanctionType = choice === 'lock_kick' ? 'kick' : 'timeout';
          await db.run(`INSERT OR REPLACE INTO locked_voices (channelId, ownerId, sanctionType) VALUES (?, ?, ?)`, [memberVoice.id, userId, sanctionType]);
          
          const embed = new EmbedBuilder()
            .setColor('#E67E22')
            .setTitle('🔒 Salon Vocal Verrouillé')
            .setDescription(`Le salon **${memberVoice.name}** est sécurisé.\n• Sanction : **${sanctionType === 'timeout' ? 'Kick + Timeout 1 min' : 'Kick instantané'}**`)
            .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
          return await interaction.update({ embeds: [embed], components: [] });
        }

        if (choice === 'whitelist_add' || choice === 'blacklist_add') {
          const lock = await db.get(`SELECT * FROM locked_voices WHERE channelId = ?`, [memberVoice.id]);
          if (!lock || lock.ownerId !== userId) {
            return await interaction.reply({ content: `❌ **Refusé :** Tu ne possèdes pas de verrouillage actif sur ton salon vocal.`, ephemeral: true });
          }

          const membersInVoice = memberVoice.members.filter(m => m.id !== userId);
          if (membersInVoice.size === 0) {
            return await interaction.reply({ content: `❌ Aucun autre membre n'est présent dans ton salon vocal.`, ephemeral: true });
          }

          const selectMenuId = choice === 'whitelist_add' ? 'whitelist_member_select' : 'blacklist_member_select';
          const selectMember = new StringSelectMenuBuilder()
            .setCustomId(selectMenuId)
            .setPlaceholder('Sélectionne le membre...')
            .addOptions(membersInVoice.map(m => ({ label: m.user.username.slice(0, 25), value: m.id })));

          const row = new ActionRowBuilder().addComponents(selectMember);
          const embed = new EmbedBuilder()
            .setColor(choice === 'whitelist_add' ? '#2ECC71' : '#E74C3C')
            .setTitle(choice === 'whitelist_add' ? '✅ Gestion de la Whitelist' : '⛔ Gestion de la Blacklist')
            .setDescription('Sélectionne le membre concerné :');
          return await interaction.update({ embeds: [embed], components: [row] });
        }

        if (choice === 'make_public') {
          const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || userId === interaction.guild.ownerId;
          let locks = isAdmin ? await db.all(`SELECT * FROM locked_voices`) : await db.all(`SELECT * FROM locked_voices WHERE ownerId = ?`, [userId]);

          if (!locks || locks.length === 0) {
            return await interaction.reply({ content: `❌ Aucun salon verrouillé sous ton contrôle n'a été trouvé.`, ephemeral: true });
          }

          const selectVoice = new StringSelectMenuBuilder()
            .setCustomId('public_voice_select')
            .setPlaceholder('Sélectionne le salon à rendre public...')
            .addOptions(locks.map(l => ({ label: `Salon ID: ${l.channelId.slice(0, 15)}`, value: l.channelId })));

          const row = new ActionRowBuilder().addComponents(selectVoice);
          const embed = new EmbedBuilder().setColor('#2ECC71').setTitle('🔓 Rendre un salon Public (VPU)').setDescription('Sélectionne le salon vocal à déverrouiller :');
          return await interaction.update({ embeds: [embed], components: [row] });
        }
      }

      if (interaction.customId === 'whitelist_member_select') {
        const targetUserId = interaction.values[0];
        const memberVoice = interaction.member.voice.channel;
        if (!memberVoice) return await interaction.reply({ content: `❌ Action expirée.`, ephemeral: true });

        await db.run(`INSERT OR IGNORE INTO allowed_members (channelId, userId) VALUES (?, ?)`, [memberVoice.id, targetUserId]);
        const embed = new EmbedBuilder().setColor('#2ECC71').setTitle('✅ Membre Whitelisté').setDescription(`Le membre <@${targetUserId}> a été autorisé à rejoindre ta vocale.`);
        return await interaction.update({ embeds: [embed], components: [] });
      }

      if (interaction.customId === 'blacklist_member_select') {
        const targetUserId = interaction.values[0];
        const memberVoice = interaction.member.voice.channel;
        if (!memberVoice) return await interaction.reply({ content: `❌ Action expirée.`, ephemeral: true });

        await db.run(`INSERT OR IGNORE INTO blacklisted_members (channelId, userId) VALUES (?, ?)`, [memberVoice.id, targetUserId]);
        
        try {
          const targetMember = await interaction.guild.members.fetch(targetUserId);
          if (targetMember && targetMember.voice.channelId === memberVoice.id) {
            await targetMember.voice.disconnect("Tu es blacklisté de ce salon vocal");
          }
        } catch (e) {}

        const embed = new EmbedBuilder().setColor('#E74C3C').setTitle('⛔ Membre Blacklisté').setDescription(`Le membre <@${targetUserId}> a été banni de ton salon vocal.`);
        return await interaction.update({ embeds: [embed], components: [] });
      }

      if (interaction.customId === 'public_voice_select') {
        const channelIdToUnlock = interaction.values[0];
        const lock = await db.get(`SELECT * FROM locked_voices WHERE channelId = ?`, [channelIdToUnlock]);
        if (!lock) return await interaction.reply({ content: `❌ Ce salon n'est plus verrouillé.`, ephemeral: true });

        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || userId === interaction.guild.ownerId;
        if (lock.ownerId !== userId && !isAdmin) {
          return await interaction.reply({ content: `❌ **Sécurité :** Tu n'es pas le propriétaire et tu n'es pas admin.`, ephemeral: true });
        }

        await db.run(`DELETE FROM locked_voices WHERE channelId = ?`, [channelIdToUnlock]);
        await db.run(`DELETE FROM allowed_members WHERE channelId = ?`, [channelIdToUnlock]);
        await db.run(`DELETE FROM blacklisted_members WHERE channelId = ?`, [channelIdToUnlock]);

        const embed = new EmbedBuilder().setColor('#2ECC71').setTitle('🔓 Salon Public (VPU)').setDescription(`Le salon vocal a été rendu public av
