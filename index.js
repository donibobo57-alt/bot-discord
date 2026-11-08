const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates] });
let db;
const APP_TAG = "bankiozi";

const dbQuery = async (query, params = []) => db.run(query, params);
const dbGet = async (query, params = []) => db.get(query, params);
const dbAll = async (query, params = []) => db.all(query, params);

async function initDB() {
  db = await open({ filename: './database.sqlite', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (userId TEXT, guildId TEXT, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 0, PRIMARY KEY (userId, guildId));
    CREATE TABLE IF NOT EXISTS config (guildId TEXT PRIMARY KEY, channelId TEXT);
    CREATE TABLE IF NOT EXISTS v_locks (channelId TEXT PRIMARY KEY, ownerId TEXT, mode TEXT);
    CREATE TABLE IF NOT EXISTS v_access (channelId TEXT, userId TEXT, type TEXT, PRIMARY KEY (channelId, userId, type));
  `);
  console.log("📂 Base de données initialisée avec succès !");
}

const botCommands = [
  new SlashCommandBuilder().setName('profil').setDescription('Consulter ton profil d’activité et ton niveau'),
  new SlashCommandBuilder().setName('classement').setDescription('Afficher le top des membres les plus actifs'),
  new SlashCommandBuilder().setName('salon-logs').setDescription('Définir le salon des notifications de niveau (Admin)').addChannelOption(o => o.setName('salon').setDescription('Salon cible').setRequired(true)),
  new SlashCommandBuilder().setName('modifier-xp').setDescription('Gestion administrative de l’XP').addUserOption(o => o.setName('membre').setDescription('Cible').setRequired(true)).addIntegerOption(o => o.setName('quantite').setDescription('Montant').setRequired(true)),
  new SlashCommandBuilder().setName('modifier-niveau').setDescription('Gestion administrative du niveau').addUserOption(o => o.setName('membre').setDescription('Cible').setRequired(true)).addIntegerOption(o => o.setName('niveau').setDescription('Niveau').setRequired(true)),
  new SlashCommandBuilder().setName('panel-vocal').setDescription('Centre de sécurité de ton salon vocal (Niveau 100+)')
].map(c => c.toJSON());

client.once('ready', async () => {
  await initDB();
  console.log(`🤖 Connecté : ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: botCommands });
    console.log("🔄 Commandes enregistrées !");
  } catch (e) { console.error("❌ Erreur commandes :", e); }
  client.user.setPresence({ activities: [{ name: '/panel-vocal | Sécurité 🛡️' }], status: 'online' });
});

// --- SYSTÈME D'EXPÉRIENCE (XP) ---
client.on('messageCreate', async msg => {
  if (msg.author.bot || !msg.guild || !db) return;
  const { id: uId, guild: { id: gId } } = msg.author;
  
  let u = await dbGet(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [uId, gId]);
  if (!u) {
    await dbQuery(`INSERT INTO users (userId, guildId, xp, level) VALUES (?, ?, 15, 0)`, [uId, gId]);
    return;
  }

  let { xp, level } = u;
  xp += 15;
  let needed = 100 + (level * 30);

  if (xp >= needed) {
    xp -= needed;
    level += 1;
    let cfg = await dbGet(`SELECT channelId FROM config WHERE guildId = ?`, [gId]);
    let targetChan = cfg ? msg.guild.channels.cache.get(cfg.channelId) : msg.channel;

    const embed = new EmbedBuilder()
      .setColor('#9b59b6')
      .setTitle('✨ NOUVEAU PALIER ATTEINT !')
      .setDescription(`Félicitations <@${uId}>, tu viens d'évoluer au **niveau ${level}** ! 🌟`)
      .setFooter({ text: `Système ${APP_TAG}` })
      .setTimestamp();
    if (targetChan) targetChan.send({ embeds: [embed] }).catch(() => {});
  }
  await dbQuery(`UPDATE users SET xp = ?, level = ? WHERE userId = ? AND guildId = ?`, [xp, level, uId, gId]);
});

// --- SÉCURITÉ VOCALE ---
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!newState.channelId || newState.member.user.bot || !db) return;
  const cId = newState.channelId, member = newState.member;

  const blocked = await dbGet(`SELECT * FROM v_access WHERE channelId = ? AND userId = ? AND type = 'black'`, [cId, member.id]);
  if (blocked) return member.voice.disconnect("Accès interdit (Blacklist)").catch(() => {});

  const lock = await dbGet(`SELECT * FROM v_locks WHERE channelId = ?`, [cId]);
  if (!lock || member.id === lock.ownerId) return;

  const allowed = await dbGet(`SELECT * FROM v_access WHERE channelId = ? AND userId = ? AND type = 'white'`, [cId, member.id]);
  if (!allowed) {
    await member.voice.disconnect("Salon vocal sécurisé").catch(() => {});
    if (lock.mode === 'timeout') await member.timeout(60000, "Tentative d'intrusion vocale").catch(() => {});
  }
});

// --- GESTION DES INTERACTIONS ---
client.on('interactionCreate', async interaction => {
  try {
    if (!db) return;
    const gId = interaction.guild?.id, uId = interaction.user.id;

    if (interaction.isChatInputCommand()) {
      const { commandName, options } = interaction;

      if (commandName === 'profil') {
        let u = await dbGet(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [uId, gId]) || { xp: 0, level: 0 };
        let needed = 100 + (u.level * 30);
        const embed = new EmbedBuilder()
          .setColor('#3498db')
          .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
          .setTitle('📊 Fiche d’Activité')
          .addFields({ name: 'Niveau', value: `**${u.level}**`, inline: true }, { name: 'Progression XP', value: `**${u.xp} / ${needed}**`, inline: true })
          .setFooter({ text: APP_TAG });
        return await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (commandName === 'classement') {
        let top = await dbAll(`SELECT * FROM users WHERE guildId = ? ORDER BY level DESC, xp DESC LIMIT 5`, [gId]);
        let desc = top.length ? top.map((x, i) => `**#${i + 1}** <@${x.userId}> — Niveau **${x.level}**`).join('\n') : 'Aucune donnée.';
        const embed = new EmbedBuilder().setColor('#f1c40f').setTitle('🏆 Classement du Serveur').setDescription(desc).setFooter({ text: APP_TAG });
        return await interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'salon-logs') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return await interaction.reply({ content: '❌ Réservé aux administrateurs.', ephemeral: true });
        let chan = options.getChannel('salon');
        await dbQuery(`INSERT OR REPLACE INTO config (guildId, channelId) VALUES (?, ?)`, [gId, chan.id]);
        return await interaction.reply({ content: `✅ Salon d'annonces configuré sur <#${chan.id}>.`, ephemeral: true });
      }

      if (commandName === 'modifier-xp' || commandName === 'modifier-niveau') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return await interaction.reply({ content: '❌ Réservé aux administrateurs.', ephemeral: true });
        let target = options.getUser('membre'), val = options.getInteger(commandName === 'modifier-xp' ? 'quantite' : 'niveau');
        let field = commandName === 'modifier-xp' ? 'xp' : 'level';
        let u = await dbGet(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [target.id, gId]) || { xp: 0, level: 0 };
        
        let newXp = field === 'xp' ? u.xp + val : u.xp;
        let newLvl = field === 'level' ? val : u.level;
        await dbQuery(`INSERT OR REPLACE INTO users (userId, guildId, xp, level) VALUES (?, ?, ?, ?)`, [target.id, gId, newXp, newLvl]);
        return await interaction.reply({ content: `✅ Mise à jour effectuée pour <@${target.id}>.`, ephemeral: true });
      }

      if (commandName === 'panel-vocal') {
        let u = await dbGet(`SELECT level FROM users WHERE userId = ? AND guildId = ?`, [uId, gId]);
        if (!u || u.level < 100) return await interaction.reply({ content: `⛔ Accès refusé : Niveau **100** requis (Ton niveau : ${u ? u.level : 0}).`, ephemeral: true });

        const embed = new EmbedBuilder()
          .setColor('#2ecc71')
          .setTitle('🛡️ Gestionnaire Vocal Sécurisé')
          .setDescription('Pilote la sécurité de ton salon vocal depuis le menu ci-dessous :');

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('v_menu').setPlaceholder('Sélectionne une option...').addOptions([
            { label: 'Verrouillage (Kick simple)', value: 'lock_kick', emoji: '🔒' },
            { label: 'Verrouillage (Kick + Timeout)', value: 'lock_timeout', emoji: '⚡' },
            { label: 'Autoriser un membre (Whitelist)', value: 'white_add', emoji: '✅' },
            { label: 'Bannir un membre (Blacklist)', value: 'black_add', emoji: '⛔' },
            { label: 'Rendre le salon public (VPU)', value: 'public', emoji: '🔓' }
          ])
        );
        return await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'v_menu') {
      let val = interaction.values[0], vChan = interaction.member.voice.channel;
      if (!vChan && val !== 'public') return await interaction.reply({ content: '❌ Tu dois être dans un salon vocal.', ephemeral: true });

      if (val === 'lock_kick' || val === 'lock_timeout') {
        let mode = val === 'lock_kick' ? 'kick' : 'timeout';
        await dbQuery(`INSERT OR REPLACE INTO v_locks (channelId, ownerId, mode) VALUES (?, ?, ?)`, [vChan.id, uId, mode]);
        return await interaction.update({ content: `🔒 Salon **${vChan.name}** verrouillé (${mode}).`, embeds: [], components: [] });
      }

      if (val === 'white_add' || val === 'black_add') {
        let lock = await dbGet(`SELECT * FROM v_locks WHERE channelId = ? AND ownerId = ?`, [vChan.id, uId]);
        if (!lock) return await interaction.reply({ content: '❌ Tu ne possèdes pas ce salon.', ephemeral: true });
        
        let members = vChan.members.filter(m => m.id !== uId);
        if (!members.size) return await interaction.reply({ content: '❌ Personne d’autre dans le salon.', ephemeral: true });

        const subMenu = new StringSelectMenuBuilder()
          .setCustomId(val === 'white_add' ? 'sub_white' : 'sub_black')
          .setPlaceholder('Choisis le membre...')
          .addOptions(members.map(m => ({ label: m.user.username.slice(0, 25), value: m.id })));
        return await interaction.update({ content: 'Sélectionne la cible :', components: [new ActionRowBuilder().addComponents(subMenu)] });
      }

      if (val === 'public') {
        await dbQuery(`DELETE FROM v_locks WHERE channelId = ? OR ownerId = ?`, [vChan?.id || '', uId]);
        await dbQuery(`DELETE FROM v_access WHERE channelId = ?`, [vChan?.id || '']);
        return await interaction.update({ content: `🔓 Salon remis en mode public.`, embeds: [], components: [] });
      }
    }

    if (interaction.isStringSelectMenu() && (interaction.customId === 'sub_white' || interaction.customId === 'sub_black')) {
      let targetId = interaction.values[0], vChan = interaction.member.voice.channel;
      if (!vChan) return await interaction.reply({ content: '❌ Action expirée.', ephemeral: true });
      let type = interaction.customId === 'sub_white' ? 'white' : 'black';

      await dbQuery(`INSERT OR REPLACE INTO v_access (channelId, userId, type) VALUES (?, ?, ?)`, [vChan.id, targetId, type]);
      if (type === 'black') vChan.members.get(targetId)?.voice.disconnect().catch(() => {});
      return await interaction.update({ content: `✅ Action enregistrée pour <@${targetId}>.`, components: [] });
    }
  } catch (err) { console.error("❌ Erreur interaction :", err); }
});

client.login(process.env.DISCORD_TOKEN);
