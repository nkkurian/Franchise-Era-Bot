const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// 1. WEB SERVER: Keeps Render alive
const app = express();
app.get('/', (req, res) => res.send('Bot is Heartbeating...'));
app.listen(process.env.PORT || 10000, () => console.log("✅ Render Port Binding Successful"));

// 2. INTENTS: Telling Discord what the bot is allowed to do
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers // For new member features
  ]
});

// 3. READY EVENT: Confirms the bot is actually online
client.once('ready', () => {
  console.log(`🚀 SYSTEM INITIALIZED: Logged in as ${client.user.tag}`);
});

// 4. COMMAND HANDLER: Where the magic happens
client.on('messageCreate', async (message) => {
  // Ignore bots so we don't get infinite loops
  if (message.author.bot) return;

  // Simple Ping Test
  if (message.content.toLowerCase() === '!test') {
    message.reply('The new system is online and listening! 📡');
  }

  // --- ADD NEW FEATURES BELOW THIS LINE ---
});

// 5. LOGIN: The handshake with Discord
console.log("--- INITIATING LOGIN SEQUENCE ---");
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("❌ CRITICAL LOGIN ERROR:", err.message); // This will tell us if the token is wrong
});
