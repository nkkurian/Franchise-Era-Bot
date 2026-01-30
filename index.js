const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// 1. DISCORD LOGIN FIRST (Priority)
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent
  ]
});

// 2. GOOGLE AUTH SETUP
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_EMAIL,
  key: (process.env.GOOGLE_KEY || '').replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.SHEET_ID, serviceAccountAuth);

// 3. COMMAND HANDLER
client.on('messageCreate', async (msg) => {
  // Use this to check if the bot is alive in Render Logs
  console.log(`Bot received: ${msg.content}`);

  if (msg.author.bot || !msg.content.startsWith('!salary')) return;

  const searchInput = msg.content.replace('!salary ', '').trim().toLowerCase();

  try {
    await msg.channel.sendTyping();
    
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle['PlayerList'];
    const rows = await sheet.getRows();
    
    // Fuzzy search that checks all columns for "Puka"
    const matches = rows.filter(row => 
      row._rawData.some(cell => cell && cell.toString().toLowerCase().includes(searchInput))
    );

    if (matches.length > 0) {
      let response = "";
      matches.slice(0, 3).forEach(m => {
        response += `💰 **${m._rawData[0]}** (${m._rawData[1]})\n**Years:** ${m._rawData[2]}\n**Salary:** ${m._rawData[3]}\n\n`;
      });
      return msg.reply(response);
    } else {
      return msg.reply(`❌ No results found for "${searchInput}".`);
    }
  } catch (e) {
    console.error("SHEET ERROR:", e.message);
    return msg.reply("⚠️ Error connecting to the sheet. Check the logs!");
  }
});

client.once('ready', () => {
  console.log(`✅ DISCORD READY: ${client.user.tag}`);
});

// Start everything
client.login(process.env.DISCORD_TOKEN);

// Keep-alive server
const app = express();
app.get('/', (req, res) => res.send('Bot is online'));
app.listen(process.env.PORT || 10000);
