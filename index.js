const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// 1. Web Server for Render
const app = express();
app.get('/', (req, res) => res.send('Bot is active!'));
app.listen(process.env.PORT || 10000, () => console.log("✅ Render Port Linked"));

// 2. Client Setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent
  ]
});

// 3. Success Listener
client.once('ready', () => {
  console.log(`🚀 FACTORY RESET SUCCESSFUL: ${client.user.tag}`);
});

// 4. Test Command Listener
client.on('messageCreate', (msg) => {
  if (msg.content === '!ping') {
    msg.reply('Pong! I am officially connected.');
  }
});

// 5. Error Catching
client.on('error', (err) => console.error("❌ DISCORD ERROR:", err.message));

// 6. Login (Keep this at the very bottom)
console.log("--- ATTEMPTING FRESH LOGIN ---");
client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("❌ TOKEN REJECTED:", err.message);
});
