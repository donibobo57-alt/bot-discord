
const http = require('http');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} = require('discord.js');

const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.DISCORD_TOKEN;
const CREATOR = 'bankiozi';
const MAX_LEVEL = 120;
const XP_PER_MESSAGE = 15;
const chronoIntervals = new Map();

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is active and running!');
});
server.listen(PORT, () => console.log(`[HTTP] Port ${PORT}`));

if (!TOKEN) {
  console.error('DISCORD_TOKEN manquant !');
  process.exit(1);
}

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

    CREATE TABLE IF NOT EXISTS chronometers (
      messageId TEXT PRIMARY KEY,
      guildId TEXT,
      channelId TEXT,
      ownerId TEXT,
      elapsedMs INTEGER DEFAULT 0,
      startedAt INTEGER,
      status TEXT DEFAULT 'idle'
    );
  `);
}

const commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Afficher toutes les commandes'),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Vérifier la latence du bot'),

  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Afficher ton profil et ton XP'),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Classement du serveur'),

  new SlashCommandBuilder()
    .setName('setsalon')
    .setDescription('Définir le salon des niveaux')
    .addChannelOption(o =>
      o.setName('salon')
        .setDescription('Salon des notifications')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('addxp')
    .setDescription('Ajouter de l XP')
    .addUserOption(o =>
      o.setName('membre').setDescription('Membre').setRequired(true))
    .addIntegerOption(o =>
      o.setName('montant').setDescription('Montant XP')
        .setMinValue(1).setMaxValue(1000000).setRequired(true)),

  new SlashCommandBuilder()
    .setName('setlevel')
    .setDescription('Modifier un niveau')
    .addUserOption(o =>
      o.setName('membre').setDescription('Membre').setRequired(true))
    .addIntegerOption(o =>
      o.setName('niveau').setDescription('Niveau entre 0 et 120')
        .setMinValue(0).setMaxValue(MAX_LEVEL).setRequired(true)),

  new SlashCommandBuilder()
    .setName('resetlevel')
    .setDescription('Réinitialiser un niveau')
    .addUserOption(o =>
      o.setName('membre').setDescription('Membre').setRequired(true)),

  new SlashCommandBuilder()
    .setName('menu')
    .setDescription('Centre de contrôle')
    .addSubcommand(s =>
      s.setName('vocal').setDescription('Sécurité vocale niveau 100+')),

  new SlashCommandBuilder()
    .setName('chronometre')
    .setDescription('Ouvrir le chronomètre administrateur')
].map(c => c.toJSON());

function isAdmin(i) {
  return i.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    i.guild?.ownerId === i.user.id;
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  return [h, m, s]
    .map(n => String(n).padStart(2, '0'))
    .join(':');
}

function getElapsed(row) {
  let elapsed = Number(row.elapsedMs || 0);

  if (row.status === 'running' && row.startedAt) {
    elapsed += Date.now() - Number(row.startedAt);
  }

  return Math.max(0, elapsed);
}

function chronoPayload(row) {
  const running = row.status === 'running';
  const paused = row.status === 'paused';
  const stopped = row.status === 'stopped';

  const status = running ? 'En cours' :
    paused ? 'En pause' :
    stopped ? 'Arrêté' : 'En attente';

  const embed = new EmbedBuilder()
    .setColor(running ? '#00CC99' : paused ? '#FFA500' : '#5865F2')
    .setTitle('⏱️ CHRONOMÈTRE')
    .setDescription(
      `\`\`\`\n${formatTime(getElapsed(row))}\n\`\`\``
    )
    .addFields({
      name: 'État',
      value: `**${status}**`,
      inline: true
    })
    .setFooter({ text: CREATOR });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('chrono_start')
      .setLabel('Démarrer')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Success)
      .setDisabled(running || paused),

    new ButtonBuilder()
      .setCustomId('chrono_pause')
      .setLabel('Pause')
      .setEmoji('⏸️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!running),

    new ButtonBuilder()
      .setCustomId('chrono_resume')
      .setLabel('Reprendre')
      .setEmoji('⏯️')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!paused)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('chrono_stop')
      .setLabel('Arrêter')
      .setEmoji('⏹️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!running && !paused),

    new ButtonBuilder()
      .setCustomId('chrono_display')
      .setLabel('Afficher')
      .setEmoji('👁️')
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row1, row2] };
}

// Actualisation du chronomètre toutes les 5 secondes.
function startChronoUpdater(messageId, channelId) {
  if (chronoIntervals.has(messageId)) return;

  const interval = setInterval(async () => {
    try {
      const row = await db.get(
        'SELECT * FROM chronometers WHERE messageId = ?',
        [messageId]
      );

      if (!row || row.status !== 'running') {
        clearInterval(interval);
        chronoIntervals.delete(messageId);
        return;
      }

      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) return;

      const message = await channel.messages.fetch(messageId);
      await message.edit(chronoPayload(row));

    } catch (err) {
      console.error('[CHRONO UPDATE]', err.message);
    }
  }, 5000);

  chronoIntervals.set(messageId, interval);
}

async function restoreChronometers() {
  const rows = await db.all(
    "SELECT * FROM chronometers WHERE status = 'running'"
  );

  for (const row of rows) {
    startChronoUpdater(row.messageId, row.channelId);
  }

  console.log(`[CHRONO] ${rows.length} chronomètre(s) restauré(s).`);
}

client.once('ready', async () => {
  try {
    await initDB();

    console.log(`Bot connecté : ${client.user.tag}`);

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );

    console.log('Commandes slash synchronisées.');

    client.user.setPresence({
      activities: [{ name: '/help | /chronometre' }],
      status: 'online'
    });

    await restoreChronometers();

  } catch (err) {
    console.error('[READY]', err);
  }
});

// Système XP
client.on('messageCreate', async message => {
  try {
    if (message.author.bot || !message.guild || !db) return;

    let user = await db.get(
      'SELECT * FROM users WHERE userId = ? AND guildId = ?',
      [message.author.id, message.guild.id]
    );

    if (!user) {
      await db.run(
        'INSERT INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, 0)',
        [message.author.id, message.guild.id]
      );
      user = { xp: 0, level: 0 };
    }

    if (user.level >= MAX_LEVEL) return;

    let xp = user.xp + XP_PER_MESSAGE;
    let level = user.level;

    while (level < MAX_LEVEL) {
      const needed = 100 + level * 25;
      if (xp < needed) break;

      xp -= needed;
      level++;
    }

    if (level >= MAX_LEVEL) xp = 0;

    await db.run(
      'UPDATE users SET xp = ?, level = ? WHERE userId = ? AND guildId = ?',
      [xp, level, message.author.id, message.guild.id]
    );

    if (level > user.level) {
      const cfg = await db.get(
        'SELECT chanId FROM config WHERE guildId = ?',
        [message.guild.id]
      );

      const channel = cfg
        ? message.guild.channels.cache.get(cfg.chanId) || message.channel
        : message.channel;

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor('#00FFCC')
            .setTitle('🎉 NOUVEAU NIVEAU !')
            .setDescription(
              `Félicitations <@${message.author.id}>, tu passes au **niveau ${level}** !`
            )
            .setFooter({ text: CREATOR })
        ]
      }).catch(() => {});
    }

  } catch (err) {
    console.error('[XP]', err);
  }
});

// Sécurité vocale
client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    if (!db || !newState.channelId || !newState.member ||
        newState.member.user.bot) return;

    const channelId = newState.channelId;
    const member = newState.member;

    const black = await db.get(
      "SELECT * FROM access WHERE channelId = ? AND userId = ? AND mode = 'black'",
      [channelId, member.id]
    );

    if (black) {
      await member.voice.disconnect('Blacklisté de ce salon');
      return;
    }

    const lock = await db.get(
      'SELECT * FROM locks WHERE channelId = ?',
      [channelId]
    );

    if (!lock || lock.ownerId === member.id) return;

    const white = await db.get(
      "SELECT * FROM access WHERE channelId = ? AND userId = ? AND mode = 'white'",
      [channelId, member.id]
    );

    if (white) return;

    await member.voice.disconnect('Salon verrouillé');

    if (lock.type === 'timeout') {
      await member.timeout(
        60000,
        'Tentative d’accès à un salon vocal verrouillé'
      ).catch(() => {});
    }

  } catch (err) {
    console.error('[VOICE]', err);
  }
});

// Interactions
client.on('interactionCreate', async i => {
  try {
    if (!db || !i.guild) {
      if (i.isRepliable()) {
        await i.reply({
          content: 'Le bot initialise encore sa base de données.',
          ephemeral: true
        }).catch(() => {});
      }
      return;
    }

    const guildId = i.guild.id;
    const userId = i.user.id;

    // COMMANDES SLASH
    if (i.isChatInputCommand()) {
      const command = i.commandName;
      const options = i.options;

      // Commandes administrateur
      const adminCommands = [
        'setsalon', 'addxp', 'setlevel',
        'resetlevel', 'chronometre'
      ];

      if (adminCommands.includes(command) && !isAdmin(i)) {
        return i.reply({
          content: '⛔ Cette commande est réservée aux administrateurs.',
          ephemeral: true
        });
      }

      // Ping
      if (command === 'ping') {
        await i.deferReply({ ephemeral: true });

        return i.editReply(
          `🏓 Pong ! Latence : **${client.ws.ping} ms**`
        );
      }

      // Help
      if (command === 'help') {
        await i.deferReply({ ephemeral: true });

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('📖 CENTRE DES COMMANDES')
          .setDescription('Voici toutes les commandes disponibles.')
          .addFields(
            {
              name: '👤 Commandes membres',
              value:
                '`/rank` — Ton profil et ta progression\n' +
                '`/leaderboard` — Classement du serveur\n' +
                '`/ping` — Latence du bot\n' +
                '`/help` — Liste des commandes'
            },
            {
              name: '🛡️ Commandes administrateur',
              value:
                '`/setsalon` — Salon des niveaux\n' +
                '`/addxp` — Ajouter de l’XP\n' +
                '`/setlevel` — Modifier un niveau\n' +
                '`/resetlevel` — Réinitialiser un niveau\n' +
                '`/chronometre` — Chronomètre interactif'
            },
            {
              name: '🔊 Sécurité vocale',
              value:
                '`/menu vocal` — Centre de contrôle vocal (niveau 100+)'
            }
          )
          .setFooter({ text: CREATOR });

        return i.editReply({ embeds: [embed] });
      }

      // Rank
      if (command === 'rank') {
        await i.deferReply();

        let user = await db.get(
          'SELECT * FROM users WHERE userId = ? AND guildId = ?',
          [userId, guildId]
        );

        if (!user) {
          user = { xp: 0, level: 0 };

          await db.run(
            'INSERT INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, 0)',
            [userId, guildId]
          );
        }

        const needed = 100 + user.level * 25;
        const percent = user.level >= MAX_LEVEL
          ? 100
          : Math.min(Math.floor(user.xp / needed * 100), 100);

        const bar = '█'.repeat(Math.floor(percent / 10)) +
          '░'.repeat(10 - Math.floor(percent / 10));

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle(`🌟 Profil de ${i.user.username}`)
          .setThumbnail(i.user.displayAvatarURL())
          .addFields(
            {
              name: 'Niveau',
              value: `\`${user.level} / ${MAX_LEVEL}\``,
              inline: true
            },
            {
              name: 'XP',
              value: `\`${user.xp} / ${user.level >= MAX_LEVEL ? 0 : needed}\``,
              inline: true
            },
            {
              name: 'Progression',
              value: `\`${bar}\` **${percent}%**`
            }
          )
          .setFooter({ text: CREATOR });

        return i.editReply({ embeds: [embed] });
      }

      // Leaderboard
      if (command === 'leaderboard') {
        await i.deferReply();

        const top = await db.all(
          'SELECT * FROM users WHERE guildId = ? ORDER BY level DESC, xp DESC LIMIT 10',
          [guildId]
        );

        const description = top.length
          ? top.map((u, index) =>
              `**#${index + 1}** <@${u.userId}> — Niveau **${u.level}**`
            ).join('\n')
          : 'Aucun classement disponible.';

        return i.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#FFD700')
              .setTitle('🏆 CLASSEMENT GLOBAL')
              .setDescription(description)
              .setFooter({ text: CREATOR })
          ]
        });
      }

      // Set salon
      if (command === 'setsalon') {
        await i.deferReply({ ephemeral: true });

        const channel = options.getChannel('salon');

        await db.run(
          'INSERT OR REPLACE INTO config (guildId, chanId) VALUES (?, ?)',
          [guildId, channel.id]
        );

        return i.editReply(`✅ Salon défini sur <#${channel.id}>.`);
      }

      // Add XP
      if (command === 'addxp') {
        await i.deferReply({ ephemeral: true });

        const target = options.getUser('membre');
        const amount = options.getInteger('montant');

        let user = await db.get(
          'SELECT * FROM users WHERE userId = ? AND guildId = ?',
          [target.id, guildId]
        ) || { xp: 0, level: 0 };

        let xp = user.xp + amount;
        let level = user.level;

        while (level < MAX_LEVEL) {
          const needed = 100 + level * 25;
          if (xp < needed) break;
          xp -= needed;
          level++;
        }

        if (level >= MAX_LEVEL) xp = 0;

        await db.run(
          'INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, ?, ?)',
          [target.id, guildId, xp, level]
        );

        return i.editReply(
          `✅ **${amount} XP** ajouté à <@${target.id}>. Niveau : **${level}/${MAX_LEVEL}**.`
        );
      }

      // Set level
      if (command === 'setlevel') {
        await i.deferReply({ ephemeral: true });

        const target = options.getUser('membre');
        const level = options.getInteger('niveau');

        await db.run(
          'INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, ?)',
          [target.id, guildId, level]
        );

        return i.editReply(
          `✅ Niveau de <@${target.id}> fixé à **${level}/${MAX_LEVEL}**.`
        );
      }

      // Reset level
      if (command === 'resetlevel') {
        await i.deferReply({ ephemeral: true });

        const target = options.getUser('membre');

        await db.run(
          'INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, 0)',
          [target.id, guildId]
        );

        return i.editReply(
          `✅ Progression de <@${target.id}> réinitialisée.`
        );
      }

      // Chronomètre
      if (command === 'chronometre') {
        await i.deferReply();

        const initial = {
          elapsedMs: 0,
          status: 'idle'
        };

        const payload = chronoPayload(initial);
        const message = await i.editReply(payload);

        await db.run(
          `INSERT OR REPLACE INTO chronometers
          (messageId, guildId, channelId, ownerId, elapsedMs, startedAt, status)
          VALUES (?, ?, ?, ?, 0, NULL, 'idle')`,
          [message.id, guildId, message.channelId, userId]
        );

        return;
      }

      // Menu vocal
      if (command === 'menu' && options.getSubcommand() === 'vocal') {
        await i.deferReply({ ephemeral: true });

        const user = await db.get(
          'SELECT level FROM users WHERE userId = ? AND guildId = ?',
          [userId, guildId]
        );

        const level = user ? user.level : 0;

        if (level < 100) {
          return i.editReply(
            `⛔ Niveau **100** requis. Ton niveau : **${level}**.`
          );
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId('v_sel')
          .setPlaceholder('Choisis une action...')
          .addOptions(
            { label: 'Verrouiller (Kick)', value: 'lock_kick', emoji: '🔒' },
            { label: 'Verrouiller (Kick + Timeout)', value: 'lock_timeout', emoji: '⚡' },
            { label: 'Whitelist (Autoriser)', value: 'white', emoji: '✅' },
            { label: 'Blacklist', value: 'black', emoji: '⛔' },
            { label: 'Rendre public', value: 'public', emoji: '🔓' }
          );

        return i.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#3498DB')
              .setTitle('🛡️ CENTRE VOCAL')
              .setDescription('Sélectionne une option.')
          ],
          components: [new ActionRowBuilder().addComponents(menu)]
        });
      }
    }

    // BOUTONS DU CHRONOMÈTRE
    if (i.isButton() && i.customId.startsWith('chrono_')) {
      const row = await db.get(
        'SELECT * FROM chronometers WHERE messageId = ?',
        [i.message.id]
      );

      if (!row) {
        return i.reply({
          content: '❌ Chronomètre introuvable.',
          ephemeral: true
        });
      }

      if (row.ownerId !== userId && !isAdmin(i)) {
        return i.reply({
          content: '⛔ Seul le créateur ou un administrateur peut contrôler ce chronomètre.',
          ephemeral: true
        });
      }

      await i.deferUpdate();

      const action = i.customId;
  
