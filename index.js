const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// 1. WEB SERVER
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

  // --- RESTORED FULL SALARY COMMAND ---
  if (command === '!salary') {
    const playerNameInput = args.slice(1).join(' ').trim().toLowerCase();
    if (!playerNameInput) return message.reply("Please provide a name!");

    try {
      await doc.loadInfo();
      const playerSheet = doc.sheetsByTitle['PlayerList']; 
      const transactionSheet = doc.sheetsByTitle['Transaction Log']; // For Bonus/Kick In
      
      const playerRows = await playerSheet.getRows();
      const transRows = await transactionSheet.getRows();

      const playerRow = playerRows.find(r => {
        const fullName = r.get('Player Name') ? r.get('Player Name').toLowerCase() : "";
        return fullName.includes(playerNameInput); 
      });

      if (playerRow) {
        const name = playerRow.get('Player Name');
        const salary = playerRow.get('Yearly Salary') || "N/A";
        const capHit = playerRow.get('Cap Hit') || "N/A";
        const years = playerRow._rawData[2] || "0"; // Pulls directly from Column C
        const extended = playerRow.get('Extended') === 'TRUE';

        // Lookup Bonus details in the Transaction Log tab
        const bonusInfo = transRows.find(r => 
          r.get('Player Name') && r.get('Player Name').toLowerCase().includes(name.toLowerCase())
        );

        // BUILDING THE FULL RESPONSE (AS SEEN IN IMAGE_0BA82A)
        let response = `📊 **Player Report: ${name}**\n`;
        response += `💰 **Yearly Salary:** ${salary}\n`;
        response += `🧢 **Cap Hit:** ${capHit}\n`;
        response += `⏳ **Years Remaining:** ${years}\n`;
        response += `📝 **Extended:** ${extended ? "✅ Yes" : "❌ No"}`;

        // Add the space and bonus info if it exists
        if (bonusInfo) {
          const structure = bonusInfo.get('Bonus Structure');
          const kickIn = bonusInfo.get('Kick In Year(Offseason)');
          
          if (structure || kickIn) {
            response += `\n\n`; // The readability space you requested
            if (structure) response += `✨ **Bonus:** ${structure}\n`;
            if (kickIn) response += `📅 **Kick In Year:** ${kickIn}\n`;
          }
        }

        message.reply(response);
      } else {
        message.reply(`❌ I couldn't find **${playerNameInput}** in the roster.`);
      }
    } catch (err) { 
      console.error(err);
      message.reply("⚠️ Error connecting to the salary database."); 
    }
  }

  // --- TEAM COMMAND (PARTIAL SEARCH) ---
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

        message.reply(`🏟️ **Team Report: ${sheet.title}**\n💸 **Cap Space:** ${capSpace}\n📝 **Extensions Used:** ${extensionsUsed}`);
      } else {
        message.reply(`❌ I couldn't find a team matching "**${teamNameInput}**".`);
      }
    } catch (err) { console.error(err); }
  }
});

client.once('ready', () => console.log(`🚀 FRANCHISE BOT READY`));
client.login(process.env.DISCORD_TOKEN);
