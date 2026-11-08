const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
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

// Stockage temporaire pour l'étape de configuration du rôle personnalisé
const vpSetupState = new Map(); // userId -> { step, guildId, roleName, roleColor, channelId, createdRoleId }

async function initDB() {
  db = await open({ filename: './database.sqlite', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (userId TEXT, guildId TEXT, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 0, PRIMARY KEY (userId, guildId));
    CREATE TABLE IF NOT EXISTS config (guildId TEXT PRIMARY KEY, notifChannelId TEXT);
    CREATE TABLE IF NOT EXISTS custom_roles (userId TEXT PRIMARY KEY, roleId TEXT, deleted INTEGER DEFAULT 0);
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
}

const commands = [
  new SlashCommandBuilder().setName('rank').setDescription('Voir son profil'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Classement'),
  new SlashCommandBuilder().setName('vp').setDescription('Accéder au panneau exclusif de rôle (Niveau 100 min)'),
  new SlashCommandBuilder().setName('setsalon').setDescription('Salon des annonces (Admin)').addChannelOption(o => o.setName('salon').setDescription('Salon').setRequired(true)),
  new SlashCommandBuilder().setName('addxp').setDescription('Ajouter de l’XP (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(o => o.setName('montant').setDescription('XP').setRequired(true)),
  new SlashCommandBuilder().setName('setlevel').setDescription('Modifier le niveau (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(o => o.setName('niveau').setDescription('Niveau').setRequired(true)),
  new SlashCommandBuilder().setName('resetlevel').setDescription('Reset niveau (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
].map(c => c.toJSON());

client.once('ready', async () => {
  await initDB();
  console.log(`Bot connecté : ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try { await rest.put(Routes.applicationCommands(client.user.id), { body: commands }); } catch (e) {}
  client.user.setPresence({ activities: [{ name: '/vp | Panneau Exclusif Nv 100 🛡️', type: 0 }], status: 'online' });
});

// --- GESTION DES MESSAGES DANS LE SALON PRIVÉ DE CONFIGURATION ---
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  for (const [userId, state] of vpSetupState.entries()) {
    if (message.author.id === userId && message.channel.id === state.channelId) {
      if (state.step === 'name') {
        state.roleName = message.content.trim();
        state.step = 'color';
        await message.delete().catch(() => {});
        return message.channel.send(`🎨 Parfait. Maintenant, écris la **couleur** de ton rôle (ex: \`#FF5733\` ou \`FF0000\`) :`);
      }
      else if (state.step === 'color') {
        let colorInput = message.content.trim();
        if (!colorInput.startsWith('#')) colorInput = '#' + colorInput;
        state.roleColor = colorInput;
        state.step = 'permissions';

        await message.delete().catch(() => {});

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('perm_mute').setLabel('Mute').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('perm_deafen').setLabel('Mute casque').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('perm_move').setLabel('Déplacer vocal').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('perm_none').setLabel('Aucune permission').setStyle(ButtonStyle.Secondary)
        );

        return message.channel.send({
          content: `⚡ **Choisis la permission principale** pour ton rôle via les boutons ci-dessous :`,
          components: [row]
        });
      }
    }
  }

  // Gain d'XP normal sur le serveur
  if (!message.guild) return;
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

// --- INTERACTIONS (BOUTONS ET COMMANDES SLASH) ---
client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    const userId = interaction.user.id;
    const customId = interaction.customId;

    // Gestion du menu de masquage / sélection de rôles (Étape 1)
    if (customId === 'btn_toggle_role' || customId === 'btn_select_role') {
      const state = vpSetupState.get(userId);
      if (state && interaction.channel.id === state.channelId) {
        state.step = 'name';
        
        const embed = new EmbedBuilder()
          .setColor('#3498DB')
          .setTitle('✏️ Personnalisation de ton Rôle')
          .setDescription('Écris maintenant dans ce salon le **nom / pseudo** que tu veux donner à ton rôle personnalisé :')
          .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

        return interaction.update({ embeds: [embed], components: [] });
      }
    }

    // Gestion des permissions du rôle (Étape 2)
    const state = vpSetupState.get(userId);
    if (state && interaction.channel.id === state.channelId && customId.startsWith('perm_')) {
      const permType = customId.replace('perm_', '');
      let rolePermissions = [];
      if (permType === 'mute') rolePermissions.push(PermissionFlagsBits.MuteMembers);
      if (permType === 'deafen') rolePermissions.push(PermissionFlagsBits.DeafenMembers);
      if (permType === 'move') rolePermissions.push(PermissionFlagsBits.MoveMembers);

      try {
        const guild = interaction.guild;
        const createdRole = await guild.roles.create({
          name: state.roleName,
          color: state.roleColor,
          permissions: rolePermissions,
          reason: `Rôle exclusif VP créé par ${userId}`
        });

        const member = await guild.members.fetch(userId);
        await member.roles.add(createdRole);

        await db.run(`INSERT OR REPLACE INTO custom_roles (userId, roleId, deleted) VALUES (?, ?, 0)`, [userId, createdRole.id]);

        await interaction.update({ content: `✅ **Succès !** Ton rôle **${state.roleName}** a été créé et t'a été attribué. Ce salon va se supprimer dans 5 secondes...`, components: [] });

        vpSetupState.delete(userId);
        setTimeout(() => { interaction.channel.delete().catch(() => {}); }, 5000);
      } catch (e) {
        await interaction.update({ content: `❌ Erreur lors de la création du rôle. Le salon va se fermer.`, components: [] });
        vpSetupState.delete(userId);
        setTimeout(() => { interaction.channel.delete().catch(() => {}); }, 5000);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const guildId = interaction.guild ? interaction.guild.id : null;
  const userId = interaction.user.id;
  const { commandName } = interaction;

  if (commandName === 'vp') {
    let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);
    const currentLevel = user ? user.level : 0;

    if (currentLevel < 100) {
      return interaction.reply({ content: `❌ Condition non remplie ! Tu es **niveau ${currentLevel}**. Il te faut le **niveau 100** minimum pour accéder à `/vp`.`, ephemeral: true });
    }

    let existingRecord = await db.get(`SELECT * FROM custom_roles WHERE userId = ?`, [userId]);
    if (existingRecord) {
      if (existingRecord.deleted === 1) {
        return interaction.reply({ content: `❌ Tu ne peux plus recréer de rôle car tu as supprimé ton précédent rôle exclusif.`, ephemeral: true });
      } else {
        return interaction.reply({ content: `❌ Tu as déjà un rôle exclusif actif sur le serveur !`, ephemeral: true });
      }
    }

    // Création d'un salon textuel privé unique pour l'utilisateur
    try {
      const guild = interaction.guild;
      const privateChan = await guild.channels.create({
        name: `vp-${interaction.user.username}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ]
      });

      vpSetupState.set(userId, { step: 'menu', guildId: guild.id, channelId: privateChan.id });

      await interaction.reply({ content: `✅ Ton salon privé a été créé avec succès : <#${privateChan.id}>`, ephemeral: true });

      // Message 1 : Masquer/Afficher et Sélection des rôles avec des boutons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_toggle_role').setLabel('Masquer / Afficher mes rôles').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_select_role').setLabel('Sélectionner / Gérer mes rôles').setStyle(ButtonStyle.Primary)
      );

      const embed = new EmbedBuilder()
        .setColor('#9B59B6')
        .setTitle('🛡️ Panneau de Gestion Exclusif')
        .setDescription('Bienvenue dans ton espace privé !\n\n• Tu peux masquer ou afficher tes rôles.\n• Tu peux sélectionner et configurer ton **rôle personnalisé unique** en cliquant sur les boutons ci-dessous.')
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await privateChan.send({ embeds: [embed], components: [row] });
    } catch (e) {
      await interaction.reply({ content: `❌ Impossible de créer ton salon privé. Vérifie les permissions du bot.`, ephemeral: true });
    }
    return;
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
