const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// 1. WEB SERVER & MONITORING
const app = express();
app.get('/', (req, res) => {
  console.log("💓 Heartbeat received");
  res.send('Franchise Bot: PlayerList Mode Active');
});
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

// 4. THE UPDATED SALARY COMMAND
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.split(' ');
  const command = args[0].toLowerCase();

  if (command === '!salary') {
    const playerNameInput = args.slice(1).join(' ').trim();

    if (!playerNameInput) {
      return message.reply("Who are we looking for? Try `!salary Reed Blankenship`");
    }

    try {
      await doc.loadInfo();
      
      // FIX: Find the specific tab named "PlayerList" instead of just the first one
      const sheet = doc.sheetsByTitle['PlayerList']; 
      
      if (!sheet) {
        return message.reply("⚠️ Error: I couldn't find a tab named 'PlayerList' in your sheet.");
      }

      const rows = await sheet.getRows();

      // Match headers exactly from image_475ba9.png
      const playerRow = rows.find(r => 
        r.get('Player Name') && r.get('Player Name').toLowerCase().trim() === playerNameInput.toLowerCase()
      );

      if (playerRow) {
        const salary = playerRow.get('Yearly Salary') || "N/A";
        const capHit = playerRow.get('Cap Hit') || "N/A";
        const extended = playerRow.get('Extended') === 'TRUE';

        let response = `📊 **Player Report: ${playerRow.get('Player Name')}**\n`;
        response += `💰 **Yearly Salary:** ${salary}\n`;
        response += `🧢 **Cap Hit:** ${capHit}\n`;
        response += `📝 **Extended:** ${extended ? "✅ Yes" : "❌ No"}`;

        message.reply(response);
      } else {
        message.reply(`❌ I couldn't find **${playerNameInput}** in the PlayerList.`);
      }
    } catch (err) {
      console.error("SEARCH ERROR:", err.message);
      message.reply(`⚠️ Database Error: ${err.message}`);
    }
  }
});

// 5. LOGIN
client.once('ready', () => console.log(`🚀 FRANCHISE BOT READY: ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);
