const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// Serveur web minimaliste pour Render
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot actif 🚀'));
app.listen(PORT, () => console.log(`🌍 Serveur HTTP sur le port ${PORT}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log(`🤖 Bot connecté en tant que ${client.user.tag} !`);
});

client.on('messageCreate', message => {
  if (message.author.bot) return;

  if (message.content === '!ping') {
    message.reply('pong');
  }
});

client.login(process.env.DISCORD_TOKEN);
