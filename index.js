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
let playerMap = {}; // Will store ID -> Name
let userMap = {};   // Will store ID -> Username

// 1. Fetch Master Data (Players and Users)
async function startupData() {
    try {
        // Get Usernames
        const users = await axios.get(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`);
        users.data.forEach(u => { userMap[u.user_id] = u.display_name; });

        // Get Player Names (This is a large file)
        const players = await axios.get('https://api.sleeper.app/v1/players/nfl');
        playerMap = players.data;
        console.log("Sleeper Player Data Loaded");
    } catch (e) { console.error("Startup Error:", e); }
}

// 2. Sleeper Trade Tracker with Details
async function checkTrades() {
  try {
    const response = await axios.get(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/transactions/1`);
    const trades = response.data.filter(t => t.type === 'trade' && t.status === 'complete');
    
    if (trades.length > 0) {
      const newestTrade = trades[0];
      
      if (lastTradeId && newestTrade.transaction_id !== lastTradeId) {
        const channel = client.channels.cache.find(c => c.name === 'bot-log');
        if (channel) {
          const embed = new EmbedBuilder()
            .setTitle('🤝 TRADE COMPLETED')
            .setColor(0x00ff00)
            .setTimestamp();

          let tradeSummary = "";
          
          // Loop through each roster involved in the trade
          for (const [rosterId, adds] of Object.entries(newestTrade.adds || {})) {
            const userId = newestTrade.roster_ids.find(id => id === parseInt(rosterId));
            const ownerName = userMap[newestTrade.consented_team_ids[newestTrade.roster_ids.indexOf(parseInt(rosterId))]] || `Team ${rosterId}`;
            
            tradeSummary += `**${ownerName} received:**\n`;
            
            // List Players
            for (const [playerId, _] of Object.entries(adds)) {
                const p = playerMap[playerId];
                tradeSummary += `• ${p ? `${p.first_name} ${p.last_name} (${p.position})` : 'Unknown Player'}\n`;
            }
            
            // List Draft Picks (if any)
            const picks = newestTrade.draft_picks.filter(p => p.owner_id === parseInt(rosterId));
            picks.forEach(p => {
                tradeSummary += `• ${p.season} Round ${p.round} (via ${userMap[p.previous_owner_id] || 'Original Owner'})\n`;
            });
            tradeSummary += `\n`;
          }

          embed.setDescription(tradeSummary);
          channel.send({ embeds: [embed] });
        }
      }
      lastTradeId = newestTrade.transaction_id;
    }
  } catch (e) { console.error("Sleeper API Error:", e); }
}

setInterval(checkTrades, 60000);

// --- SALARY SEARCH ---
client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.content.startsWith('!salary')) return;
  const searchInput = msg.content.replace('!salary ', '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (searchInput.length < 2) return; 

  try {
    await msg.channel.sendTyping();
    const serviceAccountAuth = new JWT({
        email: process.env.GOOGLE_EMAIL,
        key: process.env.GOOGLE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
    });
    const doc = new GoogleSpreadsheet(process.env.SHEET_ID, serviceAccountAuth);
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

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await startupData();
  checkTrades(); 
});

client.login(process.env.DISCORD_TOKEN);
