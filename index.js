const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

console.log("--- STARTING BOOT SEQUENCE ---");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent 
  ]
});

// Diagnostic logs to find the "Leak"
client.on('debug', m => console.log(`[DEBUG] ${m}`));
client.on('error', e => console.error(`[CONNECTION ERROR] ${e.message}`));

client.once('ready', () => {
  console.log(`🚀 SUCCESS! Bot is online as: ${client.user.tag}`);
});

// Attempt login immediately
console.log("--- ATTEMPTING DISCORD LOGIN ---");
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("❌ LOGIN FAILED:", err.message);
});

// Render's required web server
const app = express();
app.get('/', (req, res) => res.send('Bot Status: Connecting...'));
app.listen(process.env.PORT || 10000, () => {
  console.log("✅ Web Server Live on Port 10000");
});
