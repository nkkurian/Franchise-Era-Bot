const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent 
  ]
});

// This will catch the EXACT reason Discord is saying "No"
client.on('shardError', error => {
  console.error('❌ A websocket connection error occurred:', error);
});

process.on('unhandledRejection', error => {
  console.error('❌ Unhandled promise rejection:', error);
});

client.once('ready', () => {
  console.log(`🚀 SUCCESS: Online as ${client.user.tag}`);
});

console.log("--- STARTING LOGIN ---");
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("❌ LOGIN FAILED:", err.message);
});

// Render Web Server
const app = express();
app.listen(process.env.PORT || 10000, () => console.log("✅ Web Port Open"));
