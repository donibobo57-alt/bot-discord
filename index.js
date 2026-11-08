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

async function applyLevelRoles(member, lvl) {
  if (!member || !member.guild) return;
  const roles = { 10: 'Novice des messages', 30: 'Avancé des messages', 50: 'Semi-Pro message', 80: 'Légendaire des messages', 100: 'Légende du message' };
  let targetName = null;
  for (const [l, name] of Object.entries(roles)) { if (lvl >= parseInt(l)) targetName = name; }
  let role = targetName ? member.guild.roles.cache.find(r => r.name === targetName) : null;
  if (targetName && !role) { try { role = await member.guild.roles.create({ name: targetName, color: '#5865F2' }); } catch (e) {} }
  try {
    for (const r of member.roles.cache.filter(r => Object.values(roles).includes(r.name)).values()) {
      if (!role || r.id !== role.id) await member.roles.remove(r).catch(() => {});
    }
    if (role && !member.roles.cache.has(role.id)) await member.roles.add(role).catch(() => {});
  } catch (e) {}
}

async function addXpFromMessage(member, guildId, add, defChan) {
  let u = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [member.id, guildId]) || { xp: 0, level: 0 };
  let xp = u.xp + add, lvl = u.level, need = 100 + (lvl * 25);
  let cfg = await db.get(`SELECT chanId FROM config WHERE guildId = ?`, [guildId]);
  let chan = cfg ? member.guild.channels.cache.get(cfg.chanId) || defChan : defChan;

  let loops = 0;
  while (xp >= need && loops < 50) {
    xp -= need; lvl++; loops++; need = 100 + (lvl * 25);
    await applyLevelRoles(member, lvl);
    if (chan) {
      chan.send({ embeds: [new EmbedBuilder().setColor('#00FFCC').setTitle('🎉 NOUVEAU NIVEAU !').setDescription(`Félicitations <@${member.id}>, tu passes au **niveau ${lvl}** ! 🚀`).setFooter({ text: CREATOR })] }).catch(() => {});
    }
  }
  await db.run(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, ?, ?)`, [member.id, guildId, xp, lvl]);
}

const cmds = [
  new SlashCommandBuilder().setName('rank').setDescription('Ton profil et XP'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Classement du serveur'),
  new SlashCommandBuilder().setName('setsalon').setDescription('Salon des niveaux (Admin)').addChannelOption(o => o.setName('salon').setDescription('Salon').setRequired(true)),
  new SlashCommandBuilder().setName('addxp').setDescription('Ajouter de l’XP (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(o => o.setName('montant').setDescription('XP').setRequired(true)),
  new SlashCommandBuilder().setName('setlevel').setDescription('Modifier le niveau (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(o => o.setName('niveau').setDescription('Niveau').setRequired(true)),
  new SlashCommandBuilder().setName('resetlevel').setDescription('Réinitialiser (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)),
  new SlashCommandBuilder().setName('menu').setDescription('Centre de contrôle').addSubcommand(s => s.setName('vocal').setDescription('Sécurité vocale (Niveau 100+)'))
].map(c => c.toJSON());

client.once('ready', async () => {
  await initDB();
  console.log(`🤖 Bot connecté : ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: cmds });
  client.user.setPresence({ activities: [{ name: '/menu vocal | 🛡️' }], status: 'online' });
});

client.on('messageCreate', async m => {
  if (m.author.bot || !m.guild || !db) return;
  await addXpFromMessage(m.member, m.guild.id, 15, m.channel);
});

client.on('voiceStateUpdate', async (oldS, newS) => {
  if (!newS.channelId || newS.member.user.bot || !db) return;
  let b = await db.get(`SELECT * FROM access WHERE channelId = ? AND userId = ? AND mode = 'black'`, [newS.channelId, newS.member.id]);
  if (b) {
    await newS.member.voice.disconnect("Blacklisté de ce salon").catch(() => {});
    return;
  }
  let l = await db.get(`SELECT * FROM locks WHERE channelId = ?`, [newS.channelId]);
  if (!l || newS.member.id === l.ownerId) return;
  let a = await db.get(`SELECT * FROM access WHERE channelId = ? AND userId = ? AND mode = 'white'`, [newS.channelId, newS.member.id]);
  if (!a) {
    await newS.member.voice.disconnect("Salon verrouillé").catch(() => {});
    if (l.type === 'timeout') {
      await newS.member.timeout(60000, "Tentative d'intrusion dans un salon vocal verrouillé").catch(() => {});
    }
  }
});

client.on('interactionCreate', async i => {
  if (!db || !i.guild) return;
  const gId = i.guild.id, uId = i.user.id;

  if (i.isChatInputCommand()) {
    const { commandName, options } = i;

    if (commandName === 'menu' && options.getSubcommand() === 'vocal') {
      let u = await db.get(`SELECT level FROM users WHERE userId = ? AND guildId = ?`, [uId, gId]);
      if (!u || u.level < 100) return i.reply({ content: `⛔ Niveau **100** requis (Ton niveau : ${u ? u.level : 0}).`, ephemeral: true });
      
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('v_sel').setPlaceholder('Choisis une action...').addOptions([
          { label: 'Verrouiller (Kick)', value: 'lock_kick', emoji: '🔒' },
          { label: 'Verrouiller (Kick + Timeout 1 min)', value: 'lock_timeout', emoji: '⚡' },
          { label: 'Whitelist (Autoriser)', value: 'white', emoji: '✅' },
          { label: 'Blacklist (Bannir)', value: 'black', emoji: '⛔' },
          { label: 'Rendre Public (VPU)', value: 'public', emoji: '🔓' }
        ])
      );
      return i.reply({ embeds: [new EmbedBuilder().setColor('#3498db').setTitle('🛡️ Centre Vocal').setDescription('Sélectionne une option :')], components: [row], ephemeral: true });
    }

    if (['setsalon', 'addxp', 'setlevel', 'resetlevel'].includes(commandName)) {
      let isAdmin = i.member.permissions.has(PermissionFlagsBits.Administrator) || uId === i.guild.ownerId;
      if (!isAdmin) {
        try { await i.member.timeout(60000, "Tentative d'utilisation non autorisée d'une commande administrative").catch(() => {}); } catch(e) {}
        return i.reply({ 
          embeds: [new EmbedBuilder().setColor('#FF0033').setTitle('🚨 ACCÈS REFUSÉ').setDescription(`Attention <@${uId}>, cette commande est réservée aux administrateurs.\n⚡ *Une exclusion de 1 minute vous a été appliquée.*`).setFooter({ text: CREATOR })], 
          ephemeral: true 
        });
      }
    }

    if (commandName === 'rank') {
      let u = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [uId, gId]) || { xp: 0, level: 0 };
      let need = 100 + (u.level * 25), pct = Math.min(Math.floor((u.xp / need) * 100), 100);
      let bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
      return i.reply({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle(`🌟 Profil de ${i.user.username}`).setThumbnail(i.user.displayAvatarURL()).addFields({ name: 'Niveau', value: `\`${u.level}\``, inline: true }, { name: 'XP', value: `\`${u.xp} / ${need}\``, inline: true }, { name: 'Progression', value: `\`${bar}\` **${pct}%**`, inline: false }).setFooter({ text: CREATOR })] });
    }

    if (commandName === 'leaderboard') {
      let top = await db.all(`SELECT * FROM users WHERE guildId = ? ORDER BY level DESC, xp DESC LIMIT 5`, [gId]);
      let desc = top.length ? top.map((x, idx) => `**#${idx + 1}** <@${x.userId}> — Niveau **${x.level}**`).join('\n') : 'Aucun classement.';
      return i.reply({ embeds: [new EmbedBuilder().setColor('#FFD700').setTitle('🏆 Classement Global').setDescription(desc).setFooter({ text: CREATOR })] });
    }

    if (commandName === 'setsalon') {
      let c = options.getChannel('salon');
      await db.run(`INSERT OR REPLACE INTO config (guildId, chanId) VALUES (?, ?)`, [gId, c.id]);
      return i.reply({ content: `✅ Salon défini sur <#${c.id}>.`, ephemeral: true });
    }

    if (commandName === 'addxp') {
      let target = options.getUser('membre'), amt = options.getInteger('montant');
      let mem = await i.guild.members.fetch(target.id);
      let u = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [target.id, gId]) || { xp: 0, level: 0 };
      let xp = u.xp + amt, lvl = u.level, need = 100 + (lvl * 25);
      while (xp >= need) { xp -= need; lvl++; need = 100 + (lvl * 25); }
      await db.run(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, ?, ?)`, [target.id, gId, xp, lvl]);
      await applyLevelRoles(mem, lvl);
      return i.reply({ content: `✅ Ajout de **${amt} XP** à <@${target.id}> (Niveau : ${lvl}).`, ephemeral: true });
    }

    if (commandName === 'setlevel') {
      let target = options.getUser('membre'), lvl = options.getInteger('niveau');
      let mem = await i.guild.members.fetch(target.id);
      await db.run(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, ?)`, [target.id, gId, lvl]);
      await applyLevelRoles(mem, lvl);
      return i.reply({ content: `✅ Niveau de <@${target.id}> fixé à **${lvl}**.`, ephemeral: true });
    }

    if (commandName === 'resetlevel') {
      let target = options.getUser('membre');
      let mem = await i.guild.members.fetch(target.id);
      await db.run(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, 0, 0)`, [target.id, gId]);
      await applyLevelRoles(mem, 0);
      return i.reply({ content: `✅ Progression de <@${target.id}> réinitialisée.`, ephemeral: true });
    }
  }

  if (i.isStringSelectMenu()) {
    let val = i.values[0], vChan = i.member.voice.channel;
    if (!vChan && val !== 'public') return i.reply({ content: '❌ Connecte-toi à un salon vocal.', ephemeral: true });

    if (val === 'lock_kick' || val === 'lock_timeout') {
      let type = val === 'lock_kick' ? 'kick' : 'timeout';
      await db.run(`INSERT OR REPLACE INTO locks (channelId, ownerId, type) VALUES (?, ?, ?)`, [vChan.id, uId, type]);
      return i.update({ content: `🔒 Salon verrouillé (${type}).`, embeds: [], components: [] });
    }

    if (val === 'white' || val === 'black') {
      let l = await db.get(`SELECT * FROM locks WHERE channelId = ? AND ownerId = ?`, [vChan.id, uId]);
      if (!l) return i.reply({ content: '❌ Tu ne possèdes pas ce salon.', ephemeral: true });
      let members = vChan.members.filter(m => m.id !== uId);
      if (!members.size) return i.reply({ content: '❌ Personne d’autre dans le salon.', ephemeral: true });
      let menu = new StringSelectMenuBuilder().setCustomId(`sub_${val}`).setPlaceholder('Choisis un membre...').addOptions(members.map(m => ({ label: m.user.username.slice(0, 25), value: m.id })));
      return i.update({ content: 'Choisis le membre :', components: [new ActionRowBuilder().addComponents(menu)] });
    }

    if (val === 'public') {
      await db.run(`DELETE FROM locks WHERE channelId = ? OR ownerId = ?`, [vChan?.id || '', uId]);
      await db.run(`DELETE FROM access WHERE channelId = ?`, [vChan?.id || '']);
      return i.update({ content: `🔓 Salon public.`, embeds: [], components: [] });
    }

    if (i.customId.startsWith('sub_')) {
      let mode = i.customId.split('_')[1] === 'white' ? 'white' : 'black';
      await db.run(`INSERT OR REPLACE INTO access (channelId, userId, mode) VALUES (?, ?, ?)`, [vChan.id, i.values[0], mode]);
      if (mode === 'black') {
        let targetMem = vChan.members.get(i.values[0]);
        if (targetMem) await targetMem.voice.disconnect("Blacklisté de la vocale").catch(() => {});
      }
      return i.update({ content: `✅ Action appliquée sur <@${i.values[0]}>.`, components: [] });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
