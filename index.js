const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates] });
let db;
const CREATOR = "bankiozi";

async function initDB() {
  db = await open({ filename: './database.sqlite', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (userId TEXT, guildId TEXT, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 0, PRIMARY KEY (userId, guildId));
    CREATE TABLE IF NOT EXISTS config (guildId TEXT PRIMARY KEY, chanId TEXT);
    CREATE TABLE IF NOT EXISTS locks (channelId TEXT PRIMARY KEY, ownerId TEXT, type TEXT);
    CREATE TABLE IF NOT EXISTS access (channelId TEXT, userId TEXT, mode TEXT, PRIMARY KEY (channelId, userId, mode));
  `);
}

// Fonction centralisée et sécurisée pour gérer l'XP, les niveaux et les notifications progressives
async function addXpToUser(member, guildId, xpToAdd, defaultChannel) {
  let u = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [member.id, guildId]);
  if (!u) {
    await db.run(`INSERT INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, 0)`, [member.id, guildId]);
    u = { xp: 0, level: 0 };
  }

  let xp = u.xp + xpToAdd;
  let lvl = u.level;
  let cfg = await db.get(`SELECT chanId FROM config WHERE guildId = ?`, [guildId]);
  let targetChan = cfg ? member.guild.channels.cache.get(cfg.chanId) || defaultChannel : defaultChannel;

  // Boucle progressive pour gérer proprement les montées de niveau multiples (ex: /addxp massif)
  let leveledUp = false;
  let need = 100 + (lvl * 25);
  
  while (xp >= need) {
    xp -= need;
    lvl++;
    leveledUp = true;
    need = 100 + (lvl * 25);

    if (targetChan) {
      const levelEmbed = new EmbedBuilder()
        .setColor('#00FFCC')
        .setTitle('🎉 NOUVEAU PALIER ATTEINT !')
        .setDescription(`Félicitations <@${member.id}> ! Tu viens de franchir le **niveau ${lvl}** avec brio ! 🚀`)
        .addFields({ name: '✨ Prochain objectif', value: `\`\`\`ini\n[ ${xp} / ${need} XP requis ]\`\`\``, inline: false })
        .setFooter({ text: `Créateur : ${CREATOR} • Système d'Évolution` })
        .setTimestamp();
      await targetChan.send({ embeds: [levelEmbed] }).catch(() => {});
    }
  }

  await db.run(`UPDATE users SET xp = ?, level = ? WHERE userId = ? AND guildId = ?`, [xp, lvl, member.id, guildId]);
  return { xp, lvl };
}

const cmds = [
  new SlashCommandBuilder().setName('rank').setDescription('Afficher ton profil détaillé et ta progression XP'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Afficher le classement officiel du serveur'),
  new SlashCommandBuilder().setName('setsalon').setDescription('Définir le salon des notifications de niveau (Admin)').addChannelOption(o => o.setName('salon').setDescription('Salon cible').setRequired(true)),
  new SlashCommandBuilder().setName('addxp').setDescription('Ajouter de l’XP à un membre (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(o => o.setName('montant').setDescription('Quantité d’XP').setRequired(true)),
  new SlashCommandBuilder().setName('setlevel').setDescription('Modifier directement le niveau d’un membre (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(o => o.setName('niveau').setDescription('Niveau cible').setRequired(true)),
  new SlashCommandBuilder().setName('resetlevel').setDescription('Réinitialiser la progression d’un membre (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)),
  new SlashCommandBuilder().setName('menu').setDescription('Centre de contrôle').addSubcommand(s => s.setName('vocal').setDescription('Gérer la sécurité de ton salon vocal (Niveau 100+)'))
].map(c => c.toJSON());

client.once('ready', async () => {
  await initDB();
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: cmds });
  client.user.setPresence({ activities: [{ name: '/menu vocal | 🛡️ Sécurité' }], status: 'online' });
});

// Gain d'XP automatique lors de l'envoi de messages
client.on('messageCreate', async m => {
  if (m.author.bot || !m.guild || !db) return;
  await addXpToUser(m.member, m.guild.id, 15, m.channel);
});

// Surveillance vocale et sécurité anti-intrusion
client.on('voiceStateUpdate', async (oldS, newS) => {
  if (!newS.channelId || newS.member.user.bot || !db) return;
  let b = await db.get(`SELECT * FROM access WHERE channelId = ? AND userId = ? AND mode = 'black'`, [newS.channelId, newS.member.id]);
  if (b) return newS.member.voice.disconnect().catch(() => {});
  
  let l = await db.get(`SELECT * FROM locks WHERE channelId = ?`, [newS.channelId]);
  if (!l || newS.member.id === l.ownerId) return;
  let a = await db.get(`SELECT * FROM access WHERE channelId = ? AND userId = ? AND mode = 'white'`, [newS.channelId, newS.member.id]);
  if (!a) {
    await newS.member.voice.disconnect().catch(() => {});
    if (l.type === 'timeout') await newS.member.timeout(60000, "Tentative d'accès non autorisée").catch(() => {});
  }
});

// Gestion des interactions (Commandes et Menus)
client.on('interactionCreate', async i => {
  if (!db) return;
  const gId = i.guild?.id, uId = i.user.id;

  if (i.isChatInputCommand()) {
    const { commandName, options } = i;

    if (commandName === 'menu' && options.getSubcommand() === 'vocal') {
      let u = await db.get(`SELECT level FROM users WHERE userId = ? AND guildId = ?`, [uId, gId]);
      if (!u || u.level < 100) return i.reply({ content: `⛔ **Accès Refusé :** Niveau **100** requis pour ouvrir le panneau de sécurité (Ton niveau actuel : ${u ? u.level : 0}).`, ephemeral: true });
      
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('v_sel').setPlaceholder('Sélectionne une option de gestion...').addOptions([
          { label: 'Verrouiller (Kick instantané)', value: 'lock_kick', emoji: '🔒' },
          { label: 'Verrouiller (Kick + Timeout)', value: 'lock_timeout', emoji: '⚡' },
          { label: 'Whitelist (Autoriser un membre)', value: 'white', emoji: '✅' },
          { label: 'Blacklist (Bannir un membre)', value: 'black', emoji: '⛔' },
          { label: 'Rendre public (VPU)', value: 'public', emoji: '🔓' }
        ])
      );
      return i.reply({ embeds: [new EmbedBuilder().setColor('#3498db').setTitle('🛡️ Centre de Contrôle Vocal Sécurisé').setDescription('Utilise le menu déroulant ci-dessous pour configurer ton salon :').setFooter({ text: CREATOR })], components: [row], ephemeral: true });
    }

    if (['setsalon', 'addxp', 'setlevel', 'resetlevel'].includes(commandName) && !i.member.permissions.has(PermissionFlagsBits.Administrator) && uId !== i.guild.ownerId) {
      return i.reply({ content: '❌ **Sécurité :** Commande réservée aux administrateurs du serveur.', ephemeral: true });
    }

    // Commande /rank magnifiquement détaillée
    if (commandName === 'rank') {
      let u = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [uId, gId]) || { xp: 0, level: 0 };
      let need = 100 + (u.level * 25), pct = Math.min(Math.floor((u.xp / need) * 100), 100);
      let bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
      
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`🌟 Fiche d'Identité & Progression — ${i.user.username}`)
        .setThumbnail(i.user.displayAvatarURL({ dynamic: true, size: 512 }))
        .addFields(
          { name: '🎖️ Niveau Actuel', value: `\`\`\`fix\nNiveau ${u.level}\`\`\``, inline: true },
          { name: '✨ Expérience XP', value: `\`\`\`ini\n[ ${u.xp} / ${need} XP ]\`\`\``, inline: true },
          { name: '📈 Barre d’Évolution', value: `\`${bar}\` **${pct}%**`, inline: false }
        )
        .setFooter({ text: `Créateur : ${CREATOR} • Bot Officiel`, iconURL: i.client.user.displayAvatarURL() })
        .setTimestamp();
      return i.reply({ embeds: [embed] });
    }

    // Commande /leaderboard
    if (commandName === 'leaderboard') {
      let top = await db.all(`SELECT * FROM users WHERE guildId = ? ORDER BY level DESC, xp DESC LIMIT 5`, [gId]);
      let desc = top.length ? top.map((x, idx) => `**#${idx + 1}** <@${x.userId}> — Niveau **${x.level}** (\`${x.xp} XP\`)`).join('\n') : 'Aucun classement disponible.';
      return i.reply({ embeds: [new EmbedBuilder().setColor('#FFD700').setTitle('🏆 Classement Global des Légendes').setDescription(desc).setFooter({ text: CREATOR }).setTimestamp()] });
    }

    if (commandName === 'setsalon') {
      let c = options.getChannel('salon');
      await db.run(`INSERT OR REPLACE INTO config (guildId, chanId) VALUES (?, ?)`, [gId, c.id]);
      return i.reply({ content: `✅ Salon des notifications de niveau défini avec succès sur <#${c.id}>.`, ephemeral: true });
    }

    // Gestion des commandes admin d'XP et de niveaux (avec notifications fluides)
    if (commandName === 'addxp') {
      let target = options.getUser('membre');
      let amount = options.getInteger('montant');
      let targetMember = await i.guild.members.fetch(target.id);
      let res = await addXpToUser(targetMember, gId, amount, i.channel);
      return i.reply({ content: `✅ Ajout réussi de **${amount} XP** à <@${target.id}> (Niveau actuel : **${res.lvl}**).`, ephemeral: true });
    }

    if (commandName === 'setlevel') {
      let target = options.getUser('membre');
      let lvl = options.getInteger('niveau');
      await db.run(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, ?)`, [target.id, gId, lvl]);
      return i.reply({ content: `✅ Le niveau de <@${target.id}> a été fixé directement à **${lvl}**.`, ephemeral: true });
    }

    if (commandName === 'resetlevel') {
      let target = options.getUser('membre');
      await db.run(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, 0)`, [target.id, gId]);
      return i.reply({ content: `✅ La progression de <@${target.id}> a été entièrement réinitialisée à zéro.`, ephemeral: true });
    }
  }

  // Gestion du menu déroulant vocal
  if (i.isStringSelectMenu()) {
    let val = i.values[0], vChan = i.member.voice.channel;
    if (!vChan && val !== 'public') return i.reply({ content: '❌ Tu dois être connecté dans un salon vocal pour effectuer cette action.', ephemeral: true });

    if (val === 'lock_kick' || val === 'lock_timeout') {
      let type = val === 'lock_kick' ? 'kick' : 'timeout';
      await db.run(`INSERT OR REPLACE INTO locks (channelId, ownerId, type) VALUES (?, ?, ?)`, [vChan.id, uId, type]);
      return i.update({ content: `🔒 Salon **${vChan.name}** verrouillé avec succès (${type === 'timeout' ? 'Kick + Timeout' : 'Kick'}).`, embeds: [], components: [] });
    }

    if (val === 'white' || val === 'black') {
      let l = await db.get(`SELECT * FROM locks WHERE channelId = ? AND ownerId = ?`, [vChan.id, uId]);
      if (!l) return i.reply({ content: '❌ Tu ne possèdes pas de verrouillage actif sur ce salon vocal.', ephemeral: true });
      let members = vChan.members.filter(m => m.id !== uId);
      if (!members.size) return i.reply({ content: '❌ Aucun autre membre n’est présent dans ton salon vocal.', ephemeral: true });

      let menu = new StringSelectMenuBuilder().setCustomId(`sub_${val}`).setPlaceholder('Sélectionne le membre...').addOptions(members.map(m => ({ label: m.user.username.slice(0, 25), value: m.id })));
      return i.update({ content: 'Choisis le membre concerné :', components: [new ActionRowBuilder().addComponents(menu)] });
    }

    if (val === 'public') {
      await db.run(`DELETE FROM locks WHERE channelId = ? OR ownerId = ?`, [vChan?.id || '', uId]);
      await db.run(`DELETE FROM access WHERE channelId = ?`, [vChan?.id || '']);
      return i.update({ content: `🔓 Salon vocal remis en mode public (VPU).`, embeds: [], components: [] });
    }

    if (i.customId.startsWith('sub_')) {
      let mode = i.customId.split('_')[1] === 'white' ? 'white' : 'black';
      await db.run(`INSERT OR REPLACE INTO access (channelId, userId, mode) VALUES (?, ?, ?)`, [vChan.id, i.values[0], mode]);
      if (mode === 'black') vChan.members.get(i.values[0])?.voice.disconnect().catch(() => {});
      return i.update({ content: `✅ Action enregistrée avec succès pour <@${i.values[0]}>.`, components: [] });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
                      
