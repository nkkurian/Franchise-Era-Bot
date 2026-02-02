const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// 1. WEB SERVER & MONITORING
const app = express();
app.get('/', (req, res) => res.send('Franchise Bot: Active'));
app.listen(process.env.PORT || 10000);

// 2. GOOGLE SHEETS AUTH
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_EMAIL,
  key: process.env.GOOGLE_KEY.replace(/\\n/g, '\n'), 
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SHEET_ID, serviceAccountAuth);

// 3. DISCORD CLIENT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 4. THE SALARY COMMAND
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.split(' ');
  if (args[0].toLowerCase() === '!salary') {
    const playerNameInput = args.slice(1).join(' ').trim();

    if (!playerNameInput) return message.reply("Please provide a name!");

    try {
      await doc.loadInfo();
      const sheet = doc.sheetsByTitle['PlayerList']; // Targeted tab
      const rows = await sheet.getRows();

      const playerRow = rows.find(r => 
        r.get('Player Name') && r.get('Player Name').toLowerCase().trim() === playerNameInput.toLowerCase()
      );

      if (playerRow) {
        const salary = playerRow.get('Yearly Salary') || "N/A";
        const capHit = playerRow.get('Cap Hit') || "N/A";
        const extended = playerRow.get('Extended') === 'TRUE';

        message.reply(`📊 **Player Report: ${playerRow.get('Player Name')}**\n **Yearly Salary:** ${salary}\n **Cap Hit:** ${capHit}\n **Extended:** ${extended ? "✅ Yes" : "❌ No"}`);
      } else {
        message.reply(`❌ I couldn't find **${playerNameInput}** in the PlayerList.`);
      }
    } catch (err) {
      console.error("SEARCH ERROR:", err.message);
    }
  }
});

client.once('ready', () => console.log(`🚀 BOT ONLINE: ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);
