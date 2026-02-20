const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// --- 1. WEB SERVER FOR RENDER ---
const app = express();
app.get('/', (req, res) => res.send('Franchise Bot: Slash Command Active'));
app.listen(process.env.PORT || 10000);

// --- 2. AUTHENTICATION & CLIENT SETUP ---
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

// --- 3. DEFINE SLASH COMMANDS (THE POPUP MENU) ---
// This creates the menu seen in image_a83e04.png
const commands = [
  new SlashCommandBuilder()
    .setName('salary')
    .setDescription('Shows player details, dead cap, and restructure info')
    .addStringOption(option => 
      option.setName('player').setDescription('Name of the player').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('team')
    .setDescription('Shows cap space and extensions left')
    .addStringOption(option => 
      option.setName('teamname').setDescription('Name of the team').setRequired(true)),

  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Calculates trade impact between two teams')
    .addStringOption(option => 
      option.setName('teama').setDescription('Team A and Players (Team: Player)').setRequired(true))
    .addStringOption(option => 
      option.setName('teamb').setDescription('Team B and Players (Team: Player)').setRequired(true)),
].map(command => command.toJSON());

// --- 4. REGISTER COMMANDS ON STARTUP ---
client.once('ready', async () => {
  console.log(`🚀 FRANCHISE BOT READY as ${client.user.tag}`);
  
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
});

// --- 5. INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options } = interaction;
  await doc.loadInfo();

  // --- SALARY COMMAND ---
  if (commandName === 'salary') {
    const playerNameInput = options.getString('player').toLowerCase();
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
      const hasDeadCap = playerRow.get('Dead Cap') === 'TRUE'; //

      const transInfo = transRows.find(r => r.get('Player Name')?.toLowerCase().includes(name.toLowerCase()));
      const isRestructured = transInfo?.get('Type') === 'Restructure'; //

      let response = `📊 **Player Report: ${name}**\n💰 **Yearly Salary:** ${salary}\n🧢 **Cap Hit:** ${capHit}\n⏳ **Years Remaining:** ${years}\n📝 **Extended:** ${extended ? "✅ Yes" : "❌ No"}\n💀 **Dead Cap:** ${hasDeadCap ? "⚠️ Yes" : "❌ No"}`;
      
      if (transInfo) {
        const label = isRestructured ? "🔄 **Restructure Details**" : "✨ **Bonus**"; //
        response += `\n\n${label}: ${transInfo.get('Bonus Structure') || "None"}\n📅 **Kick In Year:** ${transInfo.get('Kick In Year(Offseason)') || "N/A"}`;
      }
      await interaction.reply(response);
    } else {
      await interaction.reply({ content: `❌ I couldn't find **${playerNameInput}**.`, ephemeral: true });
    }
  }

  // --- TEAM COMMAND ---
  if (commandName === 'team') {
    const teamInput = options.getString('teamname').toLowerCase();
    const sheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(teamInput));
    
    if (sheet) {
      await sheet.loadCells('A1:J5');
      const capSpace = sheet.getCellByA1('F2').formattedValue || "$0.00";
      const extensions = sheet.getCellByA1('J2').formattedValue || "0";
      await interaction.reply(`🏟️ **Team Report: ${sheet.title}**\n💸 **Cap Space:** ${capSpace}\n📝 **Extensions Left:** ${extensions}`);
    } else {
      await interaction.reply({ content: `❌ I couldn't find team "**${teamInput}**".`, ephemeral: true });
    }
  }

  // --- TRADE COMMAND ---
  if (commandName === 'trade') {
    const strA = options.getString('teama');
    const strB = options.getString('teamb');
    
    try {
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
            const hasDeadCap = row.get('Dead Cap') === 'TRUE';
            totalHit += hit;

            const trans = transRows.find(tr => tr.get('Player Name')?.toLowerCase().includes(actualName.toLowerCase()));
            const isRes = trans?.get('Type') === 'Restructure';
            
            let playerStr = `- **${actualName}** ($${hit.toLocaleString()})${hasDeadCap ? "💀" : ""}${isRes ? "🔄" : ""}`;
            details.push(playerStr);
          }
        });
        return { team: teamSheet ? teamSheet.title : teamName, totalHit, details, currentCap };
      };

      const sideA = await getTradeData(strA);
      const sideB = await getTradeData(strB);
      
      const aNew = sideA.currentCap + sideA.totalHit - sideB.totalHit;
      const bNew = sideB.currentCap + sideB.totalHit - sideA.totalHit;

      let res = `🤝 **Trade Analysis: ${sideA.team} ↔️ ${sideB.team}**\n\n`;
      res += `**${sideA.team} Sends:**\n${sideA.details.join('\n')}\n*(Outgoing: $${sideA.totalHit.toLocaleString()})*\n\n`;
      res += `**${sideB.team} Sends:**\n${sideB.details.join('\n')}\n*(Outgoing: $${sideB.totalHit.toLocaleString()})*\n\n`;
      res += `💰 **${sideA.team} New Space:** $${aNew.toLocaleString()}\n`;
      res += `💰 **${sideB.team} New Space:** $${bNew.toLocaleString()}`;

      await interaction.reply(res);
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: "Error processing trade. Use format `Team: Player`", ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
