const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Franchise Bot: Active'));
app.listen(process.env.PORT || 10000);

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_EMAIL,
  key: process.env.GOOGLE_KEY.replace(/\\n/g, '\n'), 
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SHEET_ID, serviceAccountAuth);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.split(' ');
  const command = args[0].toLowerCase();

  // --- EXISTING SALARY COMMAND ---
  if (command === '!salary') {
    const playerNameInput = args.slice(1).join(' ').trim().toLowerCase();
    if (!playerNameInput) return message.reply("Please provide a name!");

    try {
      await doc.loadInfo();
      const playerSheet = doc.sheetsByTitle['PlayerList']; 
      const rows = await playerSheet.getRows();
      const playerRow = rows.find(r => r.get('Player Name')?.toLowerCase().includes(playerNameInput));

      if (playerRow) {
        const name = playerRow.get('Player Name');
        const capHit = playerRow.get('Cap Hit') || "$0.00";
        const years = playerRow._rawData[2] || "0";
        message.reply(`📊 **Player Report: ${name}**\n🧢 **Cap Hit:** ${capHit}\n⏳ **Years:** ${years}`);
      }
    } catch (err) { console.error(err); }
  }

  // --- NEW TRADE COMMAND ---
  if (command === '!trade') {
    const tradeContent = message.content.slice(7); // Remove "!trade "
    const sides = tradeContent.split('for');
    
    if (sides.length !== 2) return message.reply("Format: `!trade Player A, Player B for Player C`");

    try {
      await doc.loadInfo();
      const playerSheet = doc.sheetsByTitle['PlayerList'];
      const rows = await playerSheet.getRows();

      const parseCapHits = (playerListString) => {
        const names = playerListString.split(',').map(n => n.trim().toLowerCase());
        let total = 0;
        let foundNames = [];

        names.forEach(name => {
          const row = rows.find(r => r.get('Player Name')?.toLowerCase().includes(name));
          if (row) {
            const rawHit = row.get('Cap Hit') || "$0";
            const numericHit = parseFloat(rawHit.replace(/[$,]/g, '')) || 0; // Convert "$9,000,000" to 9000000
            total += numericHit;
            foundNames.push(row.get('Player Name'));
          }
        });
        return { total, foundNames };
      };

      const side1 = parseCapHits(sides[0]);
      const side2 = parseCapHits(sides[1]);

      const netChange = side2.total - side1.total; // Net impact on Team 1

      let response = `🤝 **Trade Analysis**\n\n`;
      response += `**Side A Sends:** ${side1.foundNames.join(', ')} (Total: $${side1.total.toLocaleString()})\n`;
      response += `**Side B Sends:** ${side2.foundNames.join(', ')} (Total: $${side2.total.toLocaleString()})\n\n`;
      response += `⚖️ **Cap Impact for Side A:** ${netChange > 0 ? `📉 -$${netChange.toLocaleString()} space` : `📈 +$${Math.abs(netChange).toLocaleString()} space`}\n`;
      response += `⚖️ **Cap Impact for Side B:** ${netChange < 0 ? `📉 -$${Math.abs(netChange).toLocaleString()} space` : `📈 +$${netChange.toLocaleString()} space`}`;

      message.reply(response);
    } catch (err) { console.error(err); }
  }
});

client.once('ready', () => console.log(`🚀 BOT READY`));
client.login(process.env.DISCORD_TOKEN);
