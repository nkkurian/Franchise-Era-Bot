const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Franchise Pro Bot: Fully Recovered'));
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

// --- 1. REGISTER COMMANDS (INCLUDING HELP) ---
const commands = [
  new SlashCommandBuilder().setName('help').setDescription('List all bot commands and how to use them'),
  new SlashCommandBuilder().setName('salary').setDescription('Check player contract & bonus').addStringOption(o => o.setName('player').setRequired(true)),
  new SlashCommandBuilder().setName('team').setDescription('Check team cap').addStringOption(o => o.setName('teamname').setRequired(true)),
  new SlashCommandBuilder().setName('trade').setDescription('Analyze trade impact').addStringOption(o => o.setName('teama').setRequired(true)).addStringOption(o => o.setName('teama_players').setRequired(true)).addStringOption(o => o.setName('teamb').setRequired(true)).addStringOption(o => o.setName('teamb_players').setRequired(true)),
].map(c => c.toJSON());

client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log(`🚀 FRANCHISE PRO BOT ONLINE`);
});

client.on('messageCreate', async (m) => {
  if (!m.author.bot && m.content.toLowerCase().startsWith('!free')) {
    await m.reply(`GO AWAY AND SLAM THE DOOR!!!!!! ${m.author.username}`);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply();
  
  try {
    const { players, logs } = await getSheetData();

    // --- HELP COMMAND ---
    if (interaction.commandName === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setTitle('📖 Franchise Pro Bot Help')
        .setColor(0x3498db)
        .addFields(
          { name: '`/salary [name]`', value: 'Shows player salary, years left, and bonus info.' },
          { name: '`/team [team]`', value: 'Shows team cap space, extensions, and top earners.' },
          { name: '`/trade [A] [Players] [B] [Players]`', value: 'Calculates cap impact for both teams.' },
          { name: '`!free [text]`', value: 'A hidden command for... special occasions.' }
        );
      return await interaction.editReply({ embeds: [helpEmbed] });
    }

    // --- SALARY COMMAND (WITH FUZZY SEARCH) ---
    if (interaction.commandName === 'salary') {
      const input = interaction.options.getString('player').toLowerCase();
      // First try an exact match or clear inclusion
      let pRow = players.find(r => r._rawData[1]?.toLowerCase() === input);
      
      if (!pRow) {
        // Find top 3 partial matches
        const matches = players
          .filter(r => r._rawData[1]?.toLowerCase().includes(input))
          .slice(0, 3);

        if (matches.length === 1) {
          pRow = matches[0];
        } else if (matches.length > 1) {
          const names = matches.map(m => `• ${m._rawData[1]}`).join('\n');
          return await interaction.editReply(`❌ Multiple players found. Did you mean:\n${names}`);
        } else {
          return await interaction.editReply(`❌ Player **${input}** not found.`);
        }
      }

      // If we found a player (pRow exists)
      const playerName = pRow._rawData[1];
      const tLogRow = logs.find(r => r._rawData[0]?.toLowerCase().includes(playerName.toLowerCase()));
      let bonusDisplay = "None";
      if (tLogRow) {
        const bonus = tLogRow._rawData[4] || ""; 
        const kick = tLogRow._rawData[5] || "";
        if (bonus || kick) bonusDisplay = `${kick ? `**Kick In:** ${kick}\n` : ""}${bonus}`;
      }

      const embed = new EmbedBuilder()
        .setTitle(`📊 Report: ${playerName} (${pRow._rawData[0] || "FA"})`)
        .setColor(0x00ff00)
        .addFields(
          { name: '💰 Salary', value: pRow._rawData[4] || "$0", inline: true },
          { name: '🧢 Cap Hit', value: pRow._rawData[6] || "$0", inline: true },
          { name: '⏳ Years', value: pRow._rawData[3] || "0", inline: true },
          { name: '💀 Dead Cap', value: (pRow._rawData[9] === "TRUE" ? "✅ Yes" : "❌ No"), inline: true },
          { name: '✨ Bonus', value: bonusDisplay, inline: false }
        );
      await interaction.editReply({ embeds: [embed] });
    } else {
        await interaction.editReply(`❌ Player **${input}** not found.`);
      }
    }

    // --- TEAM COMMAND ---
    if (interaction.commandName === 'team') {
      const teamInput = interaction.options.getString('teamname').toLowerCase();
      const teamSheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(teamInput));
      
      if (teamSheet) {
        // Optimization: Only load the specific Cap/Extension cells from the team tab
        await teamSheet.loadCells(['F2', 'J2']);
        const tTitle = teamSheet.title;

        const top5 = players
          .filter(r => r._rawData[0] === tTitle)
          .sort((a, b) => {
            const valA = parseFloat((a._rawData[6] || "0").replace(/[$,]/g, ''));
            const valB = parseFloat((b._rawData[6] || "0").replace(/[$,]/g, ''));
            return valB - valA;
          })
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

    // --- TRADE COMMAND ---
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
    await interaction.editReply("⚠️ Spreadsheet error. Try again.");
  }
});

client.login(process.env.DISCORD_TOKEN);
