const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// 1. Log in immediately
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent 
  ]
});

client.once('ready', () => {
  console.log(`✅ DISCORD IS LIVE: ${client.user.tag}`); // Check Render logs for this!
});

client.on('messageCreate', (msg) => {
  if (msg.content === '!ping') {
    msg.reply('Pong! I am back.');
  }
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("❌ TOKEN ERROR:", err.message); // This will tell us if the token is dead
});

// 2. Simple web server for Render
const app = express();
app.get('/', (req, res) => res.send('Bot Status: Testing Connection'));
app.listen(process.env.PORT || 10000);
