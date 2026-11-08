const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
const CREATOR_NAME = "Donibobo57"; // 👈 Ton pseudo de créateur affiché partout

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
  `);
  console.log("📂 Base de données multi-serveurs connectée avec succès !");
}

// --- CATALOGUE DE LA BOUTIQUE (Objets, raretés et accessoires) ---
const SHOP_ITEMS = [
  { label: 'Badge Bronze', value: 'badge_bronze', price: 50, rarity: 'Commun', description: 'Un petit badge brillant pour débuter.' },
  { label: 'Couleur de Profil Néon', value: 'color_neon', price: 1200, rarity: 'Rare', description: 'Illumine ton profil avec un style futuriste.' },
  { label: 'Épée Légendaire', value: 'epe_legendaire', price: 5000, rarity: 'Légendaire', description: 'Une lame étincelante réservée aux élites.' },
  { label: 'Aura Infernale', value: 'aura_infernale', price: 10000, rarity: 'Mythique', description: 'Une aura de feu ultra-exclusive.' }
];

// --- COMMANDES SLASH ---
const commands = [
  new SlashCommandBuilder().setName('rank').setDescription('Affiche ton profil et ta carte personnalisée'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Classement des meilleurs membres du serveur'),
  new SlashCommandBuilder().setName('shop').setDescription('Ouvre la magnifique boutique interactive du serveur'),
  new SlashCommandBuilder().setName('inventaire').setDescription('Affiche tes objets et accessoires possédés'),
  new SlashCommandBuilder().setName('boss').setDescription('Fait apparaître un Boss mondial (Réservé Admin/Créateur)'),
  new SlashCommandBuilder().setName('addxp').setDescription('Ajoute de l’XP à un membre (Admin)')
    .addUserOption(option => option.setName('membre').setDescription('Le membre').setRequired(true))
    .addIntegerOption(option => option.setName('montant').setDescription('Quantité d’XP').setRequired(true)),
].map(command => command.toJSON());

client.once('ready', async () => {
  await initDB();
  console.log(`Bot connecté en tant que ${client.user.tag} !`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Commandes slash synchronisées avec succès !');
  } catch (error) {
    console.error(error);
  }

  client.user.setPresence({
    activities: [{ name: 'Gère la boutique et les boss ! ⚔️', type: 0 }],
    status: 'online',
  });
});

// --- SYSTÈMES D'XP ET ANTI-SPAM ---
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
    let xpNeeded = (newLevel + 1) * 100; // 100 XP pour niv 1, 200 pour niv 2, etc.

    if (newXp >= xpNeeded) {
      newLevel += 1;
      newXp -= xpNeeded;
      const embedLevel = new EmbedBuilder()
        .setColor('#00FFCC')
        .setTitle(`🎉 Montée de Niveau !`)
        .setDescription(`Félicitations <@${userId}>, tu passes au **niveau ${newLevel}** ! 🚀`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
      message.channel.send({ embeds: [embedLevel] });
    }

    await db.run(`UPDATE users SET xp = ?, level = ?, coins = ? WHERE userId = ? AND guildId = ?`, [newXp, newLevel, newCoins, userId, guildId]);
  }
});

// --- GESTION DES INTERACTIONS (BOUTONS, MENUS ET COMMANDES) ---
client.on('interactionCreate', async interaction => {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'rank') {
      let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);
      if (!user) user = { xp: 0, level: 0, coins: 0 };
      let xpNeeded = (user.level + 1) * 100;

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`📊 Profil de ${interaction.user.username}`)
        .setDescription(`Niveau : **${user.level}**\nXP : **${user.xp} / ${xpNeeded}**\nPièces : **${user.coins} 🪙**\n\n[Clique ici pour rejoindre le serveur](${interaction.guild.vanityURL || 'https://discord.gg/'})`)
        .setThumbnail(interaction.user.displayAvatarURL())
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'leaderboard') {
      const topUsers = await db.all(`SELECT * FROM users WHERE guildId = ? ORDER BY level DESC, xp DESC LIMIT 5`, [guildId]);
      let description = topUsers.map((u, index) => `**#${index + 1}** <@${u.userId}> - Niveau **${u.level}** (${u.xp} XP)`).join('\n') || 'Aucun classement pour le moment.';

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
        .setPlaceholder('🛒 Choisis un article à acheter...')
        .addOptions(
          SHOP_ITEMS.map(item => ({
            label: `${item.label} (${item.price} 🪙)`,
            description: `${item.rarity} - ${item.description}`.substring(0, 100),
            value: item.value
          }))
        );

      const row = new ActionRowBuilder().addComponents(selectMenu);

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle(`🛍️ Boutique Officielle`)
        .setDescription(`Bienvenue dans la boutique !\nTes pièces actuelles : **${userCoins} 🪙**\nSélectionne un objet dans le menu ci-dessous pour l'acheter.`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed], components: [row] });
    }

    else if (commandName === 'inventaire') {
      const items = await db.all(`SELECT item FROM inventory WHERE userId = ? AND guildId = ?`, [userId, guildId]);
      let list = items.length > 0 ? items.map(i => `• ${i.item}`).join('\n') : "Ton inventaire est vide pour l'instant.";

      const embed = new EmbedBuilder()
        .setColor('#9B59B6')
        .setTitle(`🎒 Ton Inventaire`)
        .setDescription(list)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'addxp') {
      if (!interaction.member.permissions.has('Administrator') && interaction.user.id !== interaction.guild.ownerId) {
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
          newLevel += 1;
          newXp -= xpNeeded;
          xpNeeded = (newLevel + 1) * 100;
        }

        await db.run(`UPDATE users SET xp = ?, level = ? WHERE userId = ? AND guildId = ?`, [newXp, newLevel, target.id, guildId]);
      }

      const embed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setTitle(`⚡ Administration XP`)
        .setDescription(`Ajout de **${amount} XP** à ${target.username} avec succès !`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'boss') {
      if (!interaction.member.permissions.has('Administrator') && interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: `❌ Commande réservée aux administrateurs.`, ephemeral: true });
      }

      let bossHp = 100;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('attack_boss').setLabel('⚔️ Attaquer le Boss !').setStyle(ButtonStyle.Danger)
      );

      const embed = new EmbedBuilder()
        .setColor('#E74C3C')
        .setTitle(`🐉 Un Boss sauvage apparaît !`)
        .setDescription(`Points de vie du Boss : **${bossHp} / 100**\nSpammez le bouton pour l'éliminer tous ensemble !`)
        .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

      const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

      const collector = msg.createMessageComponentCollector({ time: 30000 });
      let winner = null;

      collector.on('collect', async i => {
        bossHp -= 10;
        if (bossHp <= 0) {
          winner = i.user.username;
          bossHp = 0;
          collector.stop();
        }

        const updatedEmbed = new EmbedBuilder()
          .setColor('#E74C3C')
          .setTitle(`🐉 Combat contre le Boss !`)
          .setDescription(bossHp > 0 ? `Points de vie du Boss : **${bossHp} / 100**` : `🏆 Boss vaincu de haute lutte par **${winner}** !`)
          .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

        await i.update({ embeds: [updatedEmbed], components: bossHp > 0 ? [row] : [] });
      });

      collector.on('end', async () => {
        if (bossHp > 0) {
          const timeoutEmbed = new EmbedBuilder()
            .setColor('#95A5A6')
            .setTitle(`⏱️ Temps écoulé !`)
            .setDescription(`Le boss s'est enfui dans l'ombre...`)
            .setFooter({ text: `Créateur : ${CREATOR_NAME}` });
          await msg.edit({ embeds: [timeoutEmbed], components: [] });
        }
      });
    }
  }

  // Achat dans la boutique via le menu déroulant
  if (interaction.isStringSelectMenu() && interaction.customId === 'shop_select') {
    const selectedItemValue = interaction.values[0];
    const item = SHOP_ITEMS.find(i => i.value === selectedItemValue);

    let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);
    let userCoins = user ? user.coins : 0;

    if (!user || userCoins < item.price) {
      return interaction.reply({ content: `❌ Tu n'as pas assez de pièces pour acheter **${item.label}** (Prix : ${item.price} 🪙) !`, ephemeral: true });
    }

    await db.run(`UPDATE users SET coins = coins - ? WHERE userId = ? AND guildId = ?`, [item.price, userId, guildId]);
    await db.run(`INSERT INTO inventory (userId, guildId, item) VALUES (?, ?, ?)`, [userId, guildId, item.label]);

    const successEmbed = new EmbedBuilder()
      .setColor('#2ECC71')
      .setTitle(`🎉 Achat réussi !`)
      .setDescription(`Tu as acheté **${item.label}** pour **${item.price} 🪙** !`)
      .setFooter({ text: `Créateur : ${CREATOR_NAME}` });

    await interaction.reply({ embeds: [successEmbed], ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);
