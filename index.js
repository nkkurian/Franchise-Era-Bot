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

  // --- 1. HELP COMMAND ---
  if (command === '!help') {
    let helpMsg = `📜 **Franchise Bot Commands**\n\n`;
    helpMsg += `🔍 **!salary [Player Name]**\nShows contract details and bonus structures.\n\n`;
    helpMsg += `🏟️ **!team [Team Name]**\nShows cap space and extensions left.\n\n`;
    helpMsg += `🤝 **!trade [TeamA]: Player1 for [TeamB]: Player2**\nCalculates trade impact and bonus info.`;
    return message.reply(helpMsg);
  }

  // --- 2. TEAM COMMAND ---
  if (command === '!team') {
    const teamNameInput = args.slice(1).join(' ').trim().toLowerCase();
    if (!teamNameInput) return message.reply("Please provide a team name!");
    try {
      await doc.loadInfo();
      const sheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(teamNameInput));
      if (sheet) {
        await sheet.loadCells('A1:J5'); 
        const capSpace = sheet.getCellByA1('F2').formattedValue || "$0.00";
        const extensionsLeft = sheet.getCellByA1('J2').formattedValue || "0";
        message.reply(`🏟️ **Team Report: ${sheet.title}**\n💸 **Cap Space:** ${capSpace}\n📝 **Extensions Left:** ${extensionsLeft}`);
      } else {
        message.reply(`❌ I couldn't find a team matching "**${teamNameInput}**".`);
      }
    } catch (err) { console.error(err); }
  }

  // --- 3. SALARY COMMAND ---
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
        message.reply(`❌ I couldn't find **${playerNameInput}**.`);
      }
    } catch (err) { console.error(err); }
  }

  // --- 4. TRADE COMMAND ---
  if (command === '!trade') {
    const tradeContent = message.content.slice(7); 
    const sides = tradeContent.split('for');
    if (sides.length !== 2) return message.reply("Format: `!trade [TeamA]: Player1 for [TeamB]: Player2`");

    try {
      await doc.loadInfo();
      const playerRows = await doc.sheetsByTitle['PlayerList'].getRows();
      const transRows = await doc.sheetsByTitle['Transaction Log'].getRows();

      const getTradeData = async (sideStr) => {
        const [teamName, playerList] = sideStr.split(':').map(s => s.trim());
        const names = playerList.split(',').map(n => n.trim().toLowerCase());
        let totalHit = 0;
        let details = [];
        const teamSheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(teamName.toLowerCase()));
        let currentCap = 0;
        if (teamSheet) {
          await teamSheet.loadCells('F2');
          currentCap = parseFloat(teamSheet.getCellByA1('F2').formattedValue.replace(/[$,]/g, '')) || 0;
        }
        names.forEach(name => {
          const row = playerRows.find(r => r.get('Player Name')?.toLowerCase().includes(name));
          if (row) {
            const actualName = row.get('Player Name');
            const hit = parseFloat((row.get('Cap Hit') || "0").replace(/[$,]/g, '')) || 0;
            totalHit += hit;
            const bonus = transRows.find(tr => tr.get('Player Name')?.toLowerCase().includes(actualName.toLowerCase()));
            let playerStr = `- **${actualName}** ($${hit.toLocaleString()})`;
            if (bonus && bonus.get('Bonus Structure')) {
              playerStr += `\n  └ ✨ *Bonus: ${bonus.get('Bonus Structure')} (Kick-in: ${bonus.get('Kick In Year(Offseason)') || 'N/A'})*`;
            }
            details.push(playerStr);
          }
        });
        return { team: teamSheet ? teamSheet.title : teamName, totalHit, details, currentCap };
      };

      const sideA = await getTradeData(sides[0]);
      const sideB = await getTradeData(sides[1]);
      const aNew = sideA.currentCap + sideA.totalHit - sideB.totalHit; 
      const bNew = sideB.currentCap + sideB.totalHit - sideA.totalHit; 

      let res = `🤝 **Trade Analysis: ${sideA.team} ↔️ ${sideB.team}**\n\n`;
      res += `**${sideA.team} Sends:**\n${sideA.details.join('\n')}\n*(Total Outgoing: $${sideA.totalHit.toLocaleString()})*\n\n`;
      res += `**${sideB.team} Sends:**\n${sideB.details.join('\n')}\n*(Total Outgoing: $${sideB.totalHit.toLocaleString()})*\n\n`;
      res += `💰 **${sideA.team} New Space:** $${aNew.toLocaleString()}\n`;
      res += `💰 **${sideB.team} New Space:** $${bNew.toLocaleString()}`;
      message.reply(res);
    } catch (err) { console.error(err); }
  }
});

client.once('ready', () => console.log(`🚀 FRANCHISE BOT READY`));
client.login(process.env.DISCORD_TOKEN);
