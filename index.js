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

  // --- SALARY COMMAND (PARTIAL SEARCH) ---
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
        const salary = playerRow.get('Yearly Salary') || "N/A";
        const capHit = playerRow.get('Cap Hit') || "N/A";
        const extended = playerRow.get('Extended') === 'TRUE';
        message.reply(`📊 **Player Report: ${playerRow.get('Player Name')}**\n **Yearly Salary:** ${salary}\n **Cap Hit:** ${capHit}\n **Extended:** ${extended ? "✅ Yes" : "❌ No"}`);
      } else {
        message.reply(`❌ I couldn't find anyone matching **${playerNameInput}**.`);
      }
    } catch (err) { console.error(err); }
  }

  // --- TEAM COMMAND (SMART PARTIAL TAB SEARCH) ---
  if (command === '!team') {
    const teamNameInput = args.slice(1).join(' ').trim().toLowerCase();
    if (!teamNameInput) return message.reply("Please provide a team name! (e.g., `!team Grand`)");

    try {
      await doc.loadInfo();
      
      // SEARCH ALL TABS: Find a tab where the title contains our input
      const sheet = doc.sheetsByIndex.find(s => 
        s.title.toLowerCase().includes(teamNameInput)
      );

      if (sheet) {
        // Load cells including J to reach the extension count
        await sheet.loadCells('A1:J5'); 
        
        // Target F2 for Cap Space and J2 for Extensions
        const capSpace = sheet.getCellByA1('F2').formattedValue || "$0.00";
        const extensionsUsed = sheet.getCellByA1('J2').formattedValue || "0";

        let response = ` **Team Report: ${sheet.title}**\n`;
        response += ` **Cap Space:** ${capSpace}\n`;
        response += ` **Extensions Left:** ${extensionsUsed}`;

        message.reply(response);
      } else {
        message.reply(`❌ I couldn't find a team matching "**${teamNameInput}**".`);
      }
    } catch (err) {
      console.error("TEAM SEARCH ERROR:", err.message);
      message.reply("⚠️ Error accessing the team's data.");
    }
  }
});

client.once('ready', () => console.log(`🚀 FRANCHISE BOT READY: ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);
