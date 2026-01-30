const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// 1. START WEB SERVER IMMEDIATELY
const app = express();
app.get('/', (req, res) => res.send('Bot is active!'));
app.listen(process.env.PORT || 10000, () => {
  console.log(`✅ Web Server live on port 10000`);
});

// 2. INITIALIZE DISCORD
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

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("❌ LOGIN ERROR:", err.message); // This will show in Render if the token is wrong
});
