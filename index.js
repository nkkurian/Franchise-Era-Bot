const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// 1. START WEB SERVER IMMEDIATELY (Fixes Render Port Timeout)
const app = express();
app.get('/', (req, res) => res.send('Bot is active!'));
const server = app.listen(process.env.PORT || 10000, () => {
  console.log(`✅ Web Server live on port ${server.address().port}`);
});

// 2. INITIALIZE DISCORD BOT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent 
  ]
});

client.once('ready', () => {
  console.log(`🚀 DISCORD IS ONLINE: ${client.user.tag}`); //
});

client.on('messageCreate', (msg) => {
  console.log(`Saw message: ${msg.content}`); //
  if (msg.content === '!ping') {
    msg.reply('Pong! The connection is fixed.');
  }
});

// 3. LOGIN
console.log("--- Connecting to Discord ---");
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("❌ LOGIN ERROR:", err.message); //
});
