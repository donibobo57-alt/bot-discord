const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates
  ]
});

let db;
const CREATOR_NAME = "bankiozi";
const activeSpams = new Map(); // Anti-rate-limit pour les spams DM

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
    CREATE TABLE IF NOT EXISTS redeemed_codes (
      userId TEXT PRIMARY KEY
    );
  `);
  console.log("📂 Base de données connectée et sécurisée !");
}

// --- GESTION PROPRE DES RÔLES DE NIVEAU (REMPLACEMENT ANCIEN -> NOUVEAU) ---
async function checkAndApplyLevelRoles(member, newLevel, channel) {
  if (!member || !member.guild) return;
  const guild = member.guild;
  
  const roleMap = { 
    10: 'Novice des messages', 
    30: 'Avancé des messages', 
    50: 'Semi-Pro message', 
    80: 'Légendaire des messages', 
    100: 'Légende du message' 
  };

  // Récupérer la liste de tous les rôles de niveau existants sur le serveur
  const allLevelRoleNames = Object.values(roleMap);
  const rolesToRemove = member.roles.cache.filter(r => allLevelRoleNames.includes(r.name));

  let targetRoleName = null;
  for (const [lvlNum, roleName] of Object.entries(roleMap)) {
    if (newLevel >= parseInt(lvlNum)) {
      targetRoleName = roleName;
    }
  }

  // Trouver ou créer le nouveau rôle cible
  let targetRole = null;
  if (targetRoleName) {
    targetRole = guild.roles.cache.find(r => r.name === targetRoleName);
    if (!targetRole) {
      try {
        targetRole = await guild.roles.create({ name: targetRoleName, color: '#5865F2', reason: 'Rôle de niveau automatique' });
      } catch (e) {}
    }
  }

  // Retirer les anciens rôles de niveau inférieurs et ajouter le nouveau
  try {
    for (const role of rolesToRemove.values()) {
      if (!targetRole || role.id !== targetRole.id) {
        await member.roles.remove(role).catch(() => {});
      }
    }
    if (targetRole && !member.roles.cache.has(targetRole.id)) {
      await member.roles.add(targetRole).catch(() => {});
    }
  } catch (e) {}

  // Annonce de niveau dans le salon
  if (channel) {
    const levelEmbed = new EmbedBuilder()
      .setColor('#00FFCC')
      .setTitle('🎉 Montée de Niveau !')
      .setDescription(`Félicitations <@${member.id}>, tu passes au **niveau ${newLevel}** ! 🚀`)
      .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
    channel.send({ embeds: [levelEmbed] }).catch(() => {});
  }
}

// --- COMMANDES SLASH (Serveur et Privées) ---
const commands = [
  new SlashCommandBuilder().setName('rank').setDescription('Voir sa carte de niveau et profil'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Classement général des membres'),
  new SlashCommandBuilder().setName('setsalon').setDescription('Définir le salon des annonces de niveau (Admin)')
    .addChannelOption(o => o.setName('salon').setDescription('Salon cible').setRequired(true)),
  new SlashCommandBuilder().setName('addxp').setDescription('Ajouter de l’XP à un membre (Admin)')
    .addUserOption(o => o.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .addIntegerOption(o => o.setName('montant').setDescription('Quantité d’XP').setRequired(true)),
  new SlashCommandBuilder().setName('setlevel').setDescription('Modifier directement le niveau d’un membre (Admin)')
    .addUserOption(o => o.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .addIntegerOption(o => o.setName('niveau').setDescription('Nouveau niveau').setRequired(true)),
  new SlashCommandBuilder().setName('resetlevel').setDescription('Réinitialiser les niveaux d’un membre (Admin)')
    .addUserOption(o => o.setName('membre').setDescription('Membre ciblé').setRequired(true)),
  
  // Commandes spéciales /code et /dm anonyme /vp
  new SlashCommandBuilder().setName('code').setDescription('Valider le code secret 2252 (Requiert Niveau 120 en MP)')
    .addStringOption(o => o.setName('secret').setDescription('Le code secret').setRequired(true)),
  new SlashCommandBuilder().setName('dmanonyme').setDescription('Envoyer un message anonyme à un membre (Réservé Béni par le bot)')
    .addUserOption(o => o.setName('membre').setDescription('Destinataire').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message à envoyer').setRequired(true)),
  new SlashCommandBuilder().setName('spamdm').setDescription('Spam sécurisé anti-rate-limit (Réservé Béni par le bot)')
    .addUserOption(o => o.setName('membre').setDescription('Destinataire').setRequired(true))
    .addIntegerOption(o => o.setName('nombre').setDescription('Nombre de messages').setRequired(true))
    .addIntegerOption(o => o.setName('secondes').setDescription('Intervalle en secondes').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message').setRequired(true)),
  new SlashCommandBuilder().setName('vp').setDescription('Sécuriser un salon vocal (Réservé Béni par le bot)')
    .addStringOption(o => o.setName('idsalon').setDescription('ID du salon vocal').setRequired(true))
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

// --- ACCUEIL EN DM LORS DE L'ARRIVÉE SUR LE SERVEUR ---
client.on('guildMemberAdd', async member => {
  try {
    const welcomeEmbed = new EmbedBuilder()
      .setColor('#3498DB')
      .setTitle(`Bienvenue sur ${member.guild.name} ! 🎉`)
      .setDescription('Ton compte est désormais relié au bot. Voici les commandes disponibles :\n\n' +
        '• `/rank` : Voir ton profil (Public)\n' +
        '• `/leaderboard` : Classement (Public)\n' +
        '• `/code [code]` : **[Uniquement si tu trouves le code]** À taper en MP avec le bot pour obtenir le rôle spécial !\n' +
        '• `/dmanonyme` : Envoyer un message anonyme (Après validation du code)\n' +
        '• `/spamdm` : Spam anti-rate-limit (Après validation du code)\n' +
        '• `/vp` : Sécuriser un salon vocal (Après validation du code)')
      .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
    await member.send({ embeds: [welcomeEmbed] });
  } catch (e) {}
});

// --- GESTION DES MESSAGES ET XP ---
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  const guildId = message.guild.id;

  let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);
  let xpToAdd = 10;

  if (!user) {
    await db.run(`INSERT INTO users (userId, guildId, xp, level) VALUES (?, ?, ?, ?)`, [userId, guildId, xpToAdd, 0]);
  } else {
    let newXp = user.xp + xpToAdd;
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

// --- PROTECTION VOCALE (/vp) ---
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!newState.channelId) return;
  const channelId = newState.channelId;
  
  // Vérifier si ce salon est verrouillé par un utilisateur
  // (On peut stocker les salons verrouillés en mémoire)
  if (global.lockedVoiceChannels && global.lockedVoiceChannels.has(channelId)) {
    const member = newState.member;
    const ownerId = global.lockedVoiceChannels.get(channelId);
    if (member.id !== ownerId) {
      try {
        await member.voice.disconnect();
        // Optionnel : Exclusion 1 minute du serveur ou simple déconnexion vocale
        await member.timeout(60 * 1000, 'Tentative d’intrusion dans un salon vocal privé').catch(() => {});
      } catch (e) {}
    }
  }
});

// --- GESTION DES COMMANDES SLASH (ET EN MP) ---
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;
  const isDM = !interaction.guild;
  const userId = interaction.user.id;

  // --- COMMANDES EN MESSAGE PRIVÉ (DM) ---
  if (isDM) {
    if (commandName === 'code') {
      const secret = interaction.options.getString('secret');
      if (secret !== '2252') {
        return interaction.reply({ content: '❌ Code incorrect. Réessaie !', ephemeral: true });
      }

      // Vérifier si le code a déjà été utilisé par cet utilisateur
      let redeemed = await db.get(`SELECT * FROM redeemed_codes WHERE userId = ?`, [userId]);
      if (redeemed) {
        return interaction.reply({ content: '❌ Tu as déjà validé ce code ! Impossible de le refaire.', ephemeral: true });
      }

      // Vérifier le niveau sur le premier serveur commun
      const mutualGuild = client.guilds.cache.find(g => g.members.cache.has(userId));
      if (!mutualGuild) {
        return interaction.reply({ content: '❌ Erreur : Aucun serveur commun trouvé avec le bot.', ephemeral: true });
      }

      let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, mutualGuild.id]);
      const currentLevel = user ? user.level : 0;

      if (currentLevel < 120) {
        return interaction.reply({ content: `❌ Condition non remplie ! Tu es actuellement **niveau ${currentLevel}**. Il te faut être minimum **niveau 120** pour valider ce code. Va farmer !`, ephemeral: true });
      }

      // Attribuer le rôle "Béni par le bot" (tout vert)
      const member = await mutualGuild.members.fetch(userId).catch(() => null);
      if (member) {
        let role = mutualGuild.roles.cache.find(r => r.name === 'Béni par le bot');
        if (!role) {
          try {
            role = await mutualGuild.roles.create({ name: 'Béni par le bot', color: '#00FF00', reason: 'Code secret 2252 validé' });
          } catch (e) {}
        }
        if (role) await member.roles.add(role).catch(() => {});
      }

      await db.run(`INSERT INTO redeemed_codes (userId) VALUES (?)`, [userId]);
      return interaction.reply({ content: '✅ **Félicitations !** Code validé avec succès. Tu as reçu le rôle **"Béni par le bot"** et tu débloques les commandes exclusives en MP !', ephemeral: true });
    }

    // Vérification que l'utilisateur a bien le rôle ou le niveau pour les commandes avancées en DM
    let redeemed = await db.get(`SELECT * FROM redeemed_codes WHERE userId = ?`, [userId]);
    if (!redeemed && ['dmanonyme', 'spamdm', 'vp'].includes(commandName)) {
      return interaction.reply({ content: '❌ Tu dois d’abord valider le code secret avec `/code [code]` en étant niveau 120 pour utiliser cette commande.', ephemeral: true });
    }

    if (commandName === 'dmanonyme') {
      const targetUser = interaction.options.getUser('membre');
      const text = interaction.options.getString('message');
      try {
        await targetUser.send(`📩 **Message Anonyme** :\n> ${text}`);
        await interaction.reply({ content: '✅ Message anonyme envoyé avec succès !', ephemeral: true });
      } catch (e) {
        await interaction.reply({ content: '❌ Impossible d’envoyer un message privé à cette personne.', ephemeral: true });
      }
    }

    else if (commandName === 'spamdm') {
      const targetUser = interaction.options.getUser('membre');
      const count = interaction.options.getInteger('nombre');
      const seconds = interaction.options.getInteger('secondes');
      const text = interaction.options.getString('message');

      if (count > 20 || seconds < 2) {
        return interaction.reply({ content: '❌ Sécurité anti-rate-limit : Maximum 20 messages et minimum 2 secondes d’intervalle.', ephemeral: true });
      }

      await interaction.reply({ content: `🚀 Envoi de ${count} messages toutes les ${seconds} secondes (Anti-rate-limit actif)...`, ephemeral: true });

      let sent = 0;
      const interval = setInterval(async () => {
        if (sent >= count) {
          clearInterval(interval);
          return;
        }
        try {
          await targetUser.send(`💬 ${text}`);
          sent++;
        } catch (e) {
          clearInterval(interval);
        }
      }, seconds * 1000);
    }

    else if (commandName === 'vp') {
      const salonId = interaction.options.getString('idsalon');
      const mutualGuild = client.guilds.cache.find(g => g.channels.cache.has(salonId));
      if (!mutualGuild) {
        return interaction.reply({ content: '❌ Salon vocal introuvable sur tes serveurs.', ephemeral: true });
      }

      if (!global.lockedVoiceChannels) global.lockedVoiceChannels = new Map();
      global.lockedVoiceChannels.set(salonId, userId);

      await interaction.reply({ content: `✅ Le salon vocal <#${salonId}> est désormais **privé** ! Toute personne qui essaiera de le rejoindre sera immédiatement déconnectée et exclue 1 minute.`, ephemeral: true });
    }

    return;
  }

  // --- COMMANDES SUR LE SERVEUR ---
  const guildId = interaction.guild.id;

  // Sécurité Admin stricte
  const adminCommands = ['setsalon', 'addxp', 'setlevel', 'resetlevel'];
  if (adminCommands.includes(interaction.commandName)) {
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || interaction.user.id === interaction.guild.ownerId;
    if (!isAdmin) {
      try { await interaction.member.timeout(60 * 1000, 'Tentative non autorisée'); } catch (e) {}
      return interaction.reply({ content: '❌ **Accès refusé !** Commande réservée aux administrateurs (Exclusion 1 minute).', ephemeral: true });
    }
  }

  if (commandName === 'rank') {
    let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);
    if (!user) {
      user = { xp: 0, level: 0 };
      await db.run(`INSERT OR IGNORE INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, 0)`, [userId, guildId]);
    }
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
    let desc = top && top.length > 0 ? top.map((u, i) => `**#${i + 1}** <@${u.userId}> - Niveau **${u.level}** (${u.xp} XP)`).join('\n') : 'Aucun classement disponible.';

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
      await db.run(`INSERT INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, 0)`, [target.id, guildId]);
      user = { xp: 0, level: 0 };
    }

    let newXp = user.xp + amount;
    let newLevel = user.level;
    let xpNeeded = 100 + (newLevel * 25);
    let config = await db.get(`SELECT * FROM config WHERE guildId = ?`, [guildId]);
    let targetChannel = config && config.notifChannelId ? interaction.guild.channels.cache.get(config.notifChannelId) : interaction.channel;

    while (newXp >= xpNeeded) {
      newXp -= xpNeeded;
      newLevel += 1;
      xpNeeded = 100 + (newLevel * 25);
      if (member) await checkAndApplyLevelRoles(member, newLevel, targetChannel);
    }

    await db.run(`UPDATE users SET xp = ?, level = ? WHERE userId = ? AND guildId = ?`, [newXp, newLevel, target.id, guildId]);

    await interaction.reply({ content: `✅ Ajout de **${amount} XP** à <@${target.id}> (Niveau atteint : **${newLevel}**).`, ephemeral: true });
  }

  else if (commandName === 'setlevel') {
    const target = interaction.options.getUser('membre');
    const lvl = interaction.options.getInteger('niveau');
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);

    let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [target.id, guildId]);
    if (!user) await db.run(`INSERT INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, ?)`, [target.id, guildId, lvl]);
    else await db.run(`UPDATE users SET level = ? WHERE userId = ? AND guildId = ?`, [lvl, target.id, guildId]);

    if (member) await checkAndApplyLevelRoles(member, lvl, interaction.channel);

    await interaction.reply({ content: `✅ Niveau de <@${target.id}> fixé à **${lvl}** avec succès !`, ephemeral: true });
  }

  else if (commandName === 'resetlevel') {
    const target = interaction.options.getUser('membre');
    let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [target.id, guildId]);
    
    if (!user) {
      await db.run(`INSERT INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, 0)`, [target.id, guildId]);
    } else {
      await db.run(`UPDATE users SET xp = 0, level = 0 WHERE userId = ? AND guildId = ?`, [target.id, guildId]);
    }

    await interaction.reply({ content: `✅ Les niveaux et l'XP de <@${target.id}> ont été réinitialisés à zéro.`, ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);
      
