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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- 3. DEFINE SLASH COMMANDS ---
const commands = [
  new SlashCommandBuilder()
    .setName('salary')
    .setDescription('Shows player contract details')
    .addStringOption(option => 
      option.setName('player').setDescription('Enter the player name').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('team')
    .setDescription('Shows team cap space and top earners')
    .addStringOption(option => 
      option.setName('teamname').setDescription('Enter the team name').setRequired(true)),

  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Calculates trade impact between two teams')
    .addStringOption(option => option.setName('teama').setDescription('Name of Team A').setRequired(true))
    .addStringOption(option => option.setName('teama_players').setDescription('Players from Team A').setRequired(true))
    .addStringOption(option => option.setName('teamb').setDescription('Name of Team B').setRequired(true))
    .addStringOption(option => option.setName('teamb_players').setDescription('Players from Team B').setRequired(true)),
].map(command => command.toJSON());

// --- 4. STARTUP ---
client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`🚀 FRANCHISE BOT READY`);
  } catch (err) {
    console.error('Error registering commands:', err);
  }
});

// --- 5. INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply(); 

  const { commandName, options } = interaction;
  
  try {
    await doc.loadInfo();

    // --- SALARY COMMAND ---
    if (commandName === 'salary') {
      const input = options.getString('player').toLowerCase();
      const pSheet = doc.sheetsByTitle['PlayerList'];
      const rows = await pSheet.getRows();
      
      // Matches your sheet: Col A = Team, Col B = Name
      const row = rows.find(r => r.get('Player Name')?.toLowerCase().includes(input));

      if (row) {
        const pName = row.get('Player Name');
        const tName = row.get('Current Team') || "Free Agent";
        
        const salaryEmbed = new EmbedBuilder()
          .setTitle(`📊 Player Report: ${pName} (${tName})`) // Requested Format
          .setColor(0x00ff00)
          .addFields(
            { name: '💰 Yearly Salary', value: row.get('Yearly Salary') || "$0.00", inline: true },
            { name: '🧢 Cap Hit', value: row.get('Cap Hit') || "$0.00", inline: true },
            { name: '⏳ Years Left', value: row.get('Years Left') || "0", inline: true }
          );
        await interaction.editReply({ embeds: [salaryEmbed] });
      } else {
        await interaction.editReply(`❌ Player **${input}** not found.`);
      }
    }

    // --- TEAM COMMAND ---
    if (commandName === 'team') {
      const teamInput = options.getString('teamname').toLowerCase();
      const pSheet = doc.sheetsByTitle['PlayerList'];
      const pRows = await pSheet.getRows();
      const teamSheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(teamInput));
      
      if (teamSheet) {
        await teamSheet.loadCells('F2:J2');
        const tTitle = teamSheet.title;

        const top5 = pRows
          .filter(r => r.get('Current Team') === tTitle)
          .sort((a, b) => parseFloat(b.get('Cap Hit')?.replace(/[$,]/g, '') || 0) - parseFloat(a.get('Cap Hit')?.replace(/[$,]/g, '') || 0))
          .slice(0, 5)
          .map(r => `• ${r.get('Player Name')}: **${r.get('Cap Hit')}**`)
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

    // --- TRADE COMMAND ---
    if (commandName === 'trade') {
      const tA = options.getString('teama');
      const pA_input = options.getString('teama_players').split(',').map(p => p.trim().toLowerCase());
      const tB = options.getString('teamb');
      const pB_input = options.getString('teamb_players').split(',').map(p => p.trim().toLowerCase());
      
      const pRows = await doc.sheetsByTitle['PlayerList'].getRows();

      const getSide = async (teamName, playersIn) => {
        const sh = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(teamName.toLowerCase()));
        let cap = 0; if (sh) { await sh.loadCells('F2'); cap = parseFloat(sh.getCellByA1('F2').formattedValue?.replace(/[$,]/g, '')) || 0; }
        let totalSent = 0;
        playersIn.forEach(pn => {
          const r = pRows.find(row => row.get('Player Name')?.toLowerCase().includes(pn));
          if (r) totalSent += parseFloat(r.get('Cap Hit')?.replace(/[$,]/g, '') || 0);
        });
        return { title: sh ? sh.title : teamName, cap, totalSent };
      };

      const sA = await getSide(tA, pA_input);
      const sB = await getSide(tB, pB_input);
      
      const embed = new EmbedBuilder()
        .setTitle('🤝 Trade Analysis')
        .setColor(0xe67e22)
        .addFields(
          { name: `${sA.title} New Cap`, value: `$${(sA.cap + sA.totalSent - sB.totalSent).toLocaleString()}`, inline: true },
          { name: `${sB.title} New Cap`, value: `$${(sB.cap + sB.totalSent - sA.totalSent).toLocaleString()}`, inline: true }
        );
      await interaction.editReply({ embeds: [embed] });
    }
  } catch (err) {
    console.error(err);
    await interaction.editReply("⚠️ Error processing command. Check Logs.");
  }
});

client.login(process.env.DISCORD_TOKEN);
