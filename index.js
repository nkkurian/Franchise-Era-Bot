const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');
const axios = require('axios'); 

const app = express();
app.get('/', (req, res) => res.send('Bot is online!'));
app.listen(process.env.PORT || 3000); 

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- CONFIG ---
const LEAGUE_ID = process.env.LEAGUE_ID;
let lastTradeId = null;

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_EMAIL,
  key: process.env.GOOGLE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
});
const doc = new GoogleSpreadsheet(process.env.SHEET_ID, serviceAccountAuth);

// --- SLEEPER TRADE TRACKER ---
async function checkTrades() {
  try {
    // Fetch the 5 most recent transactions to ensure we don't miss any during a restart
    const response = await axios.get(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/transactions/1`);
    const trades = response.data.filter(t => t.type === 'trade' && t.status === 'complete');
    
    if (trades.length > 0) {
      const newestTrade = trades[0];
      
      // If lastTradeId is null, it means the bot just started; we save the ID and wait for the NEXT one
      if (lastTradeId && newestTrade.transaction_id !== lastTradeId) {
        // Updated to look for 'bot-log' specifically
        const channel = client.channels.cache.find(c => c.name === 'bot-log');
        
        if (channel) {
          const embed = new EmbedBuilder()
            .setTitle('🤝 NEW SLEEPER TRADE COMPLETED')
            .setColor(0x00ff00)
            .setDescription('A new trade was just processed! Check the Sleeper app for full roster details.')
            .setTimestamp()
            .setFooter({ text: `Trade ID: ${newestTrade.transaction_id}` });
          
          channel.send({ embeds: [embed] });
        }
      }
      lastTradeId = newestTrade.transaction_id;
    }
  } catch (e) {
    console.error("Sleeper API Error:", e);
  }
}

// Check for trades every 60 seconds (1 minute)
setInterval(checkTrades, 60000);

client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.content.startsWith('!salary')) return;
  const searchInput = msg.content.replace('!salary ', '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (searchInput.length < 2) return; 

  try {
    await msg.channel.sendTyping();
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle['PlayerList'];
    const rows = await sheet.getRows();
    const matches = rows.filter(row => row._rawData.some(cell => cell && cell.toString().toLowerCase().replace(/[^a-z0-9]/g, '').includes(searchInput)));

    if (matches.length > 0) {
      let resp = "";
      matches.slice(0, 3).forEach(m => {
        resp += `💰 **${m._rawData[0]}** (${m._rawData[1]})\n**Years:** ${m._rawData[2]}\n**Salary:** ${m._rawData[3]}\n\n`;
      });
      return msg.reply(resp);
    }
  } catch (e) { console.error(e); }
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  checkTrades(); 
});

client.login(process.env.DISCORD_TOKEN);
