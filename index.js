const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  SlashCommandBuilder, 
  REST, 
  Routes, 
  PermissionFlagsBits, 
  ActionRowBuilder, 
  StringSelectMenuBuilder 
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

// --- INITIALISATION DU CLIENT DISCORD ---
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
const CREATOR = "bankiozi";

// --- CONFIGURATION DE LA BASE DE DONNÉES SQLITE ---
async function initDatabase() {
  try {
    db = await open({ filename: './database.sqlite', driver: sqlite3.Database });
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
        chanId TEXT
      );
      CREATE TABLE IF NOT EXISTS locks (
        channelId TEXT PRIMARY KEY, 
        ownerId TEXT, 
        type TEXT
      );
      CREATE TABLE IF NOT EXISTS access (
        channelId TEXT, 
        userId TEXT, 
        mode TEXT, 
        PRIMARY KEY (channelId, userId, mode)
      );
    `);
    console.log("📂 [BDD] Base de données SQLite initialisée et connectée avec succès.");
  } catch (error) {
    console.error("❌ [BDD] Erreur lors de l'initialisation de la base de données :", error);
  }
}

// --- GESTION DES RÔLES AUTOMATIQUES PAR PALIER ---
async function applyLevelRoles(member, newLevel) {
  if (!member || !member.guild) return;
  
  const roleMap = { 
    10: 'Novice des messages', 
    30: 'Avancé des messages', 
    50: 'Semi-Pro message', 
    80: 'Légendaire des messages', 
    100: 'Légende du message' 
  };
  
  const allRolesNames = Object.values(roleMap);
  const rolesToRemove = member.roles.cache.filter(r => allRolesNames.includes(r.name));

  let targetRoleName = null;
  for (const [lvl, name] of Object.entries(roleMap)) {
    if (newLevel >= parseInt(lvl)) {
      targetRoleName = name;
    }
  }

  let targetRole = targetRoleName ? member.guild.roles.cache.find(r => r.name === targetRoleName) : null;
  if (targetRoleName && !targetRole) {
    try {
      targetRole = await member.guild.roles.create({ 
        name: targetRoleName, 
        color: '#5865F2',
        reason: 'Création automatique des rôles de niveau du bot'
      });
    } catch (e) {
      console.error("Impossible de créer le rôle de niveau :", e);
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
  } catch (e) {
    console.error("Erreur lors de l'attribution des rôles :", e);
  }
}

// --- SYSTÈME D'XP PROGRESSIF ET SÉCURISÉ (ANTI-FREEZE) ---
async function addXpToUser(member, guildId, xpToAdd, defaultChannel) {
  let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [member.id, guildId]);
  if (!user) {
    await db.run(`INSERT INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, 0)`, [member.id, guildId]);
    user = { xp: 0, level: 0 };
  }

  let currentXp = user.xp + xpToAdd;
  let currentLevel = user.level;
  
  const config = await db.get(`SELECT chanId FROM config WHERE guildId = ?`, [guildId]);
  const targetChannel = config ? member.guild.channels.cache.get(config.chanId) || defaultChannel : defaultChannel;

  let xpNeeded = 100 + (currentLevel * 25);
  let safetyCounter = 0; // Empêche toute boucle infinie

  while (currentXp >= xpNeeded && safetyCounter < 500) {
    currentXp -= xpNeeded;
    currentLevel++;
    safetyCounter++;
    xpNeeded = 100 + (currentLevel * 25);

    // Attribution du rôle lié au nouveau niveau
    await applyLevelRoles(member, currentLevel);

    // Envoi de la notification de montée de niveau stylisée
    if (targetChannel) {
      const levelEmbed = new EmbedBuilder()
        .setColor('#00FFCC')
        .setTitle('🎉 FÉLICITATIONS • NOUVEAU PALIER ATTEINT !')
        .setDescription(`Le membre <@${member.id}> vient de franchir une étape majeure et passe au **niveau ${currentLevel}** ! 🚀`)
        .addFields(
          { name: '📊 Progression Actuelle', value: `\`\`\`ini\n[ ${currentXp} / ${xpNeeded} XP ]\`\`\``, inline: false }
        )
        .setFooter({ text: `Créateur : ${CREATOR} • Système d'Évolution Avancé` })
        .setTimestamp();

      await targetChannel.send({ embeds: [levelEmbed] }).catch(() => {});
    }
  }

  await db.run(`UPDATE users SET xp = ?, level = ? WHERE userId = ? AND guildId = ?`, [currentXp, currentLevel, member.id, guildId]);
  return { xp: currentXp, level: currentLevel };
}

// --- DÉFINITION DES COMMANDES SLASH ---
const slashCommands = [
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Afficher ta carte de profil détaillée et ta progression en XP'),
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Afficher le classement officiel des membres les plus actifs du serveur'),
  new SlashCommandBuilder()
    .setName('setsalon')
    .setDescription('Définir le salon textuel pour les notifications de niveau (Admin)')
    .addChannelOption(o => o.setName('salon').setDescription('Le salon cible').setRequired(true)),
  new SlashCommandBuilder()
    .setName('addxp')
    .setDescription('Ajouter de l’expérience (XP) à un membre (Admin)')
    .addUserOption(o => o.setName('membre').setDescription('Le membre concerné').setRequired(true))
    .addIntegerOption(o => o.setName('montant').setDescription('La quantité d’XP à ajouter').setRequired(true)),
  new SlashCommandBuilder()
    .setName('setlevel')
    .setDescription('Modifier directement le niveau d’un membre (Admin)')
    .addUserOption(o => o.setName('membre').setDescription('Le membre concerné').setRequired(true))
    .addIntegerOption(o => o.setName('niveau').setDescription('Le niveau cible').setRequired(true)),
  new SlashCommandBuilder()
    .setName('resetlevel')
    .setDescription('Réinitialiser complètement la progression d’un membre (Admin)')
    .addUserOption(o => o.setName('membre').setDescription('Le membre concerné').setRequired(true)),
  new SlashCommandBuilder()
    .setName('menu')
    .setDescription('Centre de contrôle du bot')
    .addSubcommand(sub => 
      sub.setName('vocal').setDescription('Gérer la sécurité et les accès de ton salon vocal (Niveau 100+)')
    )
].map(cmd => cmd.toJSON());

// --- ÉVÉNEMENT : PRÊT & SYNCHRONISATION ---
client.once('ready', async () => {
  await initDatabase();
  console.log(`🤖 [BOT] Connecté avec succès en tant que ${client.user.tag} !`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
    console.log("🔄 [REST] Commandes Slash enregistrées et synchronisées avec succès.");
  } catch (error) {
    console.error("❌ [REST] Erreur lors de l'enregistrement des commandes :", error);
  }

  client.user.setPresence({ 
    activities: [{ name: '/menu vocal | Sécurité & XP 🛡️', type: 0 }], 
    status: 'online' 
  });
});

// --- ÉVÉNEMENT : GAIN D'XP PAR MESSAGE ---
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild || !db) return;
  await addXpToUser(message.member, message.guild.id, 15, message.channel);
});

// --- ÉVÉNEMENT : SURVEILLANCE VOCALE ET SÉCURITÉ ---
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!newState.channelId || newState.member.user.bot || !db) return;
  const channelId = newState.channelId;
  const member = newState.member;

  // Vérification de la Blacklist
  const blacklisted = await db.get(`SELECT * FROM access WHERE channelId = ? AND userId = ? AND mode = 'black'`, [channelId, member.id]);
  if (blacklisted) {
    return member.voice.disconnect("Accès interdit : Tu es blacklisté de ce salon vocal.").catch(() => {});
  }

  // Vérification du Verrouillage (Lock)
  const lock = await db.get(`SELECT * FROM locks WHERE channelId = ?`, [channelId]);
  if (!lock || member.id === lock.ownerId) return;

  // Vérification de la Whitelist
  const whitelisted = await db.get(`SELECT * FROM access WHERE channelId = ? AND userId = ? AND mode = 'white'`, [channelId, member.id]);
  if (!whitelisted) {
    await member.voice.disconnect("Salon vocal sécurisé et verrouillé par son propriétaire.").catch(() => {});
    if (lock.type === 'timeout') {
      await member.timeout(60000, "Tentative d'intrusion non autorisée dans un salon vocal sécurisé.").catch(() => {});
    }
  }
});

// --- ÉVÉNEMENT : GESTION DES INTERACTIONS (COMMANDES & MENUS) ---
client.on('interactionCreate', async interaction => {
  if (!db) return;
  const guildId = interaction.guild?.id;
  const userId = interaction.user.id;

  try {
    // 1. GESTION DES COMMANDES SLASH
    if (interaction.isChatInputCommand()) {
      const { commandName, options } = interaction;

      // Commande /menu vocal (Niveau 100 requis)
      if (commandName === 'menu' && options.getSubcommand() === 'vocal') {
        let userData = await db.get(`SELECT level FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);
        const userLevel = userData ? userData.level : 0;

        if (userLevel < 100) {
          const restrictedEmbed = new EmbedBuilder()
            .setColor('#E74C3C')
            .setTitle('⛔ ACCÈS RESTREINT • SÉCURITÉ VOCALE')
            .setDescription(`Cette fonctionnalité de pointe est strictement réservée aux membres d'élite ayant atteint le **niveau 100**.\n\n📊 **Ton niveau actuel :** \`${userLevel} / 100\``)
            .setFooter({ text: `Créateur : ${CREATOR}` })
            .setTimestamp();
          return await interaction.reply({ embeds: [restrictedEmbed], ephemeral: true });
        }

        const controlEmbed = new EmbedBuilder()
          .setColor('#3498DB')
          .setTitle('🛡️ CENTRE DE CONTRÔLE VOCAL SÉCURISÉ')
          .setDescription('Bienvenue dans ton panneau de gestion propriétaire.\nSélectionne une action de sécurité dans le menu déroulant ci-dessous pour protéger ton espace :')
          .setFooter({ text: `Créateur : ${CREATOR} • Module VPU` });

        const menuRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('vocal_panel_select')
            .setPlaceholder('Choisis une option de gestion...')
            .addOptions([
              { label: 'Verrouiller (Kick instantané)', description: 'Empêche les entrées non autorisées', value: 'lock_kick', emoji: '🔒' },
              { label: 'Verrouiller (Kick + Timeout 1 min)', description: 'Sécurise avec une sanction temporaire', value: 'lock_timeout', emoji: '⚡' },
              { label: 'Whitelist (Autoriser un membre)', description: 'Donne l’accès à un ami dans ta vocale', value: 'white_add', emoji: '✅' },
              { label: 'Blacklist (Bannir un membre)', description: 'Interdit définitivement l’accès à quelqu’un', value: 'black_add', emoji: '⛔' },
              { label: 'Rendre public (VPU)', description: 'Retire toutes les restrictions de ton salon', value: 'make_public', emoji: '🔓' }
            ])
        );

        return await interaction.reply({ embeds: [controlEmbed], components: [menuRow], ephemeral: true });
      }

      // SÉCURITÉ ADMIN AVEC SANCTION (Embed Rouge + Timeout 1 min)
      const adminCommands = ['setsalon', 'addxp', 'setlevel', 'resetlevel'];
      if (adminCommands.includes(commandName)) {
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || userId === interaction.guild.ownerId;
        
        if (!isAdmin) {
          // Application d'un timeout d'une minute à l'intrus non-admin
          try {
            await interaction.member.timeout(60 * 1000, "Tentative d'utilisation non autorisée d'une commande administrative.");
          } catch (e) {
            // Ignore si le bot n'a pas les permissions hiérarchiques sur l'utilisateur
          }

          const deniedEmbed = new EmbedBuilder()
            .setColor('#FF0033')
            .setTitle('🚨 ALERTE SÉCURITÉ • ACCÈS REFUSÉ')
            .setDescription(`Attention <@${userId}>, cette commande est **strictement réservée aux administrateurs** du serveur.\n\n⚡ *Par mesure de sécurité, une sanction de restriction (timeout) d'une minute vous a été appliquée.*`)
            .setFooter({ text: `Créateur : ${CREATOR} • Protocole de Sécurité Actif` })
            .setTimestamp();

          return await interaction.reply({ embeds: [deniedEmbed], ephemeral: true });
        }
      }

      // Commande /rank (Profil magnifique et détaillé)
      if (commandName === 'rank') {
        let userData = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]) || { xp: 0, level: 0 };
        let xpNeeded = 100 + (userData.level * 25);
        let percentage = Math.min(Math.floor((userData.xp / xpNeeded) * 100), 100);
        let progressBar = '█'.repeat(Math.floor(percentage / 10)) + '░'.repeat(10 - Math.floor(percentage / 10));

        const rankEmbed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle(`🌟 Fiche d'Identité & Progression • ${interaction.user.username}`)
          .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 512 }))
          .addFields(
            { name: '🎖️ Niveau Actuel', value: `\`\`\`fix\nNiveau ${userData.level}\`\`\``, inline: true },
            { name: '✨ Expérience XP', value: `\`\`\`ini\n[ ${userData.xp} / ${xpNeeded} XP ]\`\`\``, inline: true },
            { name: '📈 Barre d’Évolution', value: `\`${progressBar}\` **${percentage}%**`, inline: false }
          )
          .setFooter({ text: `Créateur : ${CREATOR} • Bot Officiel`, iconURL: interaction.client.user.displayAvatarURL() })
          .setTimestamp();

        return await interaction.reply({ embeds: [rankEmbed] });
      }

      // Commande /leaderboard (Classement stylé)
      if (commandName === 'leaderboard') {
        const topUsers = await db.all(`SELECT * FROM users WHERE guildId = ? ORDER BY level DESC, xp DESC LIMIT 5`, [guildId]);
        let descriptionText = topUsers.length 
          ? topUsers.map((u, idx) => `**#${idx + 1}** — <@${u.userId}> • Niveau **${u.level}** (\`${u.xp} XP\`)`).join('\n') 
          : 'Aucun classement disponible pour le moment.';

        const leaderboardEmbed = new EmbedBuilder()
          .setColor('#FFD700')
          .setTitle('🏆 CLASSEMENT GLOBAL DES LÉGENDES')
          .setDescription(descriptionText)
          .setFooter({ text: `Créateur : ${CREATOR} • Hall of Fame` })
          .setTimestamp();

        return await interaction.reply({ embeds: [leaderboardEmbed] });
      }

      // Commande /setsalon
      if (commandName === 'setsalon') {
        const targetChannel = options.getChannel('salon');
        await db.run(`INSERT OR REPLACE INTO config (guildId, chanId) VALUES (?, ?)`, [guildId, targetChannel.id]);

        const successEmbed = new EmbedBuilder()
          .setColor('#2ECC71')
          .setTitle('✅ CONFIGURATION RÉUSSIE')
          .setDescription(`Le salon des notifications de niveau a été défini avec succès sur <#${targetChannel.id}>.`)
          .setFooter({ text: `Créateur : ${CREATOR}` });

        return await interaction.reply({ embeds: [successEmbed], ephemeral: true });
      }

      // Commande /addxp
      if (commandName === 'addxp') {
        const targetUser = options.getUser('membre');
        const amount = options.getInteger('montant');
        const targetMember = await interaction.guild.members.fetch(targetUser.id);
        
        let result = await addXpToUser(targetMember, guildId, amount, interaction.channel);

        return await interaction.reply({ 
          content: `✅ Ajout réussi de **${amount} XP** à <@${targetUser.id}>. Nouveau niveau : **${result.level}**.`, 
          ephemeral: true 
        });
      }

      // Commande /setlevel
      if (commandName === 'setlevel') {
        const targetUser = options.getUser('membre');
        const targetLevel = options.getInteger('niveau');
        const targetMember = await interaction.guild.members.fetch(targetUser.id);

        await db.run(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, ?)`, [targetUser.id, guildId, targetLevel]);
        await applyLevelRoles(targetMember, targetLevel);

        return await interaction.reply({ 
          content: `✅ Le niveau de <@${targetUser.id}> a été fixé directement à **${targetLevel}** (Rôles mis à jour).`, 
          ephemeral: true 
        });
      }

      // Commande /resetlevel
      if (commandName === 'resetlevel') {
        const targetUser = options.getUser('membre');
        const targetMember = await interaction.guild.members.fetch(targetUser.id);

        await db.run(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, 0)`, [targetUser.id, guildId]);
        await applyLevelRoles(targetMember, 0);

        return await interaction.reply({ 
          content: `✅ La progression de <@${targetUser.id}> a été entièrement réinitialisée à zéro.`, 
          ephemeral: true 
        });
      }
    }

    // 2. GESTION DES MENUS DÉROULANTS VOCAUX
    else if (interaction.isStringSelectMenu()) {
      const selectedValue = interaction.values[0];
      const memberVoiceChannel = interaction.member.voice.channel;

      if (!memberVoiceChannel && selectedValue !== 'make_public') {
        return await interaction.reply({ 
          content: `❌ **Erreur :** Tu dois impérativement être connecté dans un salon vocal pour effectuer cette action.`, 
          ephemeral: true 
        });
      }

      // Verrouillage (Kick ou Timeout)
      if (selectedValue === 'lock_kick' || selectedValue === 'lock_timeout') {
        const modeType = selectedValue === 'lock_kick' ? 'kick' : 'timeout';
        await db.run(`INSERT OR REPLACE INTO locks (channelId, ownerId, type) VALUES (?, ?, ?)`, [memberVoiceChannel.id, userId, modeType]);
        
        const lockedEmbed = new EmbedBuilder()
          .setColor('#E67E22')
          .setTitle('🔒 SALON VOCAL SÉCURISÉ')
          .setDescription(`Le salon **${memberVoiceChannel.name}** est désormais verrouillé.\n• **Sanction appliquée :** \`${modeType === 'timeout' ? 'Kick + Timeout 1 min' : 'Kick instantané'}\``)
          .setFooter({ text: `Créateur : ${CREATOR}` });

        return await interaction.update({ embeds: [lockedEmbed], components: [] });
      }

      // Ajout en Whitelist ou Blacklist
      if (selectedValue === 'white_add' || selectedValue === 'black_add') {
        const activeLock = await db.get(`SELECT * FROM locks WHERE channelId = ? AND ownerId = ?`, [memberVoiceChannel.id, userId]);
        if (!activeLock) {
          return await interaction.reply({ content: `❌ **Refusé :** Tu ne possèdes pas de verrouillage actif sur ton salon vocal actuel.`, ephemeral: true });
        }

        const otherMembers = memberVoiceChannel.members.filter(m => m.id !== userId);
        if (otherMembers.size === 0) {
          return await interaction.reply({ content: `❌ Aucun autre membre n'est présent dans ton salon vocal pour le moment.`, ephemeral: true });
        }

        const subMenuId = selectedValue === 'white_add' ? 'sub_whitelist' : 'sub_blacklist';
        const memberSelectMenu = new StringSelectMenuBuilder()
          .setCustomId(subMenuId)
          .setPlaceholder('Sélectionne le membre concerné...')
          .addOptions(otherMembers.map(m => ({ label: m.user.username.slice(0, 25), value: m.id })));

        const row = new Ac
