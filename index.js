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

  // --- 1. FULL SALARY COMMAND (REVERTED TO PREFERRED FORMAT) ---
  if (command === '!salary') {
    const playerNameInput = args.slice(1).join(' ').trim().toLowerCase();
    if (!playerNameInput) return message.reply("Please provide a name!");

    try {
      await doc.loadInfo();
      const playerSheet = doc.sheetsByTitle['PlayerList']; 
      const transSheet = doc.sheetsByTitle['Transaction Log'];
      const playerRows = await playerSheet.getRows();
      const transRows = await transSheet.getRows();

      const playerRow = playerRows.find(r => r.get('Player Name')?.toLowerCase().includes(playerNameInput));

      if (playerRow) {
        const name = playerRow.get('Player Name');
        const salary = playerRow.get('Yearly Salary') || "N/A";
        const capHit = playerRow.get('Cap Hit') || "N/A";
        const years = playerRow._rawData[2] || "0";
        const extended = playerRow.get('Extended') === 'TRUE';

        const bonusInfo = transRows.find(r => r.get('Player Name')?.toLowerCase().includes(name.toLowerCase()));

        let response = `📊 **Player Report: ${name}**\n💰 **Yearly Salary:** ${salary}\n🧢 **Cap Hit:** ${capHit}\n⏳ **Years Remaining:** ${years}\n📝 **Extended:** ${extended ? "✅ Yes" : "❌ No"}`;

        if (bonusInfo && (bonusInfo.get('Bonus Structure') || bonusInfo.get('Kick In Year(Offseason)'))) {
          response += `\n\n✨ **Bonus:** ${bonusInfo.get('Bonus Structure') || "None"}\n📅 **Kick In Year:** ${bonusInfo.get('Kick In Year(Offseason)') || "N/A"}`;
        }
        message.reply(response);
      } else {
        message.reply(`❌ I couldn't find **${playerNameInput}** in the roster.`);
      }
    } catch (err) { console.error(err); }
  }

  // --- 2. INTEGRATED TRADE COMMAND (WITH TEAM CAP LOOKUP) ---
  if (command === '!trade') {
    const tradeContent = message.content.slice(7); 
    const sides = tradeContent.split('for');
    if (sides.length !== 2) return message.reply("Format: `!trade [TeamA]: Player1, Player2 for [TeamB]: Player3`");

    try {
      await doc.loadInfo();
      const playerRows = await doc.sheetsByTitle['PlayerList'].getRows();

      const getTradeData = async (sideStr) => {
        const [teamName, playerList] = sideStr.split(':').map(s => s.trim());
        const names = playerList.split(',').map(n => n.trim().toLowerCase());
        
        let totalHit = 0;
        let found = [];
        
        // Find Team Sheet for Cap Space (Cell F2)
        const teamSheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(teamName.toLowerCase()));
        let currentCap = 0;
        if (teamSheet) {
          await teamSheet.loadCells('F2');
          currentCap = parseFloat(teamSheet.getCellByA1('F2').formattedValue.replace(/[$,]/g, '')) || 0;
        }

        names.forEach(name => {
          const row = playerRows.find(r => r.get('Player Name')?.toLowerCase().includes(name));
          if (row) {
            totalHit += parseFloat((row.get('Cap Hit') || "0").replace(/[$,]/g, '')) || 0;
            found.push(row.get('Player Name'));
          }
        });
        return { team: teamSheet ? teamSheet.title : teamName, totalHit, players: found, currentCap };
      };

      const sideA = await getTradeData(sides[0]);
      const sideB = await getTradeData(sides[1]);

      const aNew = sideA.currentCap + sideA.totalHit - sideB.totalHit;
      const bNew = sideB.currentCap + sideB.totalHit - sideA.totalHit;

      let res = `🤝 **Trade Analysis: ${sideA.team} ↔️ ${sideB.team}**\n\n`;
      res += `**${sideA.team} Sends:** ${sideA.players.join(', ')} ($${sideA.totalHit.toLocaleString()})\n`;
      res += `**${sideB.team} Sends:** ${sideB.players.join(', ')} ($${sideB.totalHit.toLocaleString()})\n\n`;
      res += `💰 **${sideA.team} New Space:** $${aNew.toLocaleString()}\n`;
      res += `💰 **${sideB.team} New Space:** $${bNew.toLocaleString()}`;

      message.reply(res);
    } catch (err) { console.error(err); }
  }
});

client.once('ready', () => console.log(`🚀 FRANCHISE BOT READY`));
client.login(process.env.DISCORD_TOKEN);
