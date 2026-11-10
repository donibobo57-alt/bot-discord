const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const http = require('http');
const fs = require('fs');

// --- MINI SERVEUR WEB (pour garder le bot en ligne / Health Check) ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Discord en ligne !');
});
serveur.listen(process.env.PORT || 3000, () => {
    console.log('Mini serveur web actif sur le port 3000');
});

// --- DISCORD CLIENT ---
const client = new Client({
    intentions : [
        GatewayIntentBits.Guildes,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// Base de données simulée en JSON (ou mémoire)
const dbFile = './bank_db.json';
soit bankData = {};
si (fs.existsSync(dbFile)) {
    essayer {
        bankData = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    } attraper (e) {
        bankData = {};
    }
} autre {
    fs.writeFileSync(dbFile, JSON.stringify({}));
}

fonction saveDb() {
    fs.writeFileSync(dbFile, JSON.stringify(bankData, null, 2));
}

fonction getUserData(userId) {
    si (!bankData[userId]) {
        bankData[userId] = { solde : 100, lastDaily : 0 } ;
    }
    renvoyer bankData[userId];
}

// Liste des 20 commandes slash
const commandes = [
    new SlashCommandBuilder().setName('daily').setDescription('Récupère ta récompense quotidienne de pièces !'),
    new SlashCommandBuilder().setName('banque').setDescription('Vérifie ton solde bancaire avec une belle carte stylée.'),
    newSlashCommandBuilder().setName('profile').setDescription('Affiche ton profil complet et ton rang.'),
    newSlashCommandBuilder().setName('leaderboard').setDescription('Affiche le classement des plus richesses du serveur.'),
    new SlashCommandBuilder().setName('coinflip').setDescription('Parie tes pièces sur Pile ou Face.').addIntegerOption(o => o.name('mise').setDescription('Montant à miser').setRequired(true)).addStringOption(o => o.name('choix').setDescription('pile ou face').setRequired(true).addChoices({nom : 'Pile', valeur : 'pile'}, {nom : 'Face', valeur : 'face'})),
    new SlashCommandBuilder().setName('dice').setDescription('Lance un dé (1 à 6). Si tu fais 6, tu gagnes gros !').addIntegerOption(o => o.name('mise').setDescription('Montant à miser').setRequired(true)),
    new SlashCommandBuilder().setName('slots').setDescription('Joue à la machine à sous !').addIntegerOption(o => o.name('mise').setDescription('Montant à miser').setRequired(true)),
    new SlashCommandBuilder().setName('work').setDescription('Travail pour gagner un peu d'argent.'),
    new SlashCommandBuilder().setName('crime').setDescription('Tente un coup risqué (Attention à la prison !).'),
    new SlashCommandBuilder().setName('rob').setDescription('Tente de voler un utilisateur.').addUserOption(o => o.name('cible').setDescription('Utilisateur à voler').setRequired(true)),
    new SlashCommandBuilder().setName('deposit').setDescription('Dépose de l'argent en banque.').addIntegerOption(o => o.name('montant').setDescription('Montant à déposer').setRequired(true)),
    new SlashCommandBuilder().setName('withdraw').setDescription('Retire de l'argent de la banque.').addIntegerOption(o => o.name('montant').setDescription('Montant à retirer').setRequired(true)),
    new SlashCommandBuilder().setName('pay').setDescription('Envoie de l'argent à un autre utilisateur.').addUserOption(o => o.name('destinataire').setDescription('À qui envoyer').setRequired(true)).addIntegerOption(o => o.name('montant').setDescription('Montant').setRequired(true)),
    new SlashCommandBuilder().setName('shop').setDescription('Affiche la boutique des rôles et objets exclusifs.'),
    new SlashCommandBuilder().setName('buy').setDescription('Acheter un article dans la boutique.').addStringOption(o => o.name('article').setDescription('Nom de l'article').setRequired(true)),
    new SlashCommandBuilder().setName('inventory').setDescription('Affiche ton inventaire personnel.'),
    new SlashCommandBuilder().setName('lottery').setDescription('Acheter un ticket de loterie.'),
    new SlashCommandBuilder().setName('rep').setDescription('Donne un point de réputation à un utilisateur.').addUserOption(o => o.name('utilisateur').setDescription('Membre').setRequired(true)),
    new SlashCommandBuilder().setName('stats').setDescription('Afficher les statistiques globales du bot.'),
    new SlashCommandBuilder().setName('ping').setDescription('Vérifie la latence du bot et du serveur.')
].map(cmd => cmd.toJSON());

client.once('prêt', async () => {
    console.log(`Connecté à tant que ${client.user.tag} !`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN || 'TON_TOKEN_ICI');
    essayer {
        console.log('Enregistrement des commandes slash...');
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Commandes slash enregistrées avec succès !');
    } attraper (erreur) {
        console.error(erreur);
    }
});

client.on('interactionCreate', interaction asynchrone => {
    si (!interaction.isChatInputCommand()) retourner;

    const { nomCommande, utilisateur, membre } = interaction;
    const userData = getUserData(user.id);

    // Sécurité : Vérification rôle administrateur (si le rôle est en dessous du bot, bloqué)
    const adminCommands = ['statistiques', 'boutique']; // Exemple de commandes admin restreintes
    si (adminCommands.includes(commandName) && membre && client.user) {
        const botHighestRole = interaction.guild.members.me.roles.highest;
        const memberHighestRole = member.roles.highest;
        si (memberHighestRole.position < botHighestRole.position && !member.permissions.has('Administrator')) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('⛔ Accès Refusé')
                .setDescription('Tu n'as pas le niveau requis ou ton rôle est en dessous de celui du bot pour exécuter cette commande administrative.')
                .setTimestamp();
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }

    essayer {
        si (commandName === 'ping') {
            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle('🏓 Pong !')
                .setDescription(`Latence du bot : **${client.ws.ping}ms**`)
                .setTimestamp();
            attendre interaction.reply({ embeds: [embed] });
        }
        sinon si (commandName === 'daily') {
            const maintenant = Date.maintenant();
            const cooldown = 24 * 60 * 60 * 1000;
            si (maintenant - userData.lastDaily < cooldown) {
                const restant = cooldown - (maintenant - userData.lastDaily);
                const heures = Math.floor(restant / (1000 * 60 * 60));
                const embed = new EmbedBuilder()
                    .setColor(0xFF5733)
                    .setTitle('⏳ Patientez !')
                    .setDescription(`Vous avez déjà récupéré votre quotidien. Revenez dans **${hours} heures**.`);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            userData.balance += 500;
            userData.lastDaily = maintenant;
            enregistrerDb();
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('💰 Récompense quotidienne')
                .setDescription(`Félicitations ${user}, vous avez reçu **500 pièces** !`)
                .setTimestamp();
            attendre interaction.reply({ embeds: [embed] });
        }
        sinon si (commandName === 'banque') {
            // Style demandé : Embleme élégant avec affichage du solde
            const embed = new EmbedBuilder()
                .setColor(0x3B82F6) // Bleu moderne
                .setTitle('🏦 COMPTE BANCAIRE OFFICIEL')
                .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
                .ajouterChamps(
                    { name: '👤 Titulaire', value: `> ${user.username}`, inline: true },
                    { nom : '💳 Solde Actuel', valeur : `> **${userData.balance} pièces**`, inline : true },
                    { name: '🛡️ Sécurité', value: '> 🟢 Coffre-fort protégé (Dégradé Rouge & Bleu)', inline: false }
                )
                .setImage('https://via.placeholder.com/600x200/1E3A8A/EF4444?text=BANQUE+DEGRADEE+ROUGE+ET+BLEU')
                .setFooter({ text: 'Système sécurisé par Bot Discord v3.0' })
                .setTimestamp();
            attendre interaction.reply({ embeds: [embed] });
        }
        autre {
            // Réponse générique stylée pour les autres commandes casino / économie
            const embed = new EmbedBuilder()
                .setColor(0x8B5CF6)
                .setTitle(`🎰 Commande : /${commandName}`)
                .setDescription(`Action exécutée avec succès pour **${user.username}** !
*Le casino et les mini-jeux fonctionnent à merveille.*`)
                .addFields({ nom : '💎 Solde actuel', valeur : `${userData.balance} pièces`, inline : true })
                .setTimestamp();
            attendre interaction.reply({ embeds: [embed] });
        }
    } attraper (erreur) {
        console.error(err);
        const errorEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('⚠️ Oups ! Une erreur est survenue')
            .setDescription('Le script a géré proprement l'exception pour éviter tout crash de l'application.')
            .setTimestamp();
        si (interaction.différée || interaction.répondue) {
            await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
        } autre {
            attendre interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN || 'TON_TOKEN_ICI');
