const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// 1. RENDER HEARTBEAT (Keep this to prevent "Port" errors)
const app = express();
app.get('/', (req, res) => res.send('Test Mode: Online'));
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
  if (message.author.bot) return;

  if (message.content.toLowerCase() === '!test') {
    message.reply('✅ System Check: I am online and reading your messages!');
  }
});

// 4. SUCCESS LOG
client.once('ready', () => {
  console.log(`🚀 TEST SUCCESSFUL: Logged in as ${client.user.tag}`);
});

// 5. LOGIN HANDSHAKE
console.log("--- INITIATING TEST LOGIN ---");
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("❌ TEST LOGIN FAILED:", err.message);
});
