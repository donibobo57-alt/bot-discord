const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
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
const CREATOR_NAME = "bankiozi"; // 👈 Ton vrai pseudo de créateur

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
      coins INTEGER DEFAULT 0,
      PRIMARY KEY (userId, guildId)
    );
    CREATE TABLE IF NOT EXISTS inventory (
      userId TEXT,
      guildId TEXT,
      item TEXT
    );
    CREATE TABLE IF NOT EXISTS config (
      guildId TEXT PRIMARY KEY,
      mobChannelId TEXT,
      bossChannelId TEXT
    );
  `);
  console.log("📂 Base de données RPG multi-serveurs connectée avec succès !");
}

// --- CATALOGUE DES OBJETS & RELIQUES (Boutique & Raretés) ---
const SHOP_ITEMS = [
  { label: 'Potion de Soin', value: 'potion_soin', price: 30, rarity: 'Commun', description: 'Rétablit un peu d’énergie.' },
  { label: 'Badge Bronze', value: 'badge_bronze', price: 100, rarity: 'Commun', description: 'Un badge basique pour débuter.' },
  { label: 'Épée en Fer', value: 'epee_fer', price: 450, rarity: 'Peu Commun', description: 'Augmente légèrement la force.' },
  { label: 'Couleur Néon Profil', value: 'color_neon', price: 1500, rarity: 'Rare', description: 'Illumine ton profil en style futuriste.' },
  { label: 'Relique Celeste', value: 'relique_celeste', price: 8000, rarity: 'Épique', description: 'Une relique ancienne pleine de mystères.' },
  { label: 'Aura du Dragon', value: 'aura_dragon', price: 25000, rarity: 'Légendaire (Mensuel)', description: 'Objet ultra rare disponible uniquement en fin de mois.' }
];

// --- COMMANDES SLASH ---
const commands = [
  new SlashCommandBuilder().setName('help').setDescription('Affiche la liste complète des commandes du bot RPG'),
  new SlashCommandBuilder().setName('rank').setDescription('Affiche ton profil complet, niveau, XP et pièces'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Affiche le classement des meilleurs joueurs'),
  new SlashCommandBuilder().setName('shop').setDescription('Ouvre la boutique du serveur avec les proportions et raretés'),
  new SlashCommandBuilder().setName('inventaire').setDescription('Affiche tes objets, équipements et reliques possédés'),
  new SlashCommandBuilder().setName('chasser').setDescription('Combattre un monstre sauvage pour gagner XP, pièces et reliques'),
  new SlashCommandBuilder().setName('trade').setDescription('Proposer un échange d’objets/reliques à un joueur en MP')
    .addUserOption(option => option.setName('membre').setDescription('Le joueur avec qui échanger').setRequired(true)),
  new SlashCommandBuilder().setName('fusion').setDescription('Fusionner des reliques pour obtenir des objets supérieurs'),
  new SlashCommandBuilder().setName('boss').setDescription('Fait apparaître un Boss personnalisé (Réservé Admin)'),
  new SlashCommandBuilder().setName('setsalon').setDescription('Définir le salon pour les mobs ou les boss (Admin)')
    .addStringOption(option => option.setName('type').setDescription('mob ou boss').setRequired(true).addChoices({name: 'Mob', value: 'mob'}, {name: 'Boss', value: 'boss'}))
    .addChannelOption(option => option.setName('salon').setDescription('Le salon cible').setRequired(true)),
  new SlashCommandBuilder().setName('addxp').setDescription('Ajoute de l’XP en cascade avec calcul automatique de niveau (Admin)')
    .addUserOption(option => option.setName('membre').setDescription('Le membre').setRequired(true))
    .addIntegerOption(option => option.setName('montant').setDescription('Quantité d’XP massive').setRequired(true)),
].map(command => command.toJSON());

client.once('ready', async () => {
  await initDB();
  console.log(`Bot connecté en tant que ${client.user.tag} !`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Commandes RPG synchronisées avec succès !');
  } catch (error) {
    console.error(error);
  }

  client.user.setPresence({
    activities: [{ name: '/help pour jouer | RPG & Niveaux ⚔️', type: 0 }],
    status: 'online',
  });
});

// --- SYSTÈMES D'XP ET CASCADE DE NIVEAUX ---
const cooldowns = new Set();

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  if (cooldowns.has(message.author.id)) return;
  cooldowns.add(message.author.id);
  setTimeout(() => cooldowns.delete(message.author.id), 5000);

  const userId = message.author.id;
  const guildId = message.guild.id;

  let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);
  const xpToAdd = Math.floor(Math.random() * 15) + 10;
  const coinsToAdd = Math.floor(Math.random() * 5) + 1;

  if (!user) {
    await db.run(`INSERT INTO users (userId, guildId, xp, level, coins) VALUES (?, ?, ?, ?, ?)`, [userId, guildId, xpToAdd, 0, coinsToAdd]);
  } else {
    let newXp = user.xp + xpToAdd;
    let newLevel = user.level;
    let newCoins = user.coins + coinsToAdd;

    let xpNeeded = (newLevel + 1) * 100;
    while (newXp >= xpNeeded) {
      newXp -= xpNeeded;
      newLevel += 1;
      xpNeeded = (newLevel + 1) * 100;

      const embedLevel = new EmbedBuilder()
        .setColor('#00FFCC')
        .setTitle(`🎉 Montée de Niveau en Cascade !`)
        .setDescription(`Félicitations <@${userId}>, tu passes au **niveau ${newLevel}** ! 🚀`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
      message.channel.send({ embeds: [embedLevel] });
    }

    await db.run(`UPDATE users SET xp = ?, level = ?, coins = ? WHERE userId = ? AND guildId = ?`, [newXp, newLevel, newCoins, userId, guildId]);
  }
});

// --- GESTION DES INTERACTIONS ---
client.on('interactionCreate', async interaction => {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'help') {
      const embed = new EmbedBuilder()
        .setColor('#3498DB')
        .setTitle(`📜 Guide & Commandes du Bot RPG`)
        .setDescription(`Voici la liste complète des commandes de ton aventure :`)
        .addFields(
          { name: '/rank', value: 'Affiche ta carte de profil, niveau et pièces.' },
          { name: '/leaderboard', value: 'Classement des meilleurs joueurs du serveur.' },
          { name: '/shop', value: 'Boutique interactive avec raretés et objets mensuels.' },
          { name: '/inventaire', value: 'Voir tes objets, équipements et reliques.' },
          { name: '/chasser', value: 'Combattre des monstres pour gagner XP, pièces et reliques.' },
          { name: '/trade @membre', value: 'Proposer un échange sécurisé en MP avec un autre joueur.' },
          { name: '/fusion', value: 'Fusionner des reliques pour obtenir de meilleures récompenses.' },
          { name: '/boss', value: 'Affronter un boss mondial en équipe (Admin).' },
          { name: '/setsalon', value: 'Définir les salons dédiés aux mobs et boss (Admin).' },
          { name: '/addxp', value: 'Ajouter de l’XP massive avec montée en cascade (Admin).' }
        )
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'rank') {
      let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);
      if (!user) user = { xp: 0, level: 0, coins: 0 };
      let xpNeeded = (user.level + 1) * 100;

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`📊 Profil de ${interaction.user.username}`)
        .setDescription(`Niveau : **${user.level}**\nXP : **${user.xp} / ${xpNeeded}**\nPièces : **${user.coins} 🪙**\n\n[Rejoindre le serveur principal](${interaction.guild.vanityURL || 'https://discord.gg/'})`)
        .setThumbnail(interaction.user.displayAvatarURL())
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'leaderboard') {
      const topUsers = await db.all(`SELECT * FROM users WHERE guildId = ? ORDER BY level DESC, xp DESC LIMIT 5`, [guildId]);
      let description = topUsers.map((u, index) => `**#${index + 1}** <@${u.userId}> - Niveau **${u.level}** (${u.xp} XP)`).join('\n') || 'Aucun classement.';

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle(`🏆 Classement du Serveur`)
        .setDescription(description)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'shop') {
      let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);
      let userCoins = user ? user.coins : 0;

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('shop_select')
        .setPlaceholder('🛒 Sélectionne un objet à acheter...')
        .addOptions(
          SHOP_ITEMS.map(item => ({
            label: `${item.label} (${item.price} 🪙)`,
            description: `[${item.rarity}] ${item.description}`.substring(0, 100),
            value: item.value
          }))
        );

      const row = new ActionRowBuilder().addComponents(selectMenu);

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle(`🛍️ Boutique & Raretés du Serveur`)
        .setDescription(`Tes pièces : **${userCoins} 🪙**\n\n*Proportions d'apparition : Les objets rares et légendaires n'apparaissent qu'à la fin du mois.*`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed], components: [row] });
    }

    else if (commandName === 'inventaire') {
      const items = await db.all(`SELECT item FROM inventory WHERE userId = ? AND guildId = ?`, [userId, guildId]);
      let list = items.length > 0 ? items.map(i => `• ${i.item}`).join('\n') : "Ton inventaire est vide. Va chasser ou achète des objets !";

      const embed = new EmbedBuilder()
        .setColor('#9B59B6')
        .setTitle(`🎒 Inventaire de ${interaction.user.username}`)
        .setDescription(list)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'chasser') {
      const earnedXp = Math.floor(Math.random() * 40) + 20;
      const earnedCoins = Math.floor(Math.random() * 20) + 10;
      const foundRelic = Math.random() < 0.3 ? "Relique Ancienne" : null;

      let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);
      if (!user) {
        await db.run(`INSERT INTO users (userId, guildId, xp, level, coins) VALUES (?, ?, ?, ?, ?)`, [userId, guildId, earnedXp, 0, earnedCoins]);
      } else {
        let newXp = user.xp + earnedXp;
        let newLevel = user.level;
        let newCoins = user.coins + earnedCoins;
        let xpNeeded = (newLevel + 1) * 100;

        while (newXp >= xpNeeded) {
          newXp -= xpNeeded;
          newLevel += 1;
          xpNeeded = (newLevel + 1) * 100;
        }

        await db.run(`UPDATE users SET xp = ?, level = ?, coins = ? WHERE userId = ? AND guildId = ?`, [newXp, newLevel, newCoins, userId, guildId]);
      }

      if (foundRelic) {
        await db.run(`INSERT INTO inventory (userId, guildId, item) VALUES (?, ?, ?)`, [userId, guildId, foundRelic]);
      }

      const embed = new EmbedBuilder()
        .setColor('#E67E22')
        .setTitle(`⚔️ Combat contre un Monstre !`)
        .setDescription(`Victoire ! Tu gagnes :\n✨ **+${earnedXp} XP**\n🪙 **+${earnedCoins} Pièces**\n${foundRelic ? `🎁 **Objet trouvé : ${foundRelic} !**` : 'Aucune relique trouvée.'}`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'fusion') {
      const relics = await db.all(`SELECT * FROM inventory WHERE userId = ? AND guildId = ? AND item LIKE '%Relique%'`, [userId, guildId]);
      if (relics.length < 2) {
        return interaction.reply({ content: `❌ Il te faut au moins **2 reliques** dans ton inventaire pour fusionner !`, ephemeral: true });
      }

      await db.run(`DELETE FROM inventory WHERE userId = ? AND guildId = ? AND item LIKE '%Relique%' LIMIT 2`, [userId, guildId]);
      await db.run(`INSERT INTO inventory (userId, guildId, item) VALUES (?, ?, ?)`, [userId, guildId, 'Cristal Divin Fusionné']);

      const embed = new EmbedBuilder()
        .setColor('#F1C40F')
        .setTitle(`✨ Fusion Réussie !`)
        .setDescription(`Tes reliques ont fusionné pour créer un **Cristal Divin Fusionné** !`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'trade') {
      const target = interaction.options.getUser('membre');
      if (target.bot || target.id === userId) {
        return interaction.reply({ content: `❌ Impossible d'échanger avec un bot ou toi-même.`, ephemeral: true });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`accept_trade_${userId}`).setLabel('Accepter l’échange').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`refuse_trade_${userId}`).setLabel('Refuser').setStyle(ButtonStyle.Danger)
      );

      const embed = new EmbedBuilder()
        .setColor('#9B59B6')
        .setTitle(`🤝 Demande d'Échange`)
        .setDescription(`<@${userId}> souhaite faire un échange avec toi !`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      try {
        await target.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: `✅ Demande d'échange envoyée en MP à ${target.username} !`, ephemeral: true });
      } catch (e) {
        await interaction.reply({ content: `❌ Impossible d'envoyer un message privé à ce membre.`, ephemeral: true });
      }
    }

    else if (commandName === 'addxp') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: `❌ Réservé aux administrateurs.`, ephemeral: true });
      }

      const target = interaction.options.getUser('membre');
      const amount = interaction.options.getInteger('montant');

      let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [target.id, guildId]);
      if (!user) {
        await db.run(`INSERT INTO users (userId, guildId, xp, level, coins) VALUES (?, ?, ?, ?, ?)`, [target.id, guildId, amount, 0, 10]);
      } else {
        let newXp = user.xp + amount;
        let newLevel = user.level;
        let xpNeeded = (newLevel + 1) * 100;
        
        while (newXp >= xpNeeded) {
          newXp -= xpNeeded;
          newLevel += 1;
          xpNeeded = (newLevel + 1) * 100;
        }

        await db.run(`UPDATE users SET xp = ?, level = ? WHERE userId = ? AND guildId = ?`, [newXp, newLevel, target.id, guildId]);
      }

      const embed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setTitle(`⚡ Administration XP`)
        .setDescription(`Ajout de **${amount} XP** à ${target.username} (Cascade de niveaux calculée avec succès).`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'setsalon') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: `❌ Réservé aux administrateurs.`, ephemeral: true });
      }

      const type = interaction.options.getString('type');
      const channel = interaction.options.getChannel('salon');

      let config = await db.get(`SELECT * FROM config WHERE guildId = ?`, [guildId]);
      if (!config) {
        await db.run(`INSERT INTO config (guildId, mobChannelId, bossChannelId) VALUES (?, ?, ?)`, [guildId, type === 'mob' ? channel.id : null, type === 'boss' ? channel.id : null]);
      } else {
        if (type === 'mob') await db.run(`UPDATE config SET mobChannelId = ? WHERE guildId = ?`, [channel.id, guildId]);
        if (type === 'boss') await db.run(`UPDATE config SET bossChannelId = ? WHERE guildId = ?`, [channel.id, guildId]);
      }

      await interaction.reply({ content: `✅ Salon des **${type}s** défini sur <#${channel.id}> !`, ephemeral: true });
    }

    else if (commandName === 'boss') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: `❌ Réservé aux administrateurs.`, ephemeral: true });
      }

      let bossHp = 200;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('attack_boss').setLabel('⚔️ Attaquer le Boss !').setStyle(ButtonStyle.Danger)
      );

      const embed = new EmbedBuilder()
        .setColor('#E74C3C')
        .setTitle(`🐉 Un Boss Mondial apparaît !`)
        .setDescription(`Points de vie : **${bossHp} / 200**\nSpammez le bouton pour l'éliminer !`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
      const collector = msg.createMessageComponentCollector({ time: 40000 });
      let lastAttacker = null;

      collector.on('collect', async i => {
        bossHp -= 15;
        lastAttacker = i.user.username;
        if (bossHp <= 0) bossHp = 0;
        if (bossHp === 0) collector.stop();

        const updatedEmbed = new EmbedBuilder()
          .setColor('#E74C3C')
          .setTitle(`🐉 Combat contre le Boss Mondial`)
          .setDescription(bossHp > 0 ? `Points de vie du Boss : **${bossHp} / 200**` : `🏆 Boss vaincu par **${lastAttacker}** !\nDéveloppé par le créateur **${CREATOR_NAME}**.`)
          .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

        await i.update({ embeds: [updatedEmbed], components: bossHp > 0 ? [row] : [] });
      });

      collector.on('end', async () => {
        if (bossHp > 0) {
          const timeoutEmbed = new EmbedBuilder()
            .setColor('#95A5A6')
            .setTitle(`⏱️ Temps écoulé !`)
            .setDescription(`Le boss s'est enfui...`)
            .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
          await msg.edit({ embeds: [timeoutEmbed], components: [] });
        }
      });
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'shop_select') {
    const selectedItemValue = interaction.values[0];
    const item = SHOP_ITEMS.find(i => i.value === selectedItemValue);

    let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);
    let userCoins = user ? user.coins : 0;

    if (!user || userCoins < item.price) {
      return interaction.reply({ content: `❌ Pas assez de pièces pour acheter **${item.label}** (${item.price} 🪙).`, ephemeral: true });
    }

    await db.run(`UPDATE users SET coins = coins - ? WHERE userId = ? AND guildId = ?`, [item.price, userId, guildId]);
    await db.run(`INSERT INTO inventory (userId, guildId, item) VALUES (?, ?, ?)`, [userId, guildId, item.label]);
    
