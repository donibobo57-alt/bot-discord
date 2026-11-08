const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
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
      item TEXT,
      PRIMARY KEY (userId, item)
    );
  `);
  console.log("📂 Base de données connectée et prête !");
}

const commands = [
  new SlashCommandBuilder().setName('rank').setDescription('Affiche ta carte de niveau et profil personnalisée'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Affiche le classement des meilleurs membres du serveur'),
  new SlashCommandBuilder().setName('shop').setDescription('Ouvre la boutique du serveur pour acheter des rôles ou items'),
  new SlashCommandBuilder().setName('buy').setDescription('Achète un objet de la boutique').addStringOption(option => 
    option.setName('item').setDescription('Nom de l’item à acheter').setRequired(true)),
  new SlashCommandBuilder().setName('addxp').setDescription('Ajoute de l’XP à un utilisateur (Admin)')
    .addUserOption(option => option.setName('membre').setDescription('Le membre').setRequired(true))
    .addIntegerOption(option => option.setName('montant').setDescription('Quantité d’XP').setRequired(true)),
].map(command => command.toJSON());

client.once('ready', async () => {
  await initDB();
  console.log(`Bot connecté en tant que ${client.user.tag} !`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Commandes slash enregistrées avec succès !');
  } catch (error) {
    console.error(error);
  }

  client.user.setPresence({
    activities: [{ name: 'Gère les niveaux du serveur ! 🚀', type: 0 }],
    status: 'online',
  });
});

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

    if (newXp >= xpNeeded) {
      newLevel += 1;
      newXp -= xpNeeded;
      message.channel.send(`🎉 Félicitations <@${userId}>, tu viens de passer au **niveau ${newLevel}** ! 🚀`);
    }

    await db.run(`UPDATE users SET xp = ?, level = ?, coins = ? WHERE userId = ? AND guildId = ?`, [newXp, newLevel, newCoins, userId, guildId]);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;

  if (commandName === 'rank') {
    let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);
    if (!user) user = { xp: 0, level: 0, coins: 0 };

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle(`📊 Profil de ${interaction.user.username}`)
      .setDescription(`Niveau : **${user.level}**\nXP : **${user.xp} / ${(user.level + 1) * 100}**\nPièces boutique : **${user.coins} 🪙**\n\nPour nous rejoindre ou partager [clique ici pour accéder au serveur](${interaction.guild.vanityURL || 'https://discord.gg/'}) !`)
      .setThumbnail(interaction.user.displayAvatarURL());

    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'leaderboard') {
    const topUsers = await db.all(`SELECT * FROM users WHERE guildId = ? ORDER BY level DESC, xp DESC LIMIT 5`, [guildId]);
    
    let description = topUsers.map((u, index) => `**#${index + 1}** <@${u.userId}> - Niveau **${u.level}** (${u.xp} XP)`).join('\n') || 'Aucun classement pour le moment.';

    const embed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle(`🏆 Classement du Serveur`)
      .setDescription(description);

    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'shop') {
    const embed = new EmbedBuilder()
      .setColor('#00FFCC')
      .setTitle(`🛍️ Boutique du Serveur`)
      .setDescription(`Achète des rôles ou bonus avec tes pièces !\n\n1. **VIP** - 100 pièces (Commande: \`/buy VIP\`)\n2. **boost_xp** - 50 pièces (Commande: \`/buy boost_xp\`)`);

    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'buy') {
    const item = interaction.options.getString('item');
    let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId]);

    let price = item.toLowerCase() === 'vip' ? 100 : 50;

    if (!user || user.coins < price) {
      return interaction.reply({ content: `❌ Tu n'as pas assez de pièces pour acheter **${item}** !`, ephemeral: true });
    }

    await db.run(`UPDATE users SET coins = coins - ? WHERE userId = ? AND guildId = ?`, [price, userId, guildId]);
    await db.run(`INSERT OR IGNORE INTO inventory (userId, item) VALUES (?, ?)`, [userId, item]);

    await interaction.reply(`🎉 Achat réussi ! Tu as acheté **${item}**.`);
  }

  else if (commandName === 'addxp') {
    if (!interaction.member.permissions.has('Administrator') && interaction.user.id !== interaction.guild.ownerId) {
      return interaction.reply({ content: `❌ Réservé aux administrateurs du serveur.`, ephemeral: true });
    }

    const target = interaction.options.getUser('membre');
    const amount = interaction.options.getInteger('montant');

    let user = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [target.id, guildId]);
    if (!user) {
      await db.run(`INSERT INTO users (userId, guildId, xp, level, coins) VALUES (?, ?, ?, ?, ?)`, [target.id, guildId, amount, 0, 0]);
    } else {
      await db.run(`UPDATE users SET xp = xp + ? WHERE userId = ? AND guildId = ?`, [amount, target.id, guildId]);
    }

    await interaction.reply(`✅ Ajout de **${amount} XP** à ${target.username} avec succès !`);
  }
});

client.login(process.env.DISCORD_TOKEN);
      
