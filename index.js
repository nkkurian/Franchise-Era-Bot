const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// Start web server first so Render is happy
const app = express();
app.get('/', (req, res) => res.send('Bot is active!'));
app.listen(process.env.PORT || 10000, () => {
  console.log("✅ Web Port Open and Listening");
});

// Initialize Discord with ALL intents you have enabled in the portal
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,   // Matches your 'Server Members' toggle
    GatewayIntentBits.GuildPresences  // Matches your 'Presence Intent' toggle
  ]
});

client.once('ready', () => {
  console.log(`🚀 SUCCESS: Online as ${client.user.tag}`); //
});

// Catch errors to see if Discord sends a rejection code
client.on('error', (err) => console.error("❌ DISCORD ERROR:", err.message));

console.log("--- ATTEMPTING FINAL LOGIN ---");
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("❌ LOGIN FAILED:", err.message); //
});
