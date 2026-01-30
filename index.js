const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent //
  ]
});

client.on('messageCreate', (msg) => {
  // Check Render logs for this line!
  console.log(`Log: I saw a message: "${msg.content}"`);

  if (msg.content.startsWith('!salary')) {
    msg.reply('I heard you! Now checking the sheet...');
  }
});

client.once('ready', () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);

// Render needs this to stay "Live"
const app = express();
app.get('/', (req, res) => res.send('Bot Active'));
app.listen(process.env.PORT || 10000);
