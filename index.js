const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

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
const roleSetupState = new Map(); // userId -> channelId pour le panel de niveau 120

async function initDB() {
  db = await open({ filename: './database.sqlite', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (userId TEXT, guildId TEXT, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 0, PRIMARY KEY (userId, guildId));
    CREATE TABLE IF NOT EXISTS config (guildId TEXT PRIMARY KEY, notifChannelId TEXT);
    CREATE TABLE IF NOT EXISTS custom_roles (userId TEXT PRIMARY KEY, roleId TEXT, deleted INTEGER DEFAULT 0);
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
      .setTitle('🎉 Montée de Niveau Exceptionnelle !')
      .setDescription(`Félicitations <@${member.id}>, tu viens d'atteindre le palier du **niveau ${newLevel}** ! 🚀`)
      .setFooter({ text: `Système exclusif • Créateur : ${CREATOR_NAME}` })
      .setTimestamp();
    channel.send({ embeds: [embed] }).catch(() => {});
  }

  if (newLevel === 120) {
    try {
      const guild = member.guild;
      const privateChan = await guild.channels.create({
        name: `role-${member.user.username}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ]
      });

      roleSetupState.set(member.id, privateChan.id);
      
      const embed = new EmbedBuilder()
        .setColor('#9B59B6')
        .setTitle('👑 Espace Privilège - Niveau 120 Atteint')
        .setDescription(`Bienvenue dans ton salon personnel, <@${member.id}> !\n\nTu peux dès à présent configurer ton **rôle personnalisé unique**.\n\nÉcris ton message dans ce salon en respectant strictement ce format :\n\`Pseudo | #CouleurHEX | Permission\`\n\n**Options :**\n• **M** = Mute | **D** = Déplacer | **MC** = Mute Casque | **A** = Aucune *(ou en cas de faute de frappe)*`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await privateChan.send({ embeds: [embed] });
    } catch (e) {}
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
  console.log(`Bot connecté avec succès : ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try { await rest.put(Routes.applicationCommands(client.user.id), { body: commands }); } catch (e) {}
  client.user.setPresence({ activities: [{ name: '/menu vocal | Sécurité & Rôles 🛡️', type: 0 }], status: 'online' });
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const userId = message.author.id;

  if (roleSetupState.has(userId) && message.channel.id === roleSetupState.get(userId)) {
    let existingRecord = await db.get(`SELECT * FROM custom_roles WHERE userId = ?`, [userId]);
    if (existingRecord) {
      await message.channel.send(`❌ **Action impossible :** Tu possèdes déjà un rôle personnalisé.`);
      setTimeout(() => message.channel.delete().catch(() => {}), 4000);
      roleSetupState.delete(userId);
      return;
    }

    const parts = message.content.split('|').map(p => p.trim());
    if (parts.length < 3) {
      const errEmbed = new EmbedBuilder().setColor('#E74C3C').setTitle('❌ Erreur de Format').setDescription('Format attendu :\n`Pseudo | #CouleurHEX | M, D, MC ou A`');
      return message.channel.send({ embeds: [errEmbed] });
    }

    const roleName = parts[0];
    let roleColor = parts[1];
    if (!roleColor.startsWith('#')) roleColor = '#' + roleColor;
    const permChoice = parts[2].toUpperCase();

    let rolePermissions = [];
    if (permChoice === 'M') rolePermissions.push(PermissionFlagsBits.MuteMembers);
    else if (permChoice === 'D') rolePermissions.push(PermissionFlagsBits.MoveMembers);
    else if (permChoice === 'MC') rolePermissions.push(PermissionFlagsBits.DeafenMembers);

    try {
      const createdRole = await message.guild.roles.create({
        name: roleName,
        color: roleColor,
        permissions: rolePermissions,
        reason: `Rôle exclusif niveau 120 généré par ${userId}`
      });

      await message.member.roles.add(createdRole);
      await db.run(`INSERT OR REPLACE INTO custom_roles (userId, roleId, deleted) VALUES (?, ?, 0)`, [userId, createdRole.id]);

      const successEmbed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setTitle('✨ Rôle Exclusif Créé avec Succès !')
        .setDescription(`Ton rôle **${roleName}** a été appliqué à ton profil.\n*Ce salon va s'autodétruire dans 5 secondes...*`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await message.channel.send({ embeds: [successEmbed] });
      roleSetupState.delete(userId);
      setTimeout(() => message.channel.delete().catch(() => {}), 5000);
    } catch (e) {
      await message.channel.send(`❌ **Erreur technique :** Impossible de créer le rôle (vérifie la couleur). Salon fermé.`);
      roleSetupState.delete(userId);
      setTimeout(() => message.channel.delete().catch(() => {}), 5000);
    }
    return;
  }

  if (!message.guild) return;
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

client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!newState.channelId || newState.member.user.bot) return;
  const channelId = newState.channelId;
  const member = newState.member;

  // 1. Vérifier si l'utilisateur est blacklisté de ce salon vocal précis
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

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    const guildId = interaction.guild ? interaction.guild.id : null;
    const userId = interaction.user.id;
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
        return interaction.reply({ embeds: [embed], ephemeral: true });
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

      return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    const adminCommands = ['setsalon', 'addxp', 'setlevel', 'resetlevel'];
    if (adminCommands.includes(commandName)) {
      const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || interaction.user.id === interaction.guild.ownerId;
      if (!isAdmin) {
        try { await interaction.member.timeout(60 * 1000, "Tentative d'utilisation de commande admin non autorisée"); } catch (e) {}
        return interaction.reply({ content: '❌ **Sécurité :** Accès refusé. Réservé aux administrateurs.', ephemeral: true });
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
      await interaction.reply({ embeds: [embed] });
    } else if (commandName === 'leaderboard') {
      const top = await db.all(`SELECT * FROM users WHERE guildId = ? ORDER BY level DESC, xp DESC LIMIT 5`, [guildId]);
      let desc = top && top.length > 0 ? top.map((u, i) => `**#${i + 1}** <@${u.userId}> — Niveau **${u.level}**`).join('\n') : 'Aucun classement disponible.';
      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🏆 Classement Global du Serveur')
        .setDescription(desc)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
      await interaction.reply({ embeds: [embed] });
    } else if (commandName === 'setsalon') {
      const channel = interaction.options.getChannel('salon');
      let config = await db.get(`SELECT * FROM config WHERE guildId = ?`, [guildId]);
      if (!config) await db.run(`INSERT INTO config (guildId, notifChannelId) VALUES (?, ?)`, [guildId, channel.id]);
      else await db.run(`UPDATE config SET notifChannelId = ? WHERE guildId = ?`, [channel.id, guildId]);
      await interaction.reply({ content: `✅ Salon des notifications défini avec succès sur <#${channel.id}> !`, ephemeral: true });
    } else if (commandName === 'addxp') {
      const target = interaction.options.getUser('membre');
      const amount = interaction.options.getInteger('montant');
      let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [target.id, guildId]) || { xp: 0, level: 0 };
      let newXp = user.xp + amount, newLevel = user.level, xpNeeded = 100 + (newLevel * 25);
      while (newXp >= xpNeeded) { newXp -= xpNeeded; newLevel += 1; xpNeeded = 100 + (newLevel * 25); }
      await db.run(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, ?, ?)`, [target.id, guildId, newXp, newLevel]);
      await interaction.reply({ content: `✅ Ajout de **${amount} XP** à <@${target.id}> (Niveau atteint : ${newLevel}).`, ephemeral: true });
    } else if (commandName === 'setlevel') {
      const target = interaction.options.getUser('membre');
      const lvl = interaction.options.getInteger('niveau');
      await db.run(`INSERT OR REPLACE INTO users (usersId, guildId, xp, level) VALUES (?, ?, 0, ?)`, [target.id, guildId, lvl]);
      await interaction.reply({ content: `✅ Niveau de <@${target.id}> fixé directement à **${lvl}**.`, ephemeral: true });
    } else if (commandName === 'resetlevel') {
      const target = interaction.options.getUser('membre');
      await db.run(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, 0)`, [target.id, guildId]);
      await interaction.reply({ content: `✅ Progression de <@${target.id}> réinitialisée à zéro.`, ephemeral: true });
    }
  }

  else if (interaction.isStringSelectMenu() && interaction.customId === 'vocal_menu_select') {
    const choice = interaction.values[0];
    const memberVoice = interaction.member.voice.channel;

    if (!memberVoice && choice !== 'make_public') {
      return interaction.update({ content: `❌ **Erreur :** Tu dois obligatoirement être connecté dans un salon vocal pour effectuer cette action.`, embeds: [], components: [] });
    }

    if (choice === 'lock_kick' || choice === 'lock_timeout') {
      const sanctionType = choice === 'lock_kick' ? 'kick' : 'timeout';
      await db.run(`INSERT OR REPLACE INTO locked_voices (channelId, ownerId, sanctionType) VALUES (?, ?, ?)`, [memberVoice.id, interaction.user.id, sanctionType]);
      
      const embed = new EmbedBuilder()
        .setColor('#E67E22')
        .setTitle('🔒 Salon Vocal Verrouillé')
        .setDescription(`Le salon **${memberVoice.name}** est désormais sécurisé.\n• Sanction appliquée : **${sanctionType === 'timeout' ? 'Kick + Timeout 1 min' : 'Kick instantané'}**`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
      return interaction.update({ embeds: [embed], components: [] });
    }

    if (choice === 'whitelist_add' || choice === 'blacklist_add') {
      const lock = await db.get(`SELECT * FROM locked_voices WHERE channelId = ?`, [memberVoice.id]);
      if (!lock || lock.ownerId !== interaction.user.id) {
        return interaction.update({ content: `❌ **Refusé :** Tu ne possèdes pas de verrouillage actif sur ton salon vocal actuel.`, embeds: [], components: [] });
      }

      const membersInVoice = memberVoice.members.filter(m => m.id !== interaction.user.id);
      if (membersInVoice.size === 0) {
        return interaction.update({ content: `❌ Aucun autre membre n'est présent dans ton salon vocal.`, embeds: [], components: [] });
      }

      const selectMenuId = choice === 'whitelist_add' ? 'whitelist_member_select' : 'blacklist_member_select';
      const selectMember = new StringSelectMenuBuilder()
        .setCustomId(selectMenuId)
        .setPlaceholder(choice === 'whitelist_add' ? 'Sélectionne le membre à whitelister...' : 'Sélectionne le membre à blacklister...')
        .addOptions(membersInVoice.map(m => ({ label: m.user.username, value: m.id })));

      const row = new ActionRowBuilder().addComponents(selectMember);
      const embed = new EmbedBuilder()
        .setColor(choice === 'whitelist_add' ? '#2ECC71' : '#E74C3C')
        .setTitle(choice === 'whitelist_add' ? '✅ Gestion de la Whitelist' : '⛔ Gestion de la Blacklist')
        .setDescription('Sélectionne le membre concerné dans la liste ci-dessous :');
      return interaction.update({ embeds: [embed], components: [row] });
    }

    if (choice === 'make_public') {
      const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || interaction.user.id === interaction.guild.ownerId;
      let locks = isAdmin ? await db.all(`SELECT * FROM locked_voices`) : await db.all(`SELE
