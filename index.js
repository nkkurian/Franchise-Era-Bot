const { 
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, 
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType 
} = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// Keep-alive server for Render
const app = express();
app.get('/', (req, res) => res.send('Franchise Pro Bot: Buttons & Search Active'));
app.listen(process.env.PORT || 10000);

// Google Sheets Auth
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_EMAIL,
  key: process.env.GOOGLE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SHEET_ID, serviceAccountAuth);
const client = new Client({ 
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

// --- CACHE SYSTEM ---
let cachedPlayers = [];
let cachedLogs = [];
let lastFetchTime = 0;
const CACHE_LIFESPAN = 30000; 

async function getSheetData() {
  const now = Date.now();
  if (now - lastFetchTime < CACHE_LIFESPAN && cachedPlayers.length > 0) return { players: cachedPlayers, logs: cachedLogs };
  
  await doc.loadInfo();
  const [pRows, tRows] = await Promise.all([
    doc.sheetsByTitle['PlayerList'].getRows(),
    doc.sheetsByTitle['Transaction Log'].getRows()
  ]);
  
  cachedPlayers = pRows;
  cachedLogs = tRows;
  lastFetchTime = now;
  return { players: cachedPlayers, logs: cachedLogs };
}

// --- COMMAND REGISTRATION (FIXED DESCRIPTIONS) ---
const commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('List all bot commands'),
  new SlashCommandBuilder()
    .setName('salary')
    .setDescription('Check player contract & bonus info')
    .addStringOption(o => o.setName('player').setDescription('Enter player name').setRequired(true)),
  new SlashCommandBuilder()
    .setName('team')
    .setDescription('Check team cap space')
    .addStringOption(o => o.setName('teamname').setDescription('Enter team name').setRequired(true)),
  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Analyze trade impact')
    .addStringOption(o => o.setName('teama').setDescription('First team').setRequired(true))
    .addStringOption(o => o.setName('teama_players').setDescription('Players from first team').setRequired(true))
    .addStringOption(o => o.setName('teamb').setDescription('Second team').setRequired(true))
    .addStringOption(o => o.setName('teamb_players').setDescription('Players from second team').setRequired(true)),
].map(c => c.toJSON());

client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`🚀 FRANCHISE PRO BOT ONLINE`);
  } catch (err) { console.error(err); }
});

// --- HELPER: CREATE PLAYER EMBED ---
function createPlayerEmbed(pRow, logs) {
  const teamName = pRow._rawData[0] || "Free Agent";
  const playerName = pRow._rawData[1];
  const deadCapStatus = pRow._rawData[9] === "TRUE" || pRow._rawData[9] === true ? "✅ Yes" : "❌ No";
  const tLogRow = logs.find(r => r._rawData[0]?.toLowerCase().includes(playerName.toLowerCase()));
  
  let bonusDisplay = "None";
  if (tLogRow) {
    const bonus = tLogRow._rawData[4] || ""; 
    const kick = tLogRow._rawData[5] || "";
    if (bonus || kick) bonusDisplay = `${kick ? `**Kick In:** ${kick}\n` : ""}${bonus ? `**Details:** ${bonus}` : ""}`;
  }

  return new EmbedBuilder()
    .setTitle(`📊 Player Report: ${playerName} (${teamName})`)
    .setColor(0x00ff00)
    .addFields(
      { name: '💰 Yearly Salary', value: pRow._rawData[4] || "$0.00", inline: true },
      { name: '🧢 Cap Hit', value: pRow._rawData[6] || "$0.00", inline: true },
      { name: '⏳ Years Left', value: pRow._rawData[3] || "0", inline: true },
      { name: '💀 Dead Cap', value: deadCapStatus, inline: true },
      { name: '✨ Bonus Info', value: bonusDisplay, inline: false }
    );
}

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply(); 
  
  try {
    const { players, logs } = await getSheetData();

    if (interaction.commandName === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setTitle('📖 Franchise Pro Bot Help')
        .setColor(0x3498db)
        .addFields(
          { name: '`/salary [name]`', value: 'Search for player contracts. Uses buttons for multiple matches.' },
          { name: '`/team [team]`', value: 'View team cap space and top 5 earners.' },
          { name: '`/trade`', value: 'Calculate cap impact for swaps.' }
        );
      return await interaction.editReply({ embeds: [helpEmbed] });
    }

    if (interaction.commandName === 'salary') {
      const input = interaction.options.getString('player').toLowerCase();
      const matches = players.filter(r => r._rawData[1]?.toLowerCase().includes(input));

      if (matches.length === 0) return await interaction.editReply(`❌ Player **${input}** not found.`);

      if (matches.length === 1) {
        return await interaction.editReply({ embeds: [createPlayerEmbed(matches[0], logs)] });
      }

      const limitedMatches = matches.slice(0, 5); 
      const row = new ActionRowBuilder().addComponents(
        limitedMatches.map((m, index) => 
          new ButtonBuilder()
            .setCustomId(`select_player_${index}`)
            .setLabel(m._rawData[1])
            .setStyle(ButtonStyle.Primary)
        )
      );

      const response = await interaction.editReply({
        content: `🔍 Found multiple players. Select one:`,
        components: [row]
      });

      const collector = response.createMessageComponentCollector({ 
        componentType: ComponentType.Button, 
        time: 30000 
      });

      collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) return i.reply({ content: "Not your search!", ephemeral: true });
        const selectedIndex = parseInt(i.customId.replace('select_player_', ''));
        const selectedPlayer = limitedMatches[selectedIndex];
        await i.update({ content: null, embeds: [createPlayerEmbed(selectedPlayer, logs)], components: [] });
        collector.stop();
      });

      collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
          interaction.editReply({ content: "⏳ Selection timed out.", components: [] });
        }
      });
      return;
    }

    if (interaction.commandName === 'team') {
      const teamInput = interaction.options.getString('teamname').toLowerCase();
      const teamSheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(teamInput));
      
      if (teamSheet) {
        await teamSheet.loadCells(['F2', 'J2']);
        const tTitle = teamSheet.title;
        const top5 = players
          .filter(r => r._rawData[0] === tTitle)
          .sort((a, b) => parseFloat((b._rawData[6] || "0").replace(/[$,]/g, '')) - parseFloat((a._rawData[a] || "0").replace(/[$,]/g, '')))
          .slice(0, 5).map(r => `• ${r._rawData[1]}: **${r._rawData[6]}**`).join('\n');

        const teamEmbed = new EmbedBuilder().setTitle(`🏟️ Team Report: ${tTitle}`).setColor(0x3498db)
          .addFields(
            { name: '💸 Cap Space', value: teamSheet.getCellByA1('F2').formattedValue || "$0", inline: true },
            { name: '📝 Extensions', value: teamSheet.getCellByA1('J2').formattedValue || "0", inline: true },
            { name: '🔝 Top 5 Earners', value: top5 || "No data found", inline: false }
          );
        return await interaction.editReply({ embeds: [teamEmbed] });
      }
      return await interaction.editReply(`❌ Team **${teamInput}** not found.`);
    }

    if (interaction.commandName === 'trade') {
      const tA = interaction.options.getString('teama');
      const pA_input = interaction.options.getString('teama_players').split(',').map(p => p.trim().toLowerCase());
      const tB = interaction.options.getString('teamb');
      const pB_input = interaction.options.getString('teamb_players').split(',').map(p => p.trim().toLowerCase());

      const getSide = async (teamName, playersIn) => {
        const sh = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(teamName.toLowerCase()));
        let cap = 0; 
        if (sh) { await sh.loadCells('F2'); cap = parseFloat((sh.getCellByA1('F2').formattedValue || "0").replace(/[$,]/g, '')) || 0; }
        let totalSent = 0;
        playersIn.forEach(pn => {
          const r = players.find(row => row._rawData[1]?.toLowerCase().includes(pn));
          if (r) totalSent += parseFloat((r._rawData[6] || "0").replace(/[$,]/g, ''));
        });
        return { title: sh ? sh.title : teamName, cap, totalSent };
      };

      const sA = await getSide(tA, pA_input);
      const sB = await getSide(tB, pB_input);
      
      const tradeEmbed = new EmbedBuilder().setTitle('🤝 Trade Analysis').setColor(0xe67e22)
        .addFields(
          { name: `${sA.title} New Cap`, value: `$${(sA.cap + sA.totalSent - sB.totalSent).toLocaleString()}`, inline: true },
          { name: `${sB.title} New Cap`, value: `$${(sB.cap + sB.totalSent - sA.totalSent).toLocaleString()}`, inline: true }
        );
      return await interaction.editReply({ embeds: [tradeEmbed] });
    }

  } catch (err) {
    console.error(err);
    if (!interaction.replied) await interaction.editReply("⚠️ Bot Error.");
  }
});

client.login(process.env.DISCORD_TOKEN);
