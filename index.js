
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
  StringSelectMenuBuilder
} = require('discord.js');

const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

// ==============================
// SERVEUR HTTP RENDER
// ==============================

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'online' }));
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Discord Bot is running!');
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[HTTP] Serveur actif sur le port ${PORT}`);
});

// ==============================
// CONFIGURATION
// ==============================

const CREATOR = 'bankiozi';
const MAX_LEVEL = 120;

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

// ==============================
// BASE DE DONNÉES
// ==============================

async function initDB() {
  db = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });

  await db.exec(`
    PRAGMA journal_mode = WAL;

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

  console.log('[DATABASE] Base de données prête');
}

// ==============================
// COMMANDES DISCORD
// ==============================

const cmds = [
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Ton profil et XP'),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Classement du serveur'),

  new SlashCommandBuilder()
    .setName('setsalon')
    .setDescription('Salon des niveaux (Admin)')
    .addChannelOption(o =>
      o.setName('salon')
        .setDescription('Salon')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('addxp')
    .setDescription('Ajouter de l’XP (Admin)')
    .addUserOption(o =>
      o.setName('membre')
        .setDescription('Membre')
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('montant')
        .setDescription('XP à ajouter')
        .setMinValue(1)
        .setMaxValue(1000000)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('setlevel')
    .setDescription('Modifier le niveau (Admin)')
    .addUserOption(o =>
      o.setName('membre')
        .setDescription('Membre')
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('niveau')
        .setDescription('Niveau entre 0 et 120')
        .setMinValue(0)
        .setMaxValue(MAX_LEVEL)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('resetlevel')
    .setDescription('Réinitialiser (Admin)')
    .addUserOption(o =>
      o.setName('membre')
        .setDescription('Membre')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('menu')
    .setDescription('Centre de contrôle')
    .addSubcommand(s =>
      s.setName('vocal')
        .setDescription('Sécurité vocale (Niveau 100+)')
    )
].map(c => c.toJSON());

// ==============================
// VÉRIFICATION ADMIN
// ==============================

function isAdmin(i) {
  return (
    i.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    i.user.id === i.guild.ownerId
  );
}

// ==============================
// CONNEXION DISCORD
// ==============================

client.once('ready', async () => {
  console.log(`[DISCORD] Connecté : ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' })
      .setToken(process.env.DISCORD_TOKEN);

    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: cmds }
    );

    console.log('[COMMANDS] Commandes synchronisées');

    client.user.setPresence({
      activities: [{ name: '/menu vocal | 🛡️' }],
      status: 'online'
    });

  } catch (err) {
    console.error('[COMMANDS ERROR]', err);
  }
});

client.on('error', err => {
  console.error('[DISCORD ERROR]', err);
});

// ==============================
// SYSTÈME XP
// ==============================

client.on('messageCreate', async m => {
  try {
    if (m.author.bot || !m.guild || !db) return;

    let u = await db.get(
      'SELECT * FROM users WHERE userId = ? AND guildId = ?',
      [m.author.id, m.guild.id]
    );

    if (!u) {
      await db.run(
        'INSERT INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, 0)',
        [m.author.id, m.guild.id]
      );

      u = { xp: 0, level: 0 };
    }

    if (u.level >= MAX_LEVEL) return;

    let xp = u.xp + 15;
    let lvl = u.level;
    let need = 100 + (lvl * 25);

    if (xp >= need) {
      xp -= need;
      lvl++;

      if (lvl >= MAX_LEVEL) {
        lvl = MAX_LEVEL;
        xp = 0;
      }

      let cfg = await db.get(
        'SELECT chanId FROM config WHERE guildId = ?',
        [m.guild.id]
      );

      let chan = cfg
        ? m.guild.channels.cache.get(cfg.chanId) || m.channel
        : m.channel;

      if (chan) {
        await chan.send({
          embeds: [
            new EmbedBuilder()
              .setColor('#00FFCC')
              .setTitle('🎉 NOUVEAU NIVEAU !')
              .setDescription(
                `Félicitations <@${m.author.id}>, tu passes au **niveau ${lvl}** ! 🚀`
              )
              .setFooter({ text: CREATOR })
          ]
        }).catch(() => {});
      }
    }

    await db.run(
      'UPDATE users SET xp = ?, level = ? WHERE userId = ? AND guildId = ?',
      [xp, lvl, m.author.id, m.guild.id]
    );

  } catch (err) {
    console.error('[XP ERROR]', err);
  }
});

// ==============================
// SÉCURITÉ VOCALE
// ==============================

client.on('voiceStateUpdate', async (oldS, newS) => {
  try {
    if (!newS.channelId || !newS.member || !db) return;

    // Ignorer les changements qui ne sont pas une entrée ou un déplacement.
    if (oldS.channelId === newS.channelId) return;

    if (newS.member.user.bot) return;

    const channelId = newS.channelId;
    const memberId = newS.member.id;

    const black = await db.get(
      "SELECT * FROM access WHERE channelId = ? AND userId = ? AND mode = 'black'",
      [channelId, memberId]
    );

    if (black) {
      await newS.member.voice.disconnect('Blacklisté de ce salon').catch(() => {});
      return;
    }

    const lock = await db.get(
      'SELECT * FROM locks WHERE channelId = ?',
      [channelId]
    );

    if (!lock || memberId === lock.ownerId) return;

    const white = await db.get(
      "SELECT * FROM access WHERE channelId = ? AND userId = ? AND mode = 'white'",
      [channelId, memberId]
    );

    if (white) return;

    await newS.member.voice.disconnect('Salon verrouillé').catch(() => {});

    if (lock.type === 'timeout') {
      await newS.member.timeout(
        60000,
        'Tentative d’intrusion dans un salon vocal verrouillé'
      ).catch(() => {});
    }

  } catch (err) {
    console.error('[VOICE ERROR]', err);
  }
});

// ==============================
// INTERACTIONS
// ==============================

client.on('interactionCreate', async i => {
  if (!i.guild || !db) return;

  const gId = i.guild.id;
  const uId = i.user.id;

  try {

    // --------------------------
    // COMMANDES
    // --------------------------

    if (i.isChatInputCommand()) {
      const { commandName, options } = i;

      const adminCommands = [
        'setsalon',
        'addxp',
        'setlevel',
        'resetlevel'
      ];

      const ephemeral =
        adminCommands.includes(commandName) ||
        commandName === 'menu';

      await i.deferReply({ ephemeral });

      if (adminCommands.includes(commandName) && !isAdmin(i)) {
        return i.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#FF0033')
              .setTitle('🚨 ACCÈS REFUSÉ')
              .setDescription(
                'Cette commande est réservée aux administrateurs.'
              )
              .setFooter({ text: CREATOR })
          ]
        });
      }

      // RANK

      if (commandName === 'rank') {
        let u = await db.get(
          'SELECT * FROM users WHERE userId = ? AND guildId = ?',
          [uId, gId]
        );

        if (!u) {
          await db.run(
            'INSERT INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, 0)',
            [uId, gId]
          );

          u = { xp: 0, level: 0 };
        }

        const need = 100 + (u.level * 25);
        const pct = Math.min(
          Math.floor((u.xp / need) * 100),
          100
        );

        const bar =
          '█'.repeat(Math.floor(pct / 10)) +
          '░'.repeat(10 - Math.floor(pct / 10));

        return i.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#5865F2')
              .setTitle(`🌟 Profil de ${i.user.username}`)
              .setThumbnail(i.user.displayAvatarURL())
              .addFields(
                {
                  name: 'Niveau',
                  value: `\`${u.level} / ${MAX_LEVEL}\``,
                  inline: true
                },
                {
                  name: 'XP',
                  value: `\`${u.xp} / ${need}\``,
                  inline: true
                },
                {
                  name: 'Progression',
                  value: `\`${bar}\` **${pct}%**`
                }
              )
              .setFooter({ text: CREATOR })
          ]
        });
      }

      // LEADERBOARD

      if (commandName === 'leaderboard') {
        const top = await db.all(
          'SELECT * FROM users WHERE guildId = ? ORDER BY level DESC, xp DESC LIMIT 5',
          [gId]
        );

        const desc = top.length
          ? top.map((x, idx) =>
              `**#${idx + 1}** <@${x.userId}> — Niveau **${x.level}**`
            ).join('\n')
          : 'Aucun classement.';

        return i.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#FFD700')
              .setTitle('🏆 Classement Global')
              .setDescription(desc)
              .setFooter({ text: CREATOR })
          ]
        });
      }

      // SETSALON

      if (commandName === 'setsalon') {
        const c = options.getChannel('salon');

        await db.run(
          'INSERT OR REPLACE INTO config (guildId, chanId) VALUES (?, ?)',
          [gId, c.id]
        );

        return i.editReply({
          content: `✅ Salon défini sur <#${c.id}>.`
        });
      }

      // ADDXP

      if (commandName === 'addxp') {
        const target = options.getUser('membre');
        const amt = options.getInteger('montant');

        let u = await db.get(
          'SELECT * FROM users WHERE userId = ? AND guildId = ?',
          [target.id, gId]
        ) || { xp: 0, level: 0 };

        let xp = u.xp + amt;
        let lvl = u.level;

        while (lvl < MAX_LEVEL) {
          const need = 100 + (lvl * 25);

          if (xp < need) break;

          xp -= need;
          lvl++;
        }

        if (lvl >= MAX_LEVEL) xp = 0;

        await db.run(
          'INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, ?, ?)',
          [target.id, gId, xp, lvl]
        );

        return i.editReply({
          content: `✅ Ajout de **${amt} XP** à <@${target.id}> (Niveau : ${lvl}/${MAX_LEVEL}).`
        });
      }

      // SETLEVEL

      if (commandName === 'setlevel') {
        const target = options.getUser('membre');
        const lvl = options.getInteger('niveau');

        await db.run(
          'INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, ?)',
          [target.id, gId, lvl]
        );

        return i.editReply({
          content: `✅ Niveau de <@${target.id}> fixé à **${lvl}/${MAX_LEVEL}**.`
        });
      }

      // RESETLEVEL

      if (commandName === 'resetlevel') {
        const target = options.getUser('membre');

        await db.run(
          'INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, 0)',
          [target.id, gId]
        );

        return i.editReply({
          content: `✅ Progression de <@${target.id}> réinitialisée à 0.`
        });
      }

      // MENU VOCAL

      if (commandName === 'menu' && options.getSubcommand() === 'vocal') {
        const u = await db.get(
          'SELECT level FROM users WHERE userId = ? AND guildId = ?',
          [uId, gId]
        );

        const lvl = u ? u.level : 0;

        if (lvl < 100) {
          return i.editReply({
            content: `⛔ Niveau **100** requis (Ton niveau : ${lvl}).`
          });
        }

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('v_sel')
            .setPlaceholder('Choisis une action...')
            .addOptions([
              {
                label: 'Verrouiller (Kick)',
                value: 'lock_kick',
                emoji: '🔒'
              },
              {
                label: 'Verrouiller (Kick + Timeout 1 min)',
                value: 'lock_timeout',
                emoji: '⚡'
              },
              {
                label: 'Whitelist (Autoriser)',
                value: 'white',
                emoji: '✅'
              },
              {
                label: 'Blacklist',
                value: 'black',
                emoji: '⛔'
              },
              {
                label: 'Rendre Public',
                value: 'public',
                emoji: '🔓'
              }
            ])
        );

        return i.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#3498db')
              .setTitle('🛡️ Centre Vocal')
              .setDescription('Sélectionne une option :')
          ],
          components: [row]
        });
      }
    }

    // --------------------------
    // MENUS DE SÉLECTION
    // --------------------------

    if (i.isStringSelectMenu()) {

      const vChan = i.member.voice.channel;

      if (!vChan) {
        return i.reply({
          content: '❌ Connecte-toi à un salon vocal.',
          ephemeral: true
        });
      }

      const val = i.values[0];

      // MENU PRINCIPAL

      if (i.customId === 'v_sel') {

        if (val === 'lock_kick' || val === 'lock_timeout') {
          const type = val === 'lock_kick' ? 'kick' : 'timeout';

          await db.run(
            'INSERT OR REPLACE INTO locks (channelId, ownerId, type) VALUES (?, ?, ?)',
            [vChan.id, uId, type]
          );

          return i.update({
            content: `🔒 Salon verrouillé (${type === 'timeout' ? 'Kick + Timeout 1 min' : 'Kick'}).`,
            embeds: [],
            components: []
          });
        }

        if (val === 'white' || val === 'black') {
          const lock = await db.get(
            'SELECT * FROM locks WHERE channelId = ? AND ownerId = ?',
            [vChan.id, uId]
          );

          if (!lock) {
            return i.reply({
              content: '❌ Tu ne possèdes pas ce salon verrouillé.',
              ephemeral: true
            });
          }

          const members = vChan.members.filter(m => m.id !== uId);

          if (!members.size) {
            return i.reply({
              content: '❌ Personne d’autre dans le salon.',
              ephemeral: true
            });
          }

          const menu = new StringSelectMenuBuilder()
            .setCustomId(`sub_${val}`)
            .setPlaceholder('Choisis un membre...')
            .addOptions(
              members.map(m => ({
                label: m.user.username.slice(0, 25),
                value: m.id
              }))
            );

          return i.update({
            content: 'Choisis le membre :',
            embeds: [],
            components: [
              new ActionRowBuilder().addComponents(menu)
            ]
          });
        }

        if (val === 'public') {
          await db.run(
            'DELETE FROM locks WHERE channelId = ? AND ownerId = ?',
            [vChan.id, uId]
          );

          await db.run(
            'DELETE FROM access WHERE channelId = ?',
            [vChan.id]
          );

          return i.update({
            content: '🔓 Salon public.',
            embeds: [],
            components: []
          });
        }
      }

      // WHITELIST / BLACKLIST

      if (i.customId === 'sub_white' || i.customId === 'sub_black') {
        const mode = i.customId === 'sub_white' ? 'white' : 'black';

        const lock = await db.get(
          'SELECT * FROM locks WHERE channelId = ? AND ownerId = ?',
          [vChan.id, uId]
        );

        if (!lock) {
          return i.reply({
            content: '❌ Tu ne possèdes pas ce salon verrouillé.',
            ephemeral: true
          });
        }

        const targetId = i.values[0];
        const targetMem = vChan.members.get(targetId);

        if (!targetMem) {
          return i.reply({
            content: '❌ Ce membre ne se trouve plus dans le salon.',
            ephemeral: true
          });
        }

        await db.run(
          'INSERT OR REPLACE INTO access (channelId, userId, mode) VALUES (?, ?, ?)',
          [vChan.id, targetId, mode]
        );

        if (mode === 'black') {
          await targetMem.voice.disconnect('Blacklisté de la vocale').catch(() => {});
        }

        return i.update({
          content: `✅ Action appliquée sur <@${targetId}>.`,
          embeds: [],
          components: []
        });
      }
    }

  } catch (err) {
    console.error('[INTERACTION ERROR]', err);

    if (i.isRepliable() && !i.replied && !i.deferred) {
      await i.reply({
        content: '❌ Une erreur est survenue. Consulte les logs du bot.',
        ephemeral: true
      }).catch(() => {});
    } else if (i.isRepliable() && i.deferred) {
      await i.editReply({
        content: '❌ Une erreur est survenue. Consulte les logs du bot.',
        embeds: [],
        components: []
      }).catch(() => {});
    }
  }
});

// ==============================
// ERREURS
// ==============================

process.on('unhandledRejection', err => {
  console.error('[UNHANDLED REJECTION]', err);
});

process.on('uncaughtException', err => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});

// ==============================
// DÉMARRAGE
// ==============================

async function startBot() {
  try {
    if (!process.env.DISCORD_TOKEN) {
      throw new Error('DISCORD_TOKEN manquant dans les variables Render.');
    }

    await initDB();

    console.log('[START] Démarrage du bot...');

    await client.login(process.env.DISCORD_TOKEN);

  } catch (err) {
    console.error('[START ERROR]', err);
    process.exit(1);
  }
}

startBot();
    
