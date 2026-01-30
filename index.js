const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// 1. Render Requirement: Open the port immediately
const app = express();
app.get('/', (req, res) => res.send('Bot is waking up...'));
app.listen(process.env.PORT || 10000, () => console.log("✅ Render Port 10000 Open"));

// 2. Barebones Client: Only ask for what is absolutely necessary
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent
  ]
});

// 3. Status Check
client.once('ready', () => {
  console.log(`🚀 SUCCESS! Bot is online as: ${client.user.tag}`);
});

// 4. Detailed Login Error Catching
console.log("--- STARTING LOGIN ---");
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("❌ DISCORD REJECTED LOGIN:", err.message);
});
