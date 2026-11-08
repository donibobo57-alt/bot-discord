const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

// Stockage temporaire pour les salons vocaux sécurisés
const lockedVoiceChannels = new Map(); // channelId -> { ownerId, sanction: true/false }
// Stockage temporaire pour l'étape de sélection du type de sanction
const pendingVoiceSetup = new Map(); // userId -> channelId

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
  console.log("📂 Base de données connectée et sécurisée avec succès !");
}

// --- GESTION PROPRE DES RÔLES DE NIVEAU ---
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

  const allLevelRoleNames = Object.values(roleMap);
  const rolesToRemove = member.roles.cache.filter(r => allLevelRoleNames.includes(r.name));

  let targetRoleName = null;
  for (const [lvlNum, roleName] of Object.entries(roleMap)) {
    if (newLevel >= parseInt(lvlNum)) {
      targetRoleName = roleName;
    }
  }

  let targetRole = null;
  if (targetRoleName) {
    targetRole = guild.roles.cache.find(r => r.name === targetRoleName);
    if (!targetRole) {
      try {
        targetRole = await guild.roles.create({ name: targetRoleName, color: '#5865F2', reason: 'Rôle de niveau automatique' });
      } catch (e) {}
    }
  }

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

  if (channel) {
    const levelEmbed = new EmbedBuilder()
      .setColor('#00FFCC')
      .setTitle('🎉 Montée de Niveau !')
      .setDescription(`Félicitations <@${member.id}>, tu passes au **niveau ${newLevel}** ! 🚀`)
      .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
    channel.send({ embeds: [levelEmbed] }).catch(() => {});
  }
}

// --- COMMANDES SLASH SUR LE SERVEUR (Admin & Profil uniquement) ---
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
    .addUserOption(o => o.setName('membre').setDescription('Membre ciblé').setRequired(true))
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
      .setTitle(`✨ Bienvenue sur ${member.guild.name} !`)
      .setDescription('Ton compte est connecté au système. En écrivant directement en **Message Privé (DM)** avec moi, tu peux utiliser les commandes secrètes textuelles :\n\n' +
        '• `!code 2252` : Valider ton code secret (Requiert le niveau 120)\n' +
        '• `!dmanonyme @Membre Message` : Envoyer un message anonyme\n' +
        '• `!vp` ou `!vocal` : Lister les salons vocaux du serveur et les sécuriser en privé')
      .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
    await member.send({ embeds: [welcomeEmbed] });
  } catch (e) {}
});

// --- GESTION DES MESSAGES ET COMMANDES TEXTUELLES EN DM ---
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // --- COMMANDES TEXTUELLES EN DM ---
  if (!message.guild) {
    const content = message.content.trim();
    const userId = message.author.id;

    // 1. Commande !code
    if (content.startsWith('!code')) {
      const args = content.split(' ');
      const secret = args[1];

      if (secret !== '2252') {
        return message.reply('❌ Code secret incorrect. Réessaie avec `!code [ton_code]`.');
      }

      let redeemed = await db.get(`SELECT * FROM redeemed_codes WHERE userId = ?`, [userId]);
      if (redeemed) {
        return message.reply('❌ Tu as déjà validé ce code par le passé !');
      }

      const mutualGuild = client.guilds.cache.find(g => g.members.cache.has(userId));
      if (!mutualGuild) {
        return message.reply('❌ Erreur : Tu n’es dans aucun serveur commun avec ce bot.');
      }

      let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, mutualGuild.id]);
      const currentLevel = user ? user.level : 0;

      if (currentLevel < 120) {
        return message.reply(`❌ Condition non remplie ! Tu es actuellement **niveau ${currentLevel}**. Il te faut être minimum **niveau 120** pour valider ce code. Va farmer de l'XP !`);
      }

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
      return message.reply('✅ **Félicitations !** Code validé avec succès. Tu as reçu le rôle **"Béni par le bot"** (en vert) sur le serveur !');
    }

    // 2. Commande !dmanonyme
    if (content.startsWith('!dmanonyme')) {
      let redeemed = await db.get(`SELECT * FROM redeemed_codes WHERE userId = ?`, [userId]);
      if (!redeemed) {
        return message.reply('❌ Tu dois d’abord valider ton code secret en tapant `!code 2252` en étant niveau 120.');
      }

      const targetMention = message.mentions.users.first();
      const text = content.replace('!dmanonyme', '').replace(/<@!?\d+>/, '').trim();

      if (!targetMention || !text) {
        return message.reply('❌ Format incorrect. Utilise : `!dmanonyme @Membre Ton message ici`');
      }

      try {
        const anonEmbed = new EmbedBuilder()
          .setColor('#9B59B6')
          .setTitle('📩 Message Anonyme Reçu')
          .setDescription(`> ${text}`)
          .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
        await targetMention.send({ embeds: [anonEmbed] });
        return message.reply('✅ Message anonyme envoyé avec succès !');
      } catch (e) {
        return message.reply('❌ Impossible d’envoyer le message à cette personne.');
      }
    }

    // 3. Commandes !vp ou !vocal en DM
    if (content === '!vp' || content === '!vocal') {
      // Vérifier si l'utilisateur est dans un serveur commun
      const mutualGuild = client.guilds.cache.find(g => g.members.cache.has(userId));
      if (!mutualGuild) {
        return message.reply('❌ Tu n’es dans aucun serveur avec ce bot.');
      }

      const voiceChannels = mutualGuild.channels.cache.filter(c => c.type === 2); // 2 = GuildVoice
      if (voiceChannels.size === 0) {
        return message.reply('❌ Aucun salon vocal trouvé sur le serveur.');
      }

      // Création des boutons pour chaque salon vocal
      const row = new ActionRowBuilder();
      let count = 1;
      let descriptionList = [];

      for (const [chanId, chan] of voiceChannels.entries()) {
        if (count <= 5) { // Limite Discord de 5 boutons par ligne
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`select_vc_${chanId}`)
              .setLabel(`Salon ${count}`)
              .setStyle(ButtonStyle.Primary)
          );
        }
        descriptionList.push(`**Salon ${count}** : ${chan.name}`);
        count++;
      }

      const embed = new EmbedBuilder()
        .setColor('#3498DB')
        .setTitle('🎙️ Sélection du Salon Vocal')
        .setDescription('Voici la liste des salons vocaux disponibles sur le serveur. Clique sur le bouton correspondant pour le sécuriser :\n\n' + descriptionList.join('\n'))
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      return message.reply({ embeds: [embed], components: [row] });
    }

    return;
  }

  // --- GESTION DE L'XP SUR LE SERVEUR ---
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

// --- PROTECTION VOCALE ET GESTION DES SANCTIONS ---
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!newState.channelId) return;
  const channelId = newState.channelId;
  
  if (lockedVoiceChannels.has(channelId)) {
    const data = lockedVoiceChannels.get(channelId);
    const member = newState.member;

    if (member.id !== data.ownerId) {
      try {
        await member.voice.disconnect();
        if (data.sanction) {
          await member.timeout(60 * 1000, 'Tentative d’intrusion dans un salon vocal sécurisé').catch(() => {});
        }
      } catch (e) {}
    }
  }
});

// --- GESTION DES INTERFACES ET BOUTONS EN DM ---
client.on('interactionCreate', async interaction => {
  // Gestion des boutons de sélection de salon vocal en DM
  if (interaction.isButton() && !interaction.guild) {
    const userId = interaction.user.id;

    if (interaction.customId.startsWith('select_vc_')) {
      const salonId = interaction.customId.replace('select_vc_', '');
      pendingVoiceSetup.set(userId, salonId);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vc_nosanction').setLabel('Sans sanction').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('vc_sanction').setLabel('Avec sanction (1 min)').setStyle(ButtonStyle.Danger)
      );

      const embed = new EmbedBuilder()
        .setColor('#E74C3C')
        .setTitle('🛡️ Option de Sécurité Vocale')
        .setDescription('Choisis l’option de sanction pour les personnes qui essayeront de rejoindre ton salon vocal privé :')
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      return interaction.update({ embeds: [embed], components: [row] });
    }

    if (interaction.customId === 'vc_nosanction' || interaction.customId === 'vc_sanction') {
      const salonId = pendingVoiceSetup.get(userId);
      if (!salonId) {
        return interaction.update({ content: '❌ Session expirée. Recommence avec `!vp` en DM.', embeds: [], components: [] });
      }

      const hasSanction = interaction.customId === 'vc_sanction';
      lockedVoiceChannels.set(salonId, { ownerId: userId, sanction: hasSanction });
      pendingVoiceSetup.delete(userId);

      const mutualGuild = client.guilds.cache.find(g => g.channels.cache.has(salonId));
      const channel = mutualGuild ? mutualGuild.channels.cache.get(salonId) : null;

      const successEmbed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setTitle('🔒 Salon Vocal Sécurisé')
        .setDescription(`Ton salon **${channel ? channel.name : salonId}** est désormais privé !\nOption choisie : **${hasSanction ? 'Avec sanction (1 min d’exclusion)' : 'Sans sanction (Simple déconnexion)'}**`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      return interaction.update({ embeds: [successEmbed], components: [] });
    }
  }

  // --- GESTION DES COMMANDES SLASH SUR LE SERVEUR ---
  if (!interaction.isChatInputCommand()) return;
  const guildId = interaction.guild ? interaction.guild.id : null;
  const userId = interaction.user.id;

  // Sécurité Admin stricte
  const adminCommands = ['setsalon', 'addxp', 'setlevel', 'resetlevel'];
  if (adminCommands.includes(interaction.commandName)) {
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || interaction.user.id === interaction.guild.ownerId;
    if (!isAdmin) {
      try { await interaction.member.timeout(60 * 1000, 'Tentative non autorisée'); } catch (e) {}
      return interaction.reply({ content: '❌ **Accès refusé !** Commande réservée aux administrateurs (Exclusion 1 minute).', ephemeral: true });
    }
  }

  const { commandName } = interaction;

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
