const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// 1. RENDER HEARTBEAT
const app = express();
app.get('/', (req, res) => res.send('System Test: Running'));
app.listen(process.env.PORT || 10000, () => console.log("✅ Render Port Linked"));

// 2. DISCORD TEST CLIENT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 3. THE TEST COMMAND
client.on('messageCreate', (message) => {
  if (message.author.bot) return; // Ignore other bots

  if (message.content.toLowerCase() === '!test') {
    message.reply('🚀 Fresh start success! The new bot is listening.');
  }
});

// 4. SUCCESS LOGS
client.once('ready', () => {
  console.log(`🚀 TEST SUCCESSFUL: Logged in as ${client.user.tag}`);
});

// 5. LOGIN
console.log("--- STARTING LOGIN SEQUENCE ---");
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("❌ LOGIN FAILED:", err.message);
});
