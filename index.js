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

const cmds = [
  new SlashCommandBuilder().setName('rank').setDescription('Afficher ton profil et ta progression XP'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Afficher le classement du serveur'),
  new SlashCommandBuilder().setName('setsalon').setDescription('Définir le salon des niveaux (Admin)').addChannelOption(o => o.setName('salon').setDescription('Salon').setRequired(true)),
  new SlashCommandBuilder().setName('addxp').setDescription('Ajouter de l’XP (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(o => o.setName('montant').setDescription('XP').setRequired(true)),
  new SlashCommandBuilder().setName('setlevel').setDescription('Modifier le niveau (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)).addIntegerOption(o => o.setName('niveau').setDescription('Niveau').setRequired(true)),
  new SlashCommandBuilder().setName('resetlevel').setDescription('Réinitialiser un membre (Admin)').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)),
  new SlashCommandBuilder().setName('menu').setDescription('Panneau de gestion').addSubcommand(s => s.setName('vocal').setDescription('Sécurité vocale (Niveau 100+)'))
].map(c => c.toJSON());

client.once('ready', async () => {
  await initDB();
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: cmds });
  client.user.setPresence({ activities: [{ name: '/menu vocal | 🛡️' }], status: 'online' });
});

client.on('messageCreate', async m => {
  if (m.author.bot || !m.guild || !db) return;
  let u = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [m.author.id, m.guild.id]);
  if (!u) {
    await db.run(`INSERT INTO users (userId, guildId, xp, level) VALUES (?, ?, 15, 0)`, [m.author.id, m.guild.id]);
    return;
  }
  let xp = u.xp + 15, lvl = u.level, need = 100 + (lvl * 25);
  if (xp >= need) { xp -= need; lvl++; }
  await db.run(`UPDATE users SET xp = ?, level = ? WHERE userId = ? AND guildId = ?`, [xp, lvl, m.author.id, m.guild.id]);
});

client.on('voiceStateUpdate', async (oldS, newS) => {
  if (!newS.channelId || newS.member.user.bot || !db) return;
  let b = await db.get(`SELECT * FROM access WHERE channelId = ? AND userId = ? AND mode = 'black'`, [newS.channelId, newS.member.id]);
  if (b) return newS.member.voice.disconnect().catch(() => {});
  
  let l = await db.get(`SELECT * FROM locks WHERE channelId = ?`, [newS.channelId]);
  if (!l || newS.member.id === l.ownerId) return;
  let a = await db.get(`SELECT * FROM access WHERE channelId = ? AND userId = ? AND mode = 'white'`, [newS.channelId, newS.member.id]);
  if (!a) {
    await newS.member.voice.disconnect().catch(() => {});
    if (l.type === 'timeout') await newS.member.timeout(60000, "Salon sécurisé").catch(() => {});
  }
});

client.on('interactionCreate', async i => {
  if (!db) return;
  const gId = i.guild?.id, uId = i.user.id;

  if (i.isChatInputCommand()) {
    const { commandName, options } = i;

    if (commandName === 'menu' && options.getSubcommand() === 'vocal') {
      let u = await db.get(`SELECT level FROM users WHERE userId = ? AND guildId = ?`, [uId, gId]);
      if (!u || u.level < 100) return i.reply({ content: `⛔ Niveau **100** requis (Ton niveau : ${u ? u.level : 0}).`, ephemeral: true });
      
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('v_sel').setPlaceholder('Choisis une action...').addOptions([
          { label: 'Verrouiller (Kick)', value: 'lock_kick', emoji: '🔒' },
          { label: 'Verrouiller (Kick + Timeout)', value: 'lock_timeout', emoji: '⚡' },
          { label: 'Whitelist (Autoriser)', value: 'white', emoji: '✅' },
          { label: 'Blacklist (Bannir)', value: 'black', emoji: '⛔' },
          { label: 'Rendre Public (VPU)', value: 'public', emoji: '🔓' }
        ])
      );
      return i.reply({ embeds: [new EmbedBuilder().setColor('#3498db').setTitle('🛡️ Centre Vocal').setDescription('Sélectionne une option ci-dessous :')], components: [row], ephemeral: true });
    }

    if (['setsalon', 'addxp', 'setlevel', 'resetlevel'].includes(commandName) && !i.member.permissions.has(PermissionFlagsBits.Administrator) && uId !== i.guild.ownerId) {
      return i.reply({ content: '❌ Réservé aux administrateurs.', ephemeral: true });
    }

    if (commandName === 'rank') {
      let u = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [uId, gId]) || { xp: 0, level: 0 };
      let need = 100 + (u.level * 25), pct = Math.min(Math.floor((u.xp / need) * 100), 100);
      let bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
      
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`🌟 Profil de ${i.user.username}`)
        .setThumbnail(i.user.displayAvatarURL())
        .addFields(
          { name: '🎖️ Niveau', value: `\`\`\`fix\nNiveau ${u.level}\`\`\``, inline: true },
          { name: '✨ Expérience', value: `\`\`\`ini\n[ ${u.xp} / ${need} XP ]\`\`\``, inline: true },
          { name: '📈 Progression', value: `\`${bar}\` **${pct}%**`, inline: false }
        )
        .setFooter({ text: `Créateur : ${CREATOR}` });
      return i.reply({ embeds: [embed] });
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

    if (commandName === 'addxp' || commandName === 'setlevel' || commandName === 'resetlevel') {
      let target = options.getUser('membre');
      let u = await db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [target.id, gId]) || { xp: 0, level: 0 };
      let xp = u.xp, lvl = u.level;

      if (commandName === 'addxp') xp += options.getInteger('montant');
      if (commandName === 'setlevel') lvl = options.getInteger('niveau');
      if (commandName === 'resetlevel') { xp = 0; lvl = 0; }

      await db.run(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, ?, ?)`, [target.id, gId, xp, lvl]);
      return i.reply({ content: `✅ Modification enregistrée pour <@${target.id}>.`, ephemeral: true });
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
      if (!members.size) return i.reply({ content: '❌ Personne d’autre dans le salon.', ephemeral: false });

      let menu = new StringSelectMenuBuilder().setCustomId(`sub_${val}`).setPlaceholder('Choisis un membre...').addOptions(members.map(m => ({ label: m.user.username.slice(0, 25), value: m.id })));
      return i.update({ content: 'Sélectionne le membre :', components: [new ActionRowBuilder().addComponents(menu)] });
    }

    if (val === 'public') {
      await db.run(`DELETE FROM locks WHERE channelId = ? OR ownerId = ?`, [vChan?.id || '', uId]);
      await db.run(`DELETE FROM access WHERE channelId = ?`, [vChan?.id || '']);
      return i.update({ content: `🔓 Salon rendu public.`, embeds: [], components: [] });
    }

    if (i.customId.startsWith('sub_')) {
      let mode = i.customId.split('_')[1] === 'white' ? 'white' : 'black';
      await db.run(`INSERT OR REPLACE INTO access (channelId, userId, mode) VALUES (?, ?, ?)`, [vChan.id, i.values[0], mode]);
      if (mode === 'black') vChan.members.get(i.values[0])?.voice.disconnect().catch(() => {});
      return i.update({ content: `✅ Action appliquée sur <@${i.values[0]}>.`, components: [] });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

