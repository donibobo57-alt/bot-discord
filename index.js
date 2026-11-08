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
const CREATOR_NAME = "bankiozi"; // 👈 Ton pseudo de créateur officiel

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
  console.log("📂 Base de données RPG connectée avec succès !");
}

// --- CATALOGUE DE LA BOUTIQUE (Couleurs, Titres, Équipements et Raretés) ---
const SHOP_ITEMS = [
  { label: 'Potion de Soin', value: 'potion_soin', price: 30, rarity: 'Commun', description: 'Rétablit un peu d’énergie.' },
  { label: 'Titre : Novice', value: 'titre_novice', price: 100, rarity: 'Commun', description: 'Un titre basique pour afficher ton statut.' },
  { label: 'Couleur : Bleu Océan', value: 'color_blue', price: 250, rarity: 'Commun', description: 'Une couleur de profil apaisante.' },
  { label: 'Épée en Fer', value: 'epee_fer', price: 450, rarity: 'Peu Commun', description: 'Augmente ta force au combat.' },
  { label: 'Titre : Guerrier', value: 'titre_guerrier', price: 800, rarity: 'Peu Commun', description: 'Prouve ton courage au combat.' },
  { label: 'Couleur : Néon Cyber', value: 'color_neon', price: 1500, rarity: 'Rare', description: 'Illumine ton profil avec un style futuriste.' },
  { label: 'Titre : Légende Vivante', value: 'titre_legende', price: 5000, rarity: 'Épique', description: 'Réservé aux plus grands aventuriers.' },
  { label: 'Aura du Dragon (Mensuel)', value: 'aura_dragon', price: 25000, rarity: 'Légendaire', description: 'Objet ultra rare disponible uniquement en fin de mois.' }
];

// --- COMMANDES SLASH ---
const commands = [
  new SlashCommandBuilder().setName('help').setDescription('Affiche le guide complet et les commandes du bot'),
  new SlashCommandBuilder().setName('rank').setDescription('Affiche ton profil, ton niveau, ton XP et tes pièces'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Affiche le classement des meilleurs joueurs'),
  new SlashCommandBuilder().setName('shop').setDescription('Ouvre la boutique pour acheter couleurs, titres et items'),
  new SlashCommandBuilder().setName('inventaire').setDescription('Affiche tes objets, titres et couleurs possédés'),
  new SlashCommandBuilder().setName('chasser').setDescription('Combattre un monstre sauvage pour gagner XP et pièces'),
  new SlashCommandBuilder().setName('boss').setDescription('Faire apparaître un Boss mondial interactif (Admin)')
    .addChannelOption(o => o.setName('salon').setDescription('Salon cible').setRequired(false)),
  new SlashCommandBuilder().setName('setsalon').setDescription('Définir le salon pour les mobs ou les boss (Admin)')
    .addStringOption(o => o.setName('type').setDescription('mob ou boss').setRequired(true).addChoices({name: 'Mob', value: 'mob'}, {name: 'Boss', value: 'boss'}))
    .addChannelOption(o => o.setName('salon').setDescription('Salon cible').setRequired(true)),
  new SlashCommandBuilder().setName('addxp').setDescription('Ajouter de l’XP avec cascade automatique de niveaux (Admin)')
    .addUserOption(o => o.setName('membre').setDescription('Membre ciblé').setRequired(true))
    .addIntegerOption(o => o.setName('montant').setDescription('Quantité d’XP').setRequired(true)),
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

  client.user.setPresence({ activities: [{ name: '/help pour jouer | RPG ⚔️', type: 0 }], status: 'online' });
});

// --- SYSTÈME D'XP ET CASCADE DE NIVEAUX ---
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

      const levelEmbed = new EmbedBuilder()
        .setColor('#00FFCC')
        .setTitle('🎉 Montée de Niveau en Cascade !')
        .setDescription(`Félicitations <@${userId}>, tu passes au **niveau ${newLevel}** ! 🚀`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
      message.channel.send({ embeds: [levelEmbed] });
    }

    await db.run(`UPDATE users SET xp = ?, level = ?, coins = ? WHERE userId = ? AND guildId = ?`, [newXp, newLevel, newCoins, userId, guildId]);
  }
});

// --- GESTION DES INTERACTIONS (COMMANDES & BOUTIQUE) ---
client.on('interactionCreate', async interaction => {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'help') {
      const embed = new EmbedBuilder()
        .setColor('#3498DB')
        .setTitle('📜 Guide & Commandes du Bot RPG')
        .setDescription(`Développé par **${CREATOR_NAME}**. Voici la liste de toutes les commandes disponibles :`)
        .addFields(
          { name: '/rank', value: 'Affiche ta carte de profil, niveau, XP et pièces.' },
          { name: '/leaderboard', value: 'Classement des meilleurs joueurs du serveur.' },
          { name: '/shop', value: 'Boutique interactive pour acheter des couleurs, titres et équipements.' },
          { name: '/inventaire', value: 'Affiche tous tes objets, couleurs et titres achetés.' },
          { name: '/chasser', value: 'Combattre des monstres sauvages pour gagner de l’XP et des pièces.' },
          { name: '/boss', value: 'Faire apparaître un Boss mondial à spammer en équipe (Admin).' },
          { name: '/setsalon', value: 'Configurer les salons de mobs et de boss (Admin).' },
          { name: '/addxp', value: 'Ajouter de l’XP avec cascade automatique de niveaux (Admin).' }
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
        .setDescription(`Niveau : **${user.level}**\nXP : **${user.xp} / ${xpNeeded}**\nPièces : **${user.coins} 🪙**\n\n[Rejoindre le serveur](${interaction.guild.vanityURL || 'https://discord.gg/'})`)
        .setThumbnail(interaction.user.displayAvatarURL())
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'leaderboard') {
      const topUsers = await db.all(`SELECT * FROM users WHERE guildId = ? ORDER BY level DESC, xp DESC LIMIT 5`, [guildId]);
      let description = topUsers.map((u, i) => `**#${i + 1}** <@${u.userId}> - Niveau **${u.level}** (${u.xp} XP)`).join('\n') || 'Aucun classement pour le moment.';

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🏆 Classement du Serveur')
        .setDescription(description)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'shop') {
      let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);
      let userCoins = user ? user.coins : 0;

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('shop_select')
        .setPlaceholder('🛒 Sélectionne un article à acheter...')
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
        .setTitle('🛍️ Boutique Officielle (Couleurs, Titres & Objets)')
        .setDescription(`Tes pièces actuelles : **${userCoins} 🪙**\n\n*Sélectionne un objet dans le menu ci-dessous pour l'acheter instantanément.*`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed], components: [row] });
    }

    else if (commandName === 'inventaire') {
      const items = await db.all(`SELECT item FROM inventory WHERE userId = ? AND guildId = ?`, [userId, guildId]);
      let list = items.length > 0 ? items.map(i => `• ${i.item}`).join('\n') : 'Ton inventaire est vide. Visite la boutique ou va chasser !';

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

      const embed = new EmbedBuilder()
        .setColor('#E67E22')
        .setTitle('⚔️ Victoire au combat !')
        .setDescription(`Tu as vaincu un monstre et récupéré :\n✨ **+${earnedXp} XP**\n🪙 **+${earnedCoins} Pièces**`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'boss') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: '❌ Réservé aux administrateurs.', ephemeral: true });
      }

      let bossHp = 200;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('attack_boss').setLabel('⚔️ Attaquer le Boss !').setStyle(ButtonStyle.Danger)
      );

      const embed = new EmbedBuilder()
        .setColor('#E74C3C')
        .setTitle('🐉 Un Boss Mondial terrifiant apparaît !')
        .setDescription(`Points de vie : **${bossHp} / 200**\nSpammez le bouton pour l'éliminer tous ensemble !`)
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
          .setTitle('🐉 Combat contre le Boss Mondial')
          .setDescription(bossHp > 0 ? `Points de vie du Boss : **${bossHp} / 200**` : `🏆 Boss vaincu avec brio par **${lastAttacker}** !`)
          .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

        await i.update({ embeds: [updatedEmbed], components: bossHp > 0 ? [row] : [] });
      });

      collector.on('end', async () => {
        if (bossHp > 0) {
          const timeoutEmbed = new EmbedBuilder()
            .setColor('#95A5A6')
            .setTitle('⏱️ Temps écoulé !')
            .setDescription('Le boss a réussi à s’enfuir...')
            .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
          await msg.edit({ embeds: [timeoutEmbed], components: [] });
        }
      });
    }

    else if (commandName === 'setsalon') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Réservé aux administrateurs.', ephemeral: true });
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

      await interaction.reply({ content: `✅ Salon des **${type}s** configuré avec succès sur <#${channel.id}> !`, ephemeral: true });
    }

    else if (commandName === 'addxp') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: '❌ Réservé aux administrateurs.', ephemeral: true });
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
        .setTitle('⚡ Administration XP')
        .setDescription(`Ajout de **${amount} XP** à ${target.username} avec succès ! (Niveaux mis à jour en cascade).`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed] });
    }
  }

  // Achat d'articles dans la boutique via le menu déroulant
  if (interaction.isStringSelectMenu() && interaction.customId === 'shop_select') {
    const selectedItemValue = interaction.values[0];
    const item = SHOP_ITEMS.find(i => i.value === selectedItemValue);

    let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);
    let userCoins = user ? user.coins : 0;

    if (!user || userCoins < item.price) {
      return interaction.reply({ content: `❌ Tu n'as pas assez de pièces pour acheter **${item.label}** (${item.price} 🪙).`, ephemeral: true });
    }

    await db.run(`UPDATE users SET coins = coins - ? WHERE userId = ? AND guildId = ?`, [item.price, userId, guildId]);
    await db.run(`INSERT INTO inventory (userId, guildId, item) VALUES (?, ?, ?)`, [userId, guildId, item.label]);

    const successEmbed = new EmbedBuilder()
      .setColor('#2ECC71')
      .setTitle('🎉 Achat réussi !')
      .setDescription(`Tu as acheté **${item.label}** pour **${item.price} 🪙** ! Retrouve-le dans ton inventaire (\`/inventaire\`).`)
      .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

    await interaction.reply({ embeds: [successEmbed], ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);
