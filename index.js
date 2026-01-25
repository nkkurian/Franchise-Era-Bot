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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Authenticate once to avoid repeating it every message
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_EMAIL,
  key: process.env.GOOGLE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
});

async function getSheetData() {
  try {
    const serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_EMAIL,
      // This line below is the "magic" that fixes the \n issue if it persists
      key: process.env.GOOGLE_KEY.split(String.raw`\n`).join('\n'), 
      scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
    });
    const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle['PlayerList'];
    return await sheet.getRows();
  } catch (err) {
    console.error("Internal Auth Error:", err);
    throw err;
  }
}

// 3. COMMAND HANDLER
client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.content.startsWith('!salary')) return;

  const searchInput = msg.content.replace('!salary ', '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (searchInput.length < 2) return msg.reply("⚠️ Search term too short.");

  // Visual feedback that the bot is working through the 'cold start'
  await msg.channel.sendTyping();

  try {
    // Adding a small delay or retry logic implicitly by awaiting the full fetch
    const rows = await getSheetData();
    
    const matches = rows.filter(row => {
      return row._rawData.some(cell => 
        cell && cell.toString().toLowerCase().replace(/[^a-z0-9]/g, '').includes(searchInput)
      );
    });

    if (matches.length > 0) {
      let responseMessage = "";
      matches.slice(0, 5).forEach(m => {
        const name = m._rawData[0] || "Unknown";
        const pos = m._rawData[1] || "N/A";
        const years = m._rawData[2] || "0";
        const salary = m._rawData[3] || "0";
        responseMessage += `💰 **${name}** (${pos})\n**Years:** ${years}\n**Salary:** ${salary}\n\n`;
      });
      
      return msg.reply(responseMessage);
    } else {
      return msg.reply(`❌ No results found for "${msg.content.replace('!salary ', '')}".`);
    }
  } catch (e) {
    console.error("Detailed Error:", e);
    // Silent fail in Discord if it's just a slight delay, or a more helpful message
    return msg.reply("⚠️ The database is waking up. Please try that command one more time!");
  }
});

client.login(process.env.DISCORD_TOKEN);
