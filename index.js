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

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.split(' ');
  const command = args[0].toLowerCase();

  // --- SALARY COMMAND (FIXED INDEX PULLING) ---
  if (command === '!salary') {
    const playerNameInput = args.slice(1).join(' ').trim().toLowerCase();
    if (!playerNameInput) return message.reply("Please provide a name!");

    try {
      await doc.loadInfo();
      const sheet = doc.sheetsByTitle['PlayerList']; 
      const rows = await sheet.getRows();

      const playerRow = rows.find(r => {
        const fullName = r.get('Player Name') ? r.get('Player Name').toLowerCase() : "";
        return fullName.includes(playerNameInput); 
      });

      if (playerRow) {
        // We use _rawData to get the exact value from Column C (index 2)
        // Index 0 = Player Name, Index 1 = Position, Index 2 = Years
        const salary = playerRow.get('Yearly Salary') || "N/A";
        const capHit = playerRow.get('Cap Hit') || "N/A";
        const years = playerRow._rawData[2] || "0"; // Directly pulls Column C
        const extended = playerRow.get('Extended') === 'TRUE';

        let response = `📊 **Player Report: ${playerRow.get('Player Name')}**\n`;
        response += `💰 **Yearly Salary:** ${salary}\n`;
        response += `🧢 **Cap Hit:** ${capHit}\n`;
        response += `⏳ **Years Remaining:** ${years}\n`;
        response += `📝 **Extended:** ${extended ? "✅ Yes" : "❌ No"}`;

        message.reply(response);
      } else {
        message.reply(`❌ I couldn't find anyone matching **${playerNameInput}**.`);
      }
    } catch (err) { console.error("SALARY ERROR:", err.message); }
  }

  // --- TEAM COMMAND ---
  if (command === '!team') {
    const teamNameInput = args.slice(1).join(' ').trim().toLowerCase();
    if (!teamNameInput) return message.reply("Please provide a team name!");

    try {
      await doc.loadInfo();
      const sheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(teamNameInput));

      if (sheet) {
        await sheet.loadCells('A1:J5'); 
        const capSpace = sheet.getCellByA1('F2').formattedValue || "$0.00";
        const extensionsUsed = sheet.getCellByA1('J2').formattedValue || "0";

        let response = `🏟️ **Team Report: ${sheet.title}**\n`;
        response += `💸 **Cap Space:** ${capSpace}\n`;
        response += `📝 **Extensions Used:** ${extensionsUsed}`;

        message.reply(response);
      } else {
        message.reply(`❌ I couldn't find a team matching "**${teamNameInput}**".`);
      }
    } catch (err) { console.error("TEAM ERROR:", err.message); }
  }
});

client.once('ready', () => console.log(`🚀 FRANCHISE BOT READY: ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);
