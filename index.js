const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
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
  `);
  console.log("📂 Base de données connectée avec succès !");
}

// --- ATTRIBUTION DES RÔLES DE NIVEAU ---
async function checkLevelRoles(member, newLevel) {
  const guild = member.guild;
  const roleMap = { 10: 'Novice des messages', 30: 'Avancé des messages', 50: 'Semi-Pro message', 80: 'Légendaire des messages', 100: 'Légende du message' };
  
  if (roleMap[newLevel]) {
    let role = guild.roles.cache.find(r => r.name === roleMap[newLevel]);
    if (!role) {
      try {
        role = await guild.roles.create({ name: roleMap[newLevel], color: '#5865F2', reason: 'Rôle de niveau automatique' });
      } catch (e) {}
    }
    if (role && !member.roles.cache.has(role.id)) {
      await member.roles.add(role).catch(() => {});
    }
  }
}

// --- COMMANDES SLASH ---
const commands = [
  new SlashCommandBuilder().setName('rank').setDescription('Voir sa carte de niveau et profil'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Classement général des membres'),
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
].map(c => c.toJSON());

client.once('ready', async () => {
  await initDB();
  console.log(`Bot connecté : ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Commandes synchronisées avec succès !');
  } catch (e) {
    console.error(e);
  }

  client.user.setPresence({ activities: [{ name: '/rank | Système d’XP 📊', type: 0 }], status: 'online' });
});

// --- GESTION DES MESSAGES ET ANTI-SPAM ---
const spamTracker = new Map();

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  const guildId = message.guild.id;
  const now = Date.now();

  // Anti-spam
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
        await message.author.send(`⚠️ **Avertissement Anti-Spam**\nTu as été exclu 1 minute pour spam sur **${message.guild.name}**.`);
      } else {
        await member.timeout(24 * 60 * 60 * 1000, 'Anti-spam : 2ème avertissement');
        await message.author.send(`⚠️ **Avertissement Anti-Spam**\nTu as été exclu 24 heures pour spam répété sur **${message.guild.name}**.`);
      }
    } catch (e) {}
    return message.delete().catch(() => {});
  }

  // Gain d'XP (10 XP par message)
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
    }
    await db.run(`UPDATE users SET xp = ?, level = ? WHERE userId = ? AND guildId = ?`, [newXp, newLevel, userId, guildId]);
  }
});

// --- GESTION DES COMMANDES SLASH ---
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const guildId = interaction.guild ? interaction.guild.id : null;
  const userId = interaction.user.id;

  // Sécurité Admin : si commande admin et non admin -> Timeout 1 min
  const adminCommands = ['setsalon', 'addxp', 'removexp', 'setlevel', 'resetlevel'];
  if (adminCommands.includes(interaction.commandName)) {
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || interaction.user.id === interaction.guild.ownerId;
    if (!isAdmin) {
      try { await interaction.member.timeout(60 * 1000, 'Utilisation non autorisée d’une commande admin'); } catch (e) {}
      return interaction.reply({ content: '❌ **Accès refusé !** Commande réservée aux administrateurs (Exclusion de 1 minute).', ephemeral: true });
    }
  }

  const { commandName } = interaction;

  if (commandName === 'rank') {
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
      .setTitle('🏆 Classement Général')
      .setDescription(desc)
      .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'setsalon') {
    const channel = interaction.options.getChannel('salon');
    let config = await db.get(`SELECT * FROM config WHERE guildId = ?`, [guildId]);

    if (!config) await db.run(`INSERT INTO config (guildId, notifChannelId) VALUES (?, ?)`, [guildId, channel.id]);
    else await db.run(`UPDATE config SET notifChannelId = ? WHERE guildId = ?`, [channel.id, guildId]);

    await interaction.reply({ content: `✅ Salon des notifications défini sur <#${channel.id}> !`, ephemeral: true });
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

    await interaction.reply({ content: `✅ Ajout de **${amount} XP** à <@${target.id}> (Niveau : **${newLevel}**).`, ephemeral: true });
  }

  else if (commandName === 'removexp') {
    const target = interaction.options.getUser('membre');
    const amount = interaction.options.getInteger('montant');

    let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [target.id, guildId]);
    if (!user) return interaction.reply({ content: '❌ Ce membre n’a pas d’XP.', ephemeral: true });

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

    await interaction.reply({ content: `✅ Niveau de <@${target.id}> fixé à **${lvl}**.`, ephemeral: true });
  }

  else if (commandName === 'resetlevel') {
    const target = interaction.options.getUser('membre');
    await db.run(`UPDATE users SET xp = 0, level = 0 WHERE userId = ? AND guildId = ?`, [target.id, guildId]);
    await interaction.reply({ content: `✅ Niveaux et XP de <@${target.id}> réinitialisés.`, ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);
