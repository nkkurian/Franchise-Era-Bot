const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// --- 1. WEB SERVER FOR RENDER ---
const app = express();
app.get('/', (req, res) => res.send('Franchise Bot: Active'));
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

// --- 3. DEFINE SLASH COMMANDS ---
const commands = [
  new SlashCommandBuilder()
    .setName('salary')
    .setDescription('Shows player contract details, dead cap, and restructure info')
    .addStringOption(option => 
      option.setName('player').setDescription('Enter the player name').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('team')
    .setDescription('Shows team cap space and available extensions')
    .addStringOption(option => 
      option.setName('teamname').setDescription('Enter the team name').setRequired(true)),

  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Calculates trade impact between two teams')
    .addStringOption(option => 
      option.setName('teama').setDescription('Name of the first team').setRequired(true))
    .addStringOption(option => 
      option.setName('teama_players').setDescription('Players from Team A (comma separated)').setRequired(true))
    .addStringOption(option => 
      option.setName('teamb').setDescription('Name of the second team').setRequired(true))
    .addStringOption(option => 
      option.setName('teamb_players').setDescription('Players from Team B (comma separated)').setRequired(true)),
].map(command => command.toJSON());

// --- 4. REGISTER COMMANDS ON STARTUP ---
client.once('ready', async () => {
  console.log(`🚀 FRANCHISE BOT READY as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
});

// --- 5. SMART PREFIX REDIRECT ---
client.on('messageCreate', (message) => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase();
  const oldCommands = ['!salary', '!team', '!trade', '!help'];
  
  if (oldCommands.some(cmd => content.startsWith(cmd))) {
    message.reply("⚠️ **Please use the new / commands!** Just type `/` in the chat to see the menu for Salary, Team, and Trade info.");
  }
});

// --- 6. INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply(); 

  const { commandName, options } = interaction;
  
  try {
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
        const hasDeadCap = playerRow.get('Dead Cap') === 'TRUE';
        const transInfo = transRows.find(r => r.get('Player Name')?.toLowerCase().includes(name.toLowerCase()));
        const isRestructured = transInfo?.get('Type') === 'Restructure';

        const salaryEmbed = new EmbedBuilder()
          .setTitle(`📊 Player Report: ${name}`)
          .setColor(hasDeadCap ? 0xff0000 : 0x00ff00)
          .addFields(
            { name: '💰 Yearly Salary', value: playerRow.get('Yearly Salary') || "N/A", inline: true },
            { name: '🧢 Cap Hit', value: playerRow.get('Cap Hit') || "N/A", inline: true },
            { name: '⏳ Years Left', value: playerRow._rawData[2] || "0", inline: true },
            { name: '💀 Dead Cap', value: hasDeadCap ? "⚠️ Yes" : "❌ No", inline: true }
          );
        
        if (transInfo) {
          const label = isRestructured ? "🔄 Restructure" : "✨ Bonus Info";
          salaryEmbed.addFields({ name: label, value: transInfo.get('Bonus Structure') || "None" });
          salaryEmbed.setFooter({ text: `Kick In Year: ${transInfo.get('Kick In Year(Offseason)') || "N/A"}` });
        }

        await interaction.editReply({ embeds: [salaryEmbed] });
      } else {
        await interaction.editReply(`❌ I couldn't find **${playerNameInput}**.`);
      }
    }

    // --- TEAM COMMAND ---
    if (commandName === 'team') {
      const teamInput = options.getString('teamname').toLowerCase();
      const sheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(teamInput));
      if (sheet) {
        await sheet.loadCells('F2:J2');
        const teamEmbed = new EmbedBuilder()
          .setTitle(`🏟️ Team Report: ${sheet.title}`)
          .setColor(0x3498db)
          .addFields(
            { name: '💸 Cap Space', value: sheet.getCellByA1('F2').formattedValue || "$0.00", inline: true },
            { name: '📝 Extensions Left', value: sheet.getCellByA1('J2').formattedValue || "0", inline: true }
          );
        await interaction.editReply({ embeds: [teamEmbed] });
      } else {
        await interaction.editReply(`❌ I couldn't find team "**${teamInput}**".`);
      }
    }

    // --- TRADE COMMAND ---
    if (commandName === 'trade') {
      const teamAName = options.getString('teama');
      const teamAPlayers = options.getString('teama_players').split(',').map(p => p.trim().toLowerCase());
      const teamBName = options.getString('teamb');
      const teamBPlayers = options.getString('teamb_players').split(',').map(p => p.trim().toLowerCase());
      
      const playerRows = await doc.sheetsByTitle['PlayerList'].getRows();
      const transRows = await doc.sheetsByTitle['Transaction Log'].getRows();

      const processTradeSide = async (name, playerNames) => {
        let totalHit = 0;
        let details = [];
        const teamSheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(name.toLowerCase()));
        let currentCap = 0;
        
        if (teamSheet) {
          await teamSheet.loadCells('F2');
          currentCap = parseFloat(teamSheet.getCellByA1('F2').formattedValue.replace(/[$,]/g, '')) || 0;
        }

        playerNames.forEach(pName => {
          const row = playerRows.find(r => r.get('Player Name')?.toLowerCase().includes(pName));
          if (row) {
            const actualName = row.get('Player Name');
            const hit = parseFloat((row.get('Cap Hit') || "0").replace(/[$,]/g, '')) || 0;
            const dead = row.get('Dead Cap') === 'TRUE';
            totalHit += hit;

            const trans = transRows.find(tr => tr.get('Player Name')?.toLowerCase().includes(actualName.toLowerCase()));
            let playerStr = `- **${actualName}** ($${hit.toLocaleString()})${dead ? " 💀" : ""}`;
            
            if (trans) {
                const typeLabel = trans.get('Type') === 'Restructure' ? "🔄 Restructure" : "✨ Bonus";
                playerStr += `\n    └ *${typeLabel}: ${trans.get('Bonus Structure')}*`;
            }
            details.push(playerStr);
          }
        });
        return { title: teamSheet ? teamSheet.title : name, totalHit, details, currentCap };
      };

      const sideA = await processTradeSide(teamAName, teamAPlayers);
      const sideB = await processTradeSide(teamBName, teamBPlayers);
      
      const aNew = sideA.currentCap + sideA.totalHit - sideB.totalHit;
      const bNew = sideB.currentCap + sideB.totalHit - sideA.totalHit;

      const tradeEmbed = new EmbedBuilder()
        .setTitle('🤝 Detailed Trade Analysis')
        .setColor(0xe67e22)
        .addFields(
          { name: `📤 ${sideA.title} Sends`, value: sideA.details.join('\n') || 'None', inline: false },
          { name: `📥 ${sideB.title} Sends`, value: sideB.details.join('\n') || 'None', inline: false },
          { name: `💰 ${sideA.title} New Cap`, value: `$${aNew.toLocaleString()}`, inline: true },
          { name: `💰 ${sideB.title} New Cap`, value: `$${bNew.toLocaleString()}`, inline: true }
        )
        .setFooter({ text: '💀 = Dead Cap | 🔄 = Restructure | ✨ = Bonus' });

      await interaction.editReply({ embeds: [tradeEmbed] });
    }
  } catch (err) {
    console.error('Interaction Error:', err);
    await interaction.editReply("⚠️ Error: Check spreadsheet formatting or team names.");
  }
});

client.login(process.env.DISCORD_TOKEN);
