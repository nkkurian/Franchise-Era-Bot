const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
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
    GatewayIntentBits.MessageContent // Required to "see" !free
  ] 
});

// --- 1. DEFINE SLASH COMMANDS (Hidden /free removed from here) ---
const commands = [
  new SlashCommandBuilder()
    .setName('salary')
    .setDescription('Shows player contract, dead cap, and detailed bonus info')
    .addStringOption(option => option.setName('player').setDescription('Enter player name').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('team')
    .setDescription('Shows team cap space and top 5 earners')
    .addStringOption(option => option.setName('teamname').setDescription('Enter team name').setRequired(true)),

  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Calculates trade impact between two teams')
    .addStringOption(option => option.setName('teama').setDescription('Team A').setRequired(true))
    .addStringOption(option => option.setName('teama_players').setDescription('Players from A').setRequired(true))
    .addStringOption(option => option.setName('teamb').setDescription('Team B').setRequired(true))
    .addStringOption(option => option.setName('teamb_players').setDescription('Players from B').setRequired(true)),
].map(command => command.toJSON());

client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`🚀 FRANCHISE BOT READY`);
  } catch (err) { console.error(err); }
});

// --- 2. HIDDEN MESSAGE LISTENER (For !free) ---
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // If someone types !free, the bot slams the door
  if (message.content.toLowerCase() === '!free') {
    await message.reply(`GO AWAY AND SLAM THE DOOR!!!!!! ${message.author.username}`);
  }
});

// --- 3. SLASH INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply(); 
  
  try {
    await doc.loadInfo();
    const pSheet = doc.sheetsByTitle['PlayerList'];
    const tLogSheet = doc.sheetsByTitle['Transaction Log']; 
    
    await pSheet.loadCells();
    await tLogSheet.loadCells();
    
    const pRows = await pSheet.getRows();
    const tRows = await tLogSheet.getRows();

    if (interaction.commandName === 'salary') {
      const input = interaction.options.getString('player').toLowerCase();
      const pRow = pRows.find(r => r._rawData[1]?.toLowerCase().includes(input));

      if (pRow) {
        const teamName = pRow._rawData[0] || "Free Agent"; 
        const playerName = pRow._rawData[1];
        const deadCapStatus = pRow._rawData[9] === "TRUE" || pRow._rawData[9] === true ? "✅ Yes" : "❌ No";

        const tLogRow = tRows.find(r => r._rawData[0]?.toLowerCase().includes(playerName.toLowerCase()));
        
        let bonusDisplay = "None";
        if (tLogRow) {
          const bonusStructure = tLogRow._rawData[4] || ""; 
          const kickInYear = tLogRow._rawData[5] || "";    
          
          if (bonusStructure || kickInYear) {
            bonusDisplay = "";
            if (kickInYear) bonusDisplay += `**Kick In Year:** ${kickInYear}\n`;
            if (bonusStructure) bonusDisplay += `**Details:** ${bonusStructure}`;
          }
        }

        const salaryEmbed = new EmbedBuilder()
          .setTitle(`📊 Player Report: ${playerName} (${teamName})`)
          .setColor(0x00ff00)
          .addFields(
            { name: '💰 Yearly Salary', value: pRow._rawData[4] || "$0.00", inline: true },
            { name: '🧢 Cap Hit', value: pRow._rawData[6] || "$0.00", inline: true },
            { name: '⏳ Years Left', value: pRow._rawData[3] || "0", inline: true },
            { name: '💀 Dead Cap', value: deadCapStatus, inline: true },
            { name: '✨ Bonus Info', value: bonusDisplay, inline: false }
          );
        await interaction.editReply({ embeds: [salaryEmbed] });
      } else {
        await interaction.editReply(`❌ Player **${input}** not found.`);
      }
    }

    if (interaction.commandName === 'team') {
      const teamInput = interaction.options.getString('teamname').toLowerCase();
      const teamSheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(teamInput));
      if (teamSheet) {
        await teamSheet.loadCells('F2:J2');
        const tTitle = teamSheet.title;
        const top5 = pRows
          .filter(r => r._rawData[0] === tTitle)
          .sort((a, b) => parseFloat((b._rawData[6] || "0").replace(/[$,]/g, '')) - parseFloat((a._rawData[6] || "0").replace(/[$,]/g, '')))
          .slice(0, 5)
          .map(r => `• ${r._rawData[1]}: **${r._rawData[6]}**`)
          .join('\n') || "No players found.";

        const teamEmbed = new EmbedBuilder()
          .setTitle(`🏟️ Team Report: ${tTitle}`)
          .setColor(0x3498db)
          .addFields(
            { name: '💸 Cap Space', value: teamSheet.getCellByA1('F2').formattedValue || "$0.00", inline: true },
            { name: '📝 Extensions', value: teamSheet.getCellByA1('J2').formattedValue || "0", inline: true },
            { name: '🔝 Top 5 Earners', value: top5, inline: false }
          );
        await interaction.editReply({ embeds: [teamEmbed] });
      } else {
        await interaction.editReply(`❌ Team **${teamInput}** not found.`);
      }
    }

    if (interaction.commandName === 'trade') {
      const tA = interaction.options.getString('teama');
      const pA_input = interaction.options.getString('teama_players').split(',').map(p => p.trim().toLowerCase());
      const tB = interaction.options.getString('teamb');
      const pB_input = interaction.options.getString('teamb_players').split(',').map(p => p.trim().toLowerCase());

      const getSide = async (teamName, playersIn) => {
        const sh = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(teamName.toLowerCase()));
        let cap = 0; if (sh) { await sh.loadCells('F2'); cap = parseFloat((sh.getCellByA1('F2').formattedValue || "0").replace(/[$,]/g, '')) || 0; }
        let totalSent = 0;
        playersIn.forEach(pn => {
          const r = pRows.find(row => row._rawData[1]?.toLowerCase().includes(pn));
          if (r) totalSent += parseFloat((r._rawData[6] || "0").replace(/[$,]/g, ''));
        });
        return { title: sh ? sh.title : teamName, cap, totalSent };
      };
      const sA = await getSide(tA, pA_input);
      const sB = await getSide(tB, pB_input);
      const embed = new EmbedBuilder().setTitle('🤝 Trade Analysis').setColor(0xe67e22).addFields(
          { name: `${sA.title} New Cap`, value: `$${(sA.cap + sA.totalSent - sB.totalSent).toLocaleString()}`, inline: true },
          { name: `${sB.title} New Cap`, value: `$${(sB.cap + sB.totalSent - sA.totalSent).toLocaleString()}`, inline: true }
      );
      await interaction.editReply({ embeds: [embed] });
    }
  } catch (err) {
    console.error(err);
    if (!interaction.replied) await interaction.editReply("⚠️ Error: Check logs.");
  }
});

client.login(process.env.DISCORD_TOKEN);
