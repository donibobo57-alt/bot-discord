const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, PermissionFlagsBits, ChannelType } = require('discord.js');
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
  `);
  console.log("📂 Base de données connectée !");
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
    channel.send({ embeds: [new EmbedBuilder().setColor('#00FFCC').setTitle('🎉 Montée de Niveau !').setDescription(`Félicitations <@${member.id}>, tu passes au **niveau ${newLevel}** ! 🚀`).setFooter({ text: `Créateur : ${CREATOR_NAME}` })] }).catch(() => {});
  }

  // Création automatique du salon de configuration pour le rôle unique au niveau 120
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
      await privateChan.send(`👋 Bonjour <@${member.id}> !\n\nTu as atteint le **niveau 120** ! Écris dans ce salon les informations de ton rôle sous ce format :\n\`Pseudo | Couleur (#HEX) | M ou D ou MC ou A\`\n*(M = Mute, D = Déplacer, MC = Mute Casque, A = Aucune / en cas de faute)*`);
    } catch (e) {}
  }
}

const commands = [
  new SlashCommandBuilder().setName('rank').setDescription('Voir son profil'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Classement'),
  new SlashCommandBuilder().setName('setsalon').setDescription('Salon des annonces (Admin)').addChannelOption(o => o.setName('salon').setDescription('Salon').setRequired(true)),
  new SlashCommandBuilder().setName('addxp').setDescription('Ajouter de l’XP (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(o => o.setName('montant').setDescription('XP').setRequired(true)),
  new SlashCommandBuilder().setName('setlevel').setDescription('Modifier le niveau (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(o => o.setName('niveau').setDescription('Niveau').setRequired(true)),
  new SlashCommandBuilder().setName('resetlevel').setDescription('Reset niveau (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)),
  // Commandes Vocales (organisées dans l'ordre demandé)
  new SlashCommandBuilder().setName('vp').setDescription('Verrouiller une vocale avec sanction (Aucun salon créé)').addChannelOption(o => o.setName('vocale').setDescription('Salon vocal').addChannelTypes(ChannelType.GuildVoice).setRequired(true)).addStringOption(o => o.setName('sanction').setDescription('Type de sanction').setRequired(true).addChoices({ name: 'Kick instantané', value: 'kick' }, { name: 'Kick + Timeout 1 min', value: 'timeout' })),
  new SlashCommandBuilder().setName('ma').setDescription('Autoriser un membre à rejoindre ta vocale verrouillée').addUserOption(o => o.setName('membre').setDescription('Membre à autoriser').setRequired(true)),
  new SlashCommandBuilder().setName('vpu').setDescription('Rendre une vocale publique').addChannelOption(o => o.setName('vocale').setDescription('Salon vocal').addChannelTypes(ChannelType.GuildVoice).setRequired(true))
].map(c => c.toJSON());

client.once('ready', async () => {
  await initDB();
  console.log(`Bot connecté : ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try { await rest.put(Routes.applicationCommands(client.user.id), { body: commands }); } catch (e) {}
  client.user.setPresence({ activities: [{ name: 'Sécurité Vocale & Rôles 🛡️', type: 0 }], status: 'online' });
});

// --- GESTION DES MESSAGES (XP ET CONFIGURATION DU RÔLE NIVEAU 120) ---
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const userId = message.author.id;
  if (roleSetupState.has(userId) && message.channel.id === roleSetupState.get(userId)) {
    let existingRecord = await db.get(`SELECT * FROM custom_roles WHERE userId = ?`, [userId]);
    if (existingRecord) {
      await message.channel.send(`❌ Tu as déjà un rôle personnalisé ou tu ne peux plus en créer.`);
      setTimeout(() => message.channel.delete().catch(() => {}), 4000);
      roleSetupState.delete(userId);
      return;
    }

    const parts = message.content.split('|').map(p => p.trim());
    if (parts.length < 3) {
      await message.channel.send(`❌ Format incorrect. Utilise : \`Pseudo | Couleur | M, D, MC ou A\``);
      return;
    }

    const roleName = parts[0];
    let roleColor = parts[1];
    if (!roleColor.startsWith('#')) roleColor = '#' + roleColor;
    const permChoice = parts[2].toUpperCase();

    let rolePermissions = [];
    if (permChoice === 'M') {
      rolePermissions.push(PermissionFlagsBits.MuteMembers);
    } else if (permChoice === 'D') {
      rolePermissions.push(PermissionFlagsBits.MoveMembers);
    } else if (permChoice === 'MC') {
      rolePermissions.push(PermissionFlagsBits.DeafenMembers);
    }
    // Si 'A' ou toute faute de frappe, rolePermissions reste vide (aucune permission)

    try {
      const createdRole = await message.guild.roles.create({
        name: roleName,
        color: roleColor,
        permissions: rolePermissions,
        reason: `Rôle exclusif niveau 120 par ${userId}`
      });

      await message.member.roles.add(createdRole);
      await db.run(`INSERT OR REPLACE INTO custom_roles (userId, roleId, deleted) VALUES (?, ?, 0)`, [userId, createdRole.id]);

      await message.channel.send(`✅ Ton rôle **${roleName}** a été créé avec succès ! Ce salon va se supprimer.`);
      roleSetupState.delete(userId);
      setTimeout(() => message.channel.delete().catch(() => {}), 5000);
    } catch (e) {
      await message.channel.send(`❌ Erreur lors de la création du rôle (Vérifie la couleur). Salon supprimé.`);
      roleSetupState.delete(userId);
      setTimeout(() => message.channel.delete().catch(() => {}), 5000);
    }
    return;
  }

  // Gain d'XP
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

// --- SURVEILLANCE DES VOCALES (SANCTIONS) ---
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!newState.channelId || newState.member.user.bot) return;
  const channelId = newState.channelId;
  const member = newState.member;

  const lock = await db.get(`SELECT * FROM locked_voices WHERE channelId = ?`, [channelId]);
  if (!lock) return;

  if (member.id === lock.ownerId) return;
  const allowed = await db.get(`SELECT * FROM allowed_members WHERE channelId = ? AND userId = ?`, [channelId, member.id]);
  if (allowed) return;

  try {
    await member.voice.disconnect("Salon vocal verrouillé");
    if (lock.sanctionType === 'timeout') {
      await member.timeout(60 * 1000, "Entrée non autorisée dans un salon verrouillé");
    }
  } catch (e) {}
});

// --- GESTION DES COMMANDES SLASH ---
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const guildId = interaction.guild ? interaction.guild.id : null;
  const userId = interaction.user.id;
  const { commandName } = interaction;

  if (commandName === 'vp') {
    const channel = interaction.options.getChannel('vocale');
    const sanction = interaction.options.getString('sanction');

    await db.run(`INSERT OR REPLACE INTO locked_voices (channelId, ownerId, sanctionType) VALUES (?, ?, ?)`, [channel.id, userId, sanction]);
    return interaction.reply({ content: `🔒 Le salon vocal **${channel.name}** a été verrouillé (Sanction : ${sanction === 'timeout' ? 'Kick + Timeout 1min' : 'Kick instantané'}). Aucun salon créé.`, ephemeral: true });
  }

  if (commandName === 'ma') {
    const targetUser = interaction.options.getUser('membre');
    const memberVoice = interaction.member.voice.channel;

    if (!memberVoice) {
      return interaction.reply({ content: `❌ Tu dois être dans un salon vocal pour autoriser quelqu'un.`, ephemeral: true });
    }

    const lock = await db.get(`SELECT * FROM locked_voices WHERE channelId = ?`, [memberVoice.id]);
    if (!lock || lock.ownerId !== userId) {
      return interaction.reply({ content: `❌ Tu ne possèdes pas de verrouillage actif sur ton salon vocal actuel.`, ephemeral: true });
    }

    await db.run(`INSERT OR IGNORE INTO allowed_members (channelId, userId) VALUES (?, ?)`, [memberVoice.id, targetUser.id]);
    return interaction.reply({ content: `✅ <@${targetUser.id}> a été autorisé à rejoindre ton salon vocal privé.`, ephemeral: true });
  }

  if (commandName === 'vpu') {
    const channel = interaction.options.getChannel('vocale');
    const lock = await db.get(`SELECT * FROM locked_voices WHERE channelId = ?`, [channel.id]);

    if (!lock) {
      return interaction.reply({ content: `❌ Ce salon n'est pas verrouillé.`, ephemeral: true });
    }

    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || interaction.user.id === interaction.guild.ownerId;
    if (lock.ownerId !== userId && !isAdmin) {
      return interaction.reply({ content: `❌ Tu n'es pas le propriétaire de ce verrouillage, tu ne peux pas le rendre public (réservé au créateur ou aux administrateurs).`, ephemeral: true });
    }

    await db.run(`DELETE FROM locked_voices WHERE channelId = ?`, [channel.id]);
    await db.run(`DELETE FROM allowed_members WHERE channelId = ?`, [channel.id]);
    return interaction.reply({ content: `🔓 Le salon vocal **${channel.name}** a été rendu public.`, ephemeral: true });
  }

  // Sécurité Admin stricte
  const adminCommands = ['setsalon', 'addxp', 'setlevel', 'resetlevel'];
  if (adminCommands.includes(commandName)) {
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || interaction.user.id === interaction.guild.ownerId;
    if (!isAdmin) {
      try { await interaction.member.timeout(60 * 1000); } catch (e) {}
      return interaction.reply({ content: '❌ Accès refusé (Admin requis).', ephemeral: true });
    }
  }

  if (commandName === 'rank') {
    let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]) || { xp: 0, level: 0 };
    let xpNeeded = 100 + (user.level * 25);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle(`📊 Profil de ${interaction.user.username}`).setDescription(`Niveau : **${user.level}**\nXP : **${user.xp} / ${xpNeeded}**`).setThumbnail(interaction.user.displayAvatarURL()).setFooter({ text: `Créateur : ${CREATOR_NAME}` })] });
  } else if (commandName === 'leaderboard') {
    const top = await db.all(`SELECT * FROM users WHERE guildId = ? ORDER BY level DESC, xp DESC LIMIT 5`, [guildId]);
    let desc = top && top.length > 0 ? top.map((u, i) => `**#${i + 1}** <@${u.userId}> - Niveau **${u.level}**`).join('\n') : 'Aucun classement.';
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFD700').setTitle('🏆 Classement Général').setDescription(desc).setFooter({ text: `Créateur : ${CREATOR_NAME}` })] });
  } else if (commandName === 'setsalon') {
    const channel = interaction.options.getChannel('salon');
    let config = await db.get(`SELECT * FROM config WHERE guildId = ?`, [guildId]);
    if (!config) await db.run(`INSERT INTO config (guildId, notifChannelId) VALUES (?, ?)`, [guildId, channel.id]);
    else await db.run(`UPDATE config SET notifChannelId = ? WHERE guildId = ?`, [channel.id, guildId]);
    await interaction.reply({ content: `✅ Salon défini sur <#${channel.id}> !`, ephemeral: true });
  } else if (commandName === 'addxp') {
    const target = interaction.options.getUser('membre');
    const amount = interaction.options.getInteger('montant');
    let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [target.id, guildId]) || { xp: 0, level: 0 };
    let newXp = user.xp + amount, newLevel = user.level, xpNeeded = 100 + (newLevel * 25);
    while (newXp >= xpNeeded) { newXp -= xpNeeded; newLevel += 1; xpNeeded = 100 + (newLevel * 25); }
    await db.run(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, ?, ?)`, [target.id, guildId, newXp, newLevel]);
    await interaction.reply({ content: `✅ Ajout de ${amount} XP à <@${target.id}> (Niveau : ${newLevel}).`, ephemeral: true });
  } else if (commandName === 'setlevel') {
    const target = interaction.options.getUser('membre');
    const lvl = interaction.options.getInteger('niveau');
    await db.run(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, ?)`, [target.id, guildId, lvl]);
    await interaction.reply({ content: `✅ Niveau de <@${target.id}> fixé à ${lvl}.`, ephemeral: true });
  } else if (commandName === 'resetlevel') {
    const target = interaction.options.getUser('membre');
    await db.run(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, 0)`, [target.id, guildId]);
    await interaction.reply({ content: `✅ Niveaux de <@${target.id}> réinitialisés.`, ephemeral: true });
  }
});

// --- DÉTECTION DE LA SUPPRESSION DU RÔLE ---
client.on('roleDelete', async role => {
  const record = await db.get(`SELECT * FROM custom_roles WHERE roleId = ?`, [role.id]);
  if (record) {
    await db.run(`UPDATE custom_roles SET deleted = 1 WHERE roleId = ?`, [role.id]);
  }
});

client.login(process.env.DISCORD_TOKEN);
    
