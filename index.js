const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ]
});

let db;
const CREATOR_NAME = "bankiozi";

// --- INITIALISATION DE LA BASE DE DONNÉES ---
async function initDB() {
  db = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      userId TEXT,
      guildId TEXT,
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 0,
      PRIMARY KEY (userId, guildId)
    );
    CREATE TABLE IF NOT EXISTS config (
      guildId TEXT PRIMARY KEY,
      notifChannelId TEXT
    );
    CREATE TABLE IF NOT EXISTS warnings (
      userId TEXT,
      guildId TEXT,
      count INTEGER DEFAULT 0,
      PRIMARY KEY (userId, guildId)
    );
    CREATE TABLE IF NOT EXISTS custom_roles (
      userId TEXT,
      guildId TEXT,
      roleId TEXT,
      PRIMARY KEY (userId, guildId)
    );
  `);
  console.log("📂 Base de données niveaux connectée !");
}

// --- CREATION DES ROLES DE BASE (CREATOR + NIVEAUX) ---
async function setupServerRoles(guild) {
  try {
    let creatorRole = guild.roles.cache.find(r => r.name === 'Créateur du Bot');
    if (!creatorRole) {
      await guild.roles.create({
        name: 'Créateur du Bot',
        color: '#FF0000',
        permissions: [PermissionFlagsBits.Administrator],
        reason: 'Rôle créateur du bot avec toutes les permissions'
      });
    }

    const levelRoles = { 10: 'Novice des messages', 30: 'Avancé des messages', 50: 'Semi-Pro message', 80: 'Légendaire des messages', 100: 'Légende du message' };
    for (const [lvl, name] of Object.entries(levelRoles)) {
      if (!guild.roles.cache.find(r => r.name === name)) {
        await guild.roles.create({ name, color: '#5865F2', reason: 'Rôle automatique de niveau' });
      }
    }
  } catch (e) {
    console.error("Erreur lors de la création automatique des rôles :", e);
  }
}

async function checkLevelRoles(member, newLevel) {
  const guild = member.guild;
  const roleMap = { 10: 'Novice des messages', 30: 'Avancé des messages', 50: 'Semi-Pro message', 80: 'Légendaire des messages', 100: 'Légende du message' };
  if (roleMap[newLevel]) {
    let role = guild.roles.cache.find(r => r.name === roleMap[newLevel]);
    if (role && !member.roles.cache.has(role.id)) {
      await member.roles.add(role).catch(() => {});
    }
  }
}

// --- COMMANDES SLASH POUR LES ADMINISTRATEURS ET MEMBRES ---
const commands = [
  new SlashCommandBuilder().setName('rank').setDescription('Voir sa carte de niveau et profil'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Classement général des membres'),
  new SlashCommandBuilder().setName('level').setDescription('Voir son niveau actuel'),
  new SlashCommandBuilder().setName('xp').setDescription('Voir son expérience actuelle'),
  new SlashCommandBuilder().setName('levelrewards').setDescription('Voir les récompenses de rôles par niveau'),
  new SlashCommandBuilder().setName('setsalon').setDescription('Définir le salon des annonces de niveau (Admin)')
    .addChannelOption(o => o.setName('salon').setDescription('Salon cible').setRequired(true)),
  new SlashCommandBuilder().setName('addxp').setDescription('Ajouter de l’XP à un membre (Admin)')
    .addUserOption(o => o.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .addIntegerOption(o => o.setName('montant').setDescription('Quantité d’XP').setRequired(true)),
  new SlashCommandBuilder().setName('removexp').setDescription('Retirer de l’XP à un membre (Admin)')
    .addUserOption(o => o.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .addIntegerOption(o => o.setName('montant').setDescription('Quantité d’XP à retirer').setRequired(true)),
  new SlashCommandBuilder().setName('setlevel').setDescription('Modifier directement le niveau d’un membre (Admin)')
    .addUserOption(o => o.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .addIntegerOption(o => o.setName('niveau').setDescription('Nouveau niveau').setRequired(true)),
  new SlashCommandBuilder().setName('resetlevel').setDescription('Réinitialiser les niveaux d’un membre (Admin)')
    .addUserOption(o => o.setName('membre').setDescription('Membre ciblé').setRequired(true)),
  new SlashCommandBuilder().setName('levelconfig').setDescription('Configuration globale du système (Admin)')
].map(c => c.toJSON());

client.once('ready', async () => {
  await initDB();
  console.log(`Bot connecté : ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    await setupServerRoles(guild);
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Commandes synchronisées avec succès !');
  } catch (e) { console.error(e); }

  client.user.setPresence({ activities: [{ name: '/rank | Système d’XP 📊', type: 0 }], status: 'online' });
});

client.on('guildCreate', async guild => {
  await setupServerRoles(guild);
});

// --- GESTION DES MESSAGES, XP ET ANTI-SPAM ---
const spamTracker = new Map();
const dmCreationState = new Map(); // Pour gérer la création du rôle perso en DM

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // Si c'est un message privé (DM) pour la création du rôle niveau 120
  if (!message.guild) {
    let state = dmCreationState.get(message.author.id);
    if (state && state.waitingForDetails) {
      const content = message.content.trim();
      const parts = content.split(',');
      if (parts.length < 2) {
        return message.reply("❌ Format invalide. Envoie ton message sous la forme : `NomDuRole, #CouleurHexadécimale` (Ex: `MonRoleSuprem, #FF5733`)");
      }
      const roleName = parts[0].trim();
      const roleColor = parts[1].trim();
      const guild = client.guilds.cache.get(state.guildId);
      if (!guild) return message.reply("❌ Erreur : Serveur introuvable.");

      const member = await guild.members.fetch(message.author.id).catch(() => null);
      if (!member) return;

      try {
        const newRole = await guild.roles.create({
          name: roleName,
          color: roleColor,
          reason: `Rôle personnalisé niveau 120 pour ${message.author.tag}`
        });
        await member.roles.add(newRole);
        await db.run(`INSERT INTO custom_roles (userId, guildId, roleId) VALUES (?, ?, ?)`, [message.author.id, guild.id, newRole.id]);
        dmCreationState.delete(message.author.id);
        await message.reply(`✅ Ton rôle personnalisé **${roleName}** a été créé et appliqué avec succès sur le serveur **${guild.name}** ! Tu pourras le modifier ou le gérer plus tard.`);
      } catch (e) {
        await message.reply("❌ Une erreur est survenue lors de la création du rôle. Vérifie que la couleur est valide (ex: `#FF0000`).");
      }
    }
    return;
  }

  const userId = message.author.id;
  const guildId = message.guild.id;
  const now = Date.now();

  // Système Anti-Spam / Anti-Farm
  if (!spamTracker.has(userId)) spamTracker.set(userId, []);
  let timestamps = spamTracker.get(userId);
  timestamps.push(now);
  timestamps = timestamps.filter(t => now - t < 3000);
  spamTracker.set(userId, timestamps);

  if (timestamps.length >= 4) {
    let warn = await db.get(`SELECT * FROM warnings WHERE userId = ? AND guildId = ?`, [userId, guildId]);
    let count = warn ? warn.count + 1 : 1;
    if (!warn) await db.run(`INSERT INTO warnings (userId, guildId, count) VALUES (?, ?, ?)`, [userId, guildId, count]);
    else await db.run(`UPDATE warnings SET count = ? WHERE userId = ? AND guildId = ?`, [count, userId, guildId]);

    const member = message.member;
    try {
      if (count === 1) {
        await member.timeout(60 * 1000, 'Anti-spam : 1er avertissement');
        await message.author.send(`⚠️ **Avertissement Anti-Spam (1/3)**\nTu as été exclu 1 minute pour spam sur **${message.guild.name}**.`);
      } else if (count === 2) {
        await member.timeout(24 * 60 * 60 * 1000, 'Anti-spam : 2ème avertissement');
        await message.author.send(`⚠️ **Avertissement Anti-Spam (2/3)**\nTu as été exclu 24 heures pour spam répété sur **${message.guild.name}**.`);
      } else {
        await member.ban({ reason: 'Anti-spam : 3ème avertissement - Spam intensif' });
        await message.author.send(`🚫 **Sanction définitive**\nTu as été banni définitivement du serveur **${message.guild.name}**.`);
      }
    } catch (e) {}
    return message.delete().catch(() => {});
  }

  // Gain d'XP normal par message (10 XP)
  let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);
  let xpToAdd = 10;

  if (!user) {
    await db.run(`INSERT INTO users (userId, guildId, xp, level) VALUES (?, ?, ?, ?)`, [userId, guildId, xpToAdd, 0]);
  } else {
    let newXp = user.xp + xpToAdd;
    let newLevel = user.level;
    let xpNeeded = 100 + (newLevel * 25);

    while (newXp >= xpNeeded) {
      newXp -= xpNeeded;
      newLevel += 1;
      xpNeeded = 100 + (newLevel * 25);

      await checkLevelRoles(message.member, newLevel);

      let config = await db.get(`SELECT * FROM config WHERE guildId = ?`, [guildId]);
      let targetChannel = config && config.notifChannelId ? message.guild.channels.cache.get(config.notifChannelId) : message.channel;

      if (targetChannel) {
        const levelEmbed = new EmbedBuilder()
          .setColor('#00FFCC')
          .setTitle('🎉 Montée de Niveau !')
          .setDescription(`Félicitations <@${userId}>, tu passes au **niveau ${newLevel}** ! 🚀`)
          .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
        targetChannel.send({ embeds: [levelEmbed] });
      }

      // Si niveau 120 atteint : Envoi du DM spécial
      if (newLevel === 120) {
        let existingRole = await db.get(`SELECT * FROM custom_roles WHERE userId = ? AND guildId = ?`, [userId, guildId]);
        if (!existingRole) {
          dmCreationState.set(userId, { guildId: guildId, waitingForDetails: true });
          try {
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('power_mute').setLabel('Mute').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId('power_unmute').setLabel('Démute').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId('power_move').setLabel('Déplacer').setStyle(ButtonStyle.Secondary)
            );
            const dmEmbed = new EmbedBuilder()
              .setColor('#FFD700')
              .setTitle('👑 Récompense Suprême : Niveau 120 !')
              .setDescription('Tu as atteint le niveau 120 ! Choisis ton pouvoir unique ci-dessous, puis réponds à ce message en écrivant ton **Nom de rôle** et ta **Couleur** séparés par une virgule (Ex: `MonSuperRole, #00FFCC`). Attention, tu ne peux en créer qu’un seul !')
              .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
            await message.author.send({ embeds: [dmEmbed], components: [row] });
          } catch (e) {}
        }
      }
    }
    await db.run(`UPDATE users SET xp = ?, level = ? WHERE userId = ? AND guildId = ?`, [newXp, newLevel, userId, guildId]);
  }
});

// --- GESTION DES INTERFACES ET COMMANDES SLASH ---
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;
  const guildId = interaction.guild ? interaction.guild.id : null;
  const userId = interaction.user.id;

  // Vérification de sécurité Admin stricte : si commande admin et pas admin -> Exclusion 1 min
  const adminCommands = ['setsalon', 'addxp', 'removexp', 'setlevel', 'resetlevel', 'levelconfig'];
  if (interaction.isChatInputCommand() && adminCommands.includes(interaction.commandName)) {
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || interaction.user.id === interaction.guild.ownerId;
    if (!isAdmin) {
      try {
        await interaction.member.timeout(60 * 1000, 'Tentative d’utilisation non autorisée d’une commande administrateur');
      } catch (e) {}
      return interaction.reply({ content: '❌ **Accès refusé !** Cette commande est strictement réservée aux administrateurs. Tu as été exclu 1 minute pour sanction.', ephemeral: true });
    }
  }

  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'rank' || commandName === 'level' || commandName === 'xp') {
      let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]) || { xp: 0, level: 0 };
      let xpNeeded = 100 + (user.level * 25);

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`📊 Profil de ${interaction.user.username}`)
        .setDescription(`Niveau : **${user.level}**\nXP : **${user.xp} / ${xpNeeded}**`)
        .setThumbnail(interaction.user.displayAvatarURL())
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'leaderboard') {
      const top = await db.all(`SELECT * FROM users WHERE guildId = ? ORDER BY level DESC, xp DESC LIMIT 5`, [guildId]);
      let desc = top.map((u, i) => `**#${i + 1}** <@${u.userId}> - Niveau **${u.level}** (${u.xp} XP)`).join('\n') || 'Aucun classement.';

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🏆 Classement Général des Membres')
        .setDescription(desc)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'levelrewards') {
      const embed = new EmbedBuilder()
        .setColor('#9B59B6')
        .setTitle('🎁 Récompenses de Rôles par Niveau')
        .setDescription('Voici les rôles automatiques à débloquer en progressant :\n\n• **Niveau 10** : Novice des messages\n• **Niveau 30** : Avancé des messages\n• **Niveau 50** : Semi-Pro message\n• **Niveau 80** : Légendaire des messages\n• **Niveau 100** : Légende du message\n• **Niveau 120** : Rôle personnalisé unique sur mesure !')
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'setsalon') {
      const channel = interaction.options.getChannel('salon');
      let config = await db.get(`SELECT * FROM config WHERE guildId = ?`, [guildId]);

      if (!config) await db.run(`INSERT INTO config (guildId, notifChannelId) VALUES (?, ?)`, [guildId, channel.id]);
      else await db.run(`UPDATE config SET notifChannelId = ? WHERE guildId = ?`, [channel.id, guildId]);

      await interaction.reply({ content: `✅ Salon des notifications défini sur <#${channel.id}> avec succès !`, ephemeral: true });
    }

    else if (commandName === 'addxp') {
      const target = interaction.options.getUser('membre');
      const amount = interaction.options.getInteger('montant');
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);

      let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [target.id, guildId]);
      if (!user) {
        await db.run(`INSERT INTO users (userId, guildId, xp, level) VALUES (?, ?, ?, ?)`, [target.id, guildId, amount, 0]);
        user = { xp: amount, level: 0 };
      }

      let newXp = user.xp + amount;
      let newLevel = user.level;
      let xpNeeded = 100 + (newLevel * 25);

      while (newXp >= xpNeeded) {
        newXp -= xpNeeded;
        newLevel += 1;
        xpNeeded = 100 + (newLevel * 25);
        if (member) await checkLevelRoles(member, newLevel);
      }

      await db.run(`UPDATE users SET xp = ?, level = ? WHERE userId = ? AND guildId = ?`, [newXp, newLevel, target.id, guildId]);

      const embed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setTitle('⚡ Administration XP')
        .setDescription(`Ajout de **${amount} XP** à <@${target.id}> avec succès ! (Nouveau niveau : **${newLevel}**)`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed] });
      await interaction.channel.send(`📢 <@${target.id}> a reçu **${amount} XP** de la part d'un administrateur ! Niveau actuel : **${newLevel}**.`);
    }

    else if (commandName === 'removexp') {
      const target = interaction.options.getUser('membre');
      const amount = interaction.options.getInteger('montant');

      let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [target.id, guildId]);
      if (!user) return interaction.reply({ content: '❌ Ce membre n’a pas encore d’XP enregistrée.', ephemeral: true });

      let newXp = Math.max(0, user.xp - amount);
      await db.run(`UPDATE users SET xp = ? WHERE userId = ? AND guildId = ?`, [newXp, target.id, guildId]);

      await interaction.reply({ content: `✅ Retrait de **${amount} XP** à <@${target.id}> effectué.`, ephemeral: true });
    }

    else if (commandName === 'setlevel') {
      const target = interaction.options.getUser('membre');
      const lvl = interaction.options.getInteger('niveau');

      let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [target.id, guildId]);
      if (!user) await db.run(`INSERT INTO users (userId, guildId, xp, level) VALUES (?, ?, ?, ?)`, [target.id, guildId, 0, lvl]);
      else await db.run(`UPDATE users SET level = ? WHERE userId = ? AND guildId = ?`, [lvl, target.id, guildId]);

      await interaction.reply({ content: `✅ Le niveau de <@${target.id}> a été fixé à **${lvl}** par un administrateur.`, ephemeral: true });
    }

    else if (commandName === 'resetlevel') {
      const target = interaction.options.getUser('membre');
      await db.run(`UPDATE users SET xp = 0, level = 0 WHERE userId = ? AND guildId = ?`, [target.id, guildId]);
      await interaction.reply({ content: `✅ Les niveaux et l'XP de <@${target.id}> ont été réinitialisés à zéro.`, ephemeral: true });
    }

    else if (commandName === 'levelconfig') {
      const embed = new EmbedBuilder()
        .setColor('#3498DB')
        .setTitle('⚙️ Configuration du Système de Niveaux')
        .setDescription('Le système est actif, les rôles automatiques et l’anti-spam sont configurés.')
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  // Gestion des boutons de pouvoir en DM (Niveau 120)
  if (interaction.isButton() && !interaction.guild) {
    const power = interaction.customId.replace('power_', '');
    let existing = await db.get(`SELECT * FROM custom_roles WHERE userId = ?`, [userId]);
    if (existing) {
      return interaction.reply({ content: '❌ Non frérot, tu as déjà créé ton rôle personnalisé unique ! Tu ne peux pas en faire un de plus.', ephemeral: true });
    }
    await interaction.reply({ content: `✅ Pouvoir (**${power.toUpperCase()}**) enregistré ! Envoie maintenant ton message avec le **Nom** et la **Couleur** de ton rôle pour finaliser.`, ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);
        
