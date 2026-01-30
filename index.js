const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// Initialize the client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent 
  ]
});

// Move the login to the TOP
console.log("--- ATTEMPTING DISCORD LOGIN ---");
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("❌ LOGIN FAILED:", err.message); //
});

client.once('ready', () => {
  console.log(`✅ SUCCESS: Logged in as ${client.user.tag}`); //
  
  // Only start the web server AFTER the bot is ready
  const app = express();
  app.get('/', (req, res) => res.send('Bot is Online'));
  app.listen(process.env.PORT || 10000, () => {
    console.log("✅ Web Server is now listening.");
  });
});

client.on('messageCreate', (msg) => {
  console.log(`DEBUG: Saw message - ${msg.content}`); //
  if (msg.content === '!ping') {
    msg.reply('Pong! I can hear you now.');
  }
});
