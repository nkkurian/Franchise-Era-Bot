const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// 1. KEEP-ALIVE SERVER
const app = express();
app.get('/', (req, res) => res.send('Bot is online!'));
app.listen(process.env.PORT || 3000); 

// 2. CONFIGURATION
const SHEET_ID = process.env.SHEET_ID;
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent
  ]
});

async function getSheet() {
  const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_EMAIL,
    key: process.env.GOOGLE_KEY.replace(/\\n/g, '\n'),
    scopes: [
        'https://www.googleapis.com/auth/spreadsheets', 
        'https://www.googleapis.com/auth/drive.file'
    ],
  });
  const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  return doc.sheetsByTitle['PlayerList'];
}

// 3. COMMAND HANDLER
client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.content.startsWith('!salary')) return;

  const searchInput = msg.content.replace('!salary ', '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (searchInput.length < 2) return msg.reply("⚠️ Search term too short.");

  try {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    const matches = rows.filter(row => {
      return row._rawData.some(cell => cell && cell.toString().toLowerCase().replace(/[^a-z0-9]/g, '').includes(searchInput));
    });

    if (matches.length > 0) {
      matches.slice(0, 5).forEach(m => {
        // Updated indices based on your sheet: 0=Name, 1=Pos, 2=Years, 3=Salary
        const name = m._rawData[0] || "Unknown";
        const pos = m._rawData[1] || "N/A";
        const years = m._rawData[2] || "0";
        const salary = m._rawData[3] || "0";
        msg.reply(`💰 **${name}** (${pos})\n**Years:** ${years}\n**Salary:** ${salary}`);
      });
    } else {
      msg.reply(`❌ No results found for "${msg.content.replace('!salary ', '')}".`);
    }
  } catch (e) {
    console.error(e);
    msg.reply("⚠️ Error connecting to sheet.");
  }
});

client.login(process.env.DISCORD_TOKEN);
