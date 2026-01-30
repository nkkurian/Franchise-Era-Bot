const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// 1. KEEP-ALIVE SERVER (For UptimeRobot)
const app = express();
app.get('/', (req, res) => res.send('Bot is online!'));
app.listen(process.env.PORT || 3000); 

// 2. CONFIGURATION
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent
  ]
});

// Setup Google Auth ONCE
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_EMAIL,
  key: process.env.GOOGLE_KEY.replace(/\\n/g, '\n'),
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file'
  ],
});
const doc = new GoogleSpreadsheet(process.env.SHEET_ID, serviceAccountAuth);

// 3. SALARY SEARCH COMMAND
client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.content.startsWith('!salary')) return;

  const searchInput = msg.content.replace('!salary ', '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (searchInput.length < 2) return; 

  try {
    await msg.channel.sendTyping();
    
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle['PlayerList'];
    const rows = await sheet.getRows();
    
    const matches = rows.filter(row => {
      return row._rawData.some(cell => 
        cell && cell.toString().toLowerCase().replace(/[^a-z0-9]/g, '').includes(searchInput)
      );
    });

    if (matches.length > 0) {
      let responseMessage = "";
      matches.slice(0, 3).forEach(m => {
        responseMessage += `💰 **${m._rawData[0]}** (${m._rawData[1]})\n**Years:** ${m._rawData[2]}\n**Salary:** ${m._rawData[3]}\n\n`;
      });
      return msg.reply(responseMessage);
    } else {
      return msg.reply(`❌ No results found for "${msg.content.replace('!salary ', '')}".`);
    }
  } catch (e) {
    console.error("Fetch Error:", e);
    return msg.reply("⚠️ Connection is a bit slow. Please try again in a few seconds!");
  }
});

client.once('ready', () => {
  console.log(`✅ Salary Bot is logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
