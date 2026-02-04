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

  // --- UPDATED SALARY & BONUS COMMAND ---
  if (command === '!salary') {
    const playerNameInput = args.slice(1).join(' ').trim().toLowerCase();
    if (!playerNameInput) return message.reply("Please provide a name!");

    try {
      await doc.loadInfo();
      const playerSheet = doc.sheetsByTitle['PlayerList']; 
      const transactionSheet = doc.sheetsByTitle['Transaction Log']; // New lookup tab
      
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
        const years = playerRow._rawData[2] || "0";
        const extended = playerRow.get('Extended') === 'TRUE';

        // LOOKUP BONUS IN TRANSACTION LOG
        const bonusInfo = transRows.find(r => 
          r.get('Player Name') && r.get('Player Name').toLowerCase().includes(name.toLowerCase())
        );

        let response = `📊 **Player Report: ${name}**\n`;
        response += `💰 **Yearly Salary:** ${salary}\n`;
        response += `🧢 **Cap Hit:** ${capHit}\n`;
        response += `⏳ **Years Remaining:** ${years}\n`;
        response += `📝 **Extended:** ${extended ? "✅ Yes" : "❌ No"}\n`;

        // Add Bonus details if they exist
        if (bonusInfo) {
          const structure = bonusInfo.get('Bonus Structure');
          const kickIn = bonusInfo.get('Kick In Year(Offseason)');
          if (structure) response += `✨ **Bonus:** ${structure}\n`;
          if (kickIn) response += `📅 **Kick In Year:** ${kickIn}\n`;
        }

        message.reply(response);
      } else {
        message.reply(`❌ I couldn't find anyone matching **${playerNameInput}**.`);
      }
    } catch (err) { console.error(err); }
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

        message.reply(`🏟️ **Team Report: ${sheet.title}**\n💸 **Cap Space:** ${capSpace}\n📝 **Extensions Used:** ${extensionsUsed}`);
      } else {
        message.reply(`❌ I couldn't find a team matching "**${teamNameInput}**".`);
      }
    } catch (err) { console.error(err); }
  }
});

client.once('ready', () => console.log(`🚀 FRANCHISE BOT READY: ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);
