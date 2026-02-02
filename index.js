const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// 1. WEB SERVER & MONITORING
const app = express();
app.get('/', (req, res) => {
  console.log("💓 Heartbeat received from Monitor");
  res.send('Franchise Bot: Advanced Salary Mode Active');
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

// 4. ADVANCED SALARY COMMAND
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.split(' ');
  const command = args[0].toLowerCase();

  if (command === '!salary') {
    const playerNameInput = args.slice(1).join(' ');

    if (!playerNameInput) {
      return message.reply("Who are we looking for? Try `!salary Cobie Durant`");
    }

    try {
      await doc.loadInfo();
      const sheet = doc.sheetsByIndex[0]; 
      const rows = await sheet.getRows();

      // Finding the player based on the "Player Name" column from your screenshot
      const playerRow = rows.find(r => 
        r.get('Player Name') && r.get('Player Name').toLowerCase() === playerNameInput.toLowerCase()
      );

      if (playerRow) {
        // Pulling the specific columns you requested
        const salary = playerRow.get('Yearly Sala') || "N/A";
        const capHit = playerRow.get('Cap Hit') || "N/A";
        const isExtended = playerRow.get('Extended') === "TRUE"; // Checkbox logic

        // Build a nice looking response
        let response = `📊 **Player Report: ${playerRow.get('Player Name')}**\n`;
        response += `💰 **Yearly Salary:** ${salary}\n`;
        response += `🧢 **Cap Hit:** ${capHit}\n`;
        response += `📝 **Extended:** ${isExtended ? "✅ Yes" : "❌ No"}`;

        message.reply(response);
      } else {
        message.reply(`❌ I couldn't find **${playerNameInput}** in the roster.`);
      }
    } catch (err) {
      console.error("Sheets Error:", err);
      message.reply("⚠️ Error accessing the database. Check your column headers!");
    }
  }
});

// 5. LOGIN
client.once('ready', () => {
  console.log(`🚀 FRANCHISE BOT READY: ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
