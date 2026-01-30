const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// 1. Give Render what it wants immediately
const app = express();
app.get('/', (req, res) => res.send('System Resetting...'));
app.listen(process.env.PORT || 10000, () => console.log("✅ Render Port Linked"));

// 2. Minimum viable bot
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent
  ]
});

// 3. The "Loud" Login
client.once('ready', () => {
  console.log(`🚀 FACTORY RESET SUCCESSFUL: ${client.user.tag}`);
});

client.on('error', (err) => console.error("❌ CONNECTION ERROR:", err.message));

console.log("--- ATTEMPTING FRESH LOGIN ---");
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("❌ TOKEN REJECTED:", err.message);
});
