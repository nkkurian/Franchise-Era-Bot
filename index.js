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

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent, // <--- CRITICAL for reading Sleeper messages
    GatewayIntentBits.GuildMessageReactions // <--- CRITICAL for reactions
  ] 
});

// --- CACHE SYSTEM ---
let cachedPlayers = [];
let cachedLogs = [];
let cachedIds = []; // Added to store Sleeper ID mappings
let lastFetchTime = 0;
const CACHE_LIFESPAN = 30000; 
const BOT_START_TIME = Date.now();

// Replace 'YOUR_SHEET_ID' with the long string from your spreadsheet URL
const doc = new GoogleSpreadsheet('1-G39QNK9o0qbgBp3nKjjXHGuuSH4bx_xqNsR51jABM8', serviceAccountAuth);

async function getSheetData() {
  const now = Date.now();
  if (now - lastFetchTime < CACHE_LIFESPAN && cachedPlayers.length > 0) {
    return { players: cachedPlayers, logs: cachedLogs, idMap: cachedIds };
  }
  
  try {
    await doc.loadInfo();
    const [pRows, tRows, idRows] = await Promise.all([
      doc.sheetsByTitle['PlayerList'].getRows(),
      doc.sheetsByTitle['Transaction Log'].getRows(),
      doc.sheetsByTitle['Sleeper_Players'].getRows() // Fetches the ID sheet seen in your screenshots
    ]);
    
    cachedPlayers = pRows;
    cachedLogs = tRows;
    cachedIds = idRows;
    lastFetchTime = now;
    
    console.log(`📊 Cache Updated: ${pRows.length} players, ${idRows.length} IDs loaded.`);
    return { players: cachedPlayers, logs: cachedLogs, idMap: cachedIds };
  } catch (err) {
    console.error("❌ Sheet Fetch Error:", err);
    return { players: [], logs: [], idMap: [] };
  }
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
    
    // Initialize Team Map
    await updateTeamMap().catch(err => console.error("Team Map Error:", err));

    // Start the Sleeper Poller immediately
    console.log("💓 Sleeper Poller Started...");
    pollSleeper(); 

    // Then check every 60 seconds
    setInterval(pollSleeper, 60000); 

  } catch (err) { 
    console.error("Startup Error:", err); 
  }
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

    if (interaction.commandName === 'trade') {
      const tA = interaction.options.getString('teama');
      const pA_input = interaction.options.getString('teama_players').split(',').map(p => p.trim().toLowerCase());
      const tB = interaction.options.getString('teamb');
      const pB_input = interaction.options.getString('teamb_players').split(',').map(p => p.trim().toLowerCase());

      const getSideData = async (teamName, playersIn) => {
        const sh = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(teamName.toLowerCase()));
        let cap = 0; 
        if (sh) { 
            await sh.loadCells('F2'); 
            cap = parseFloat((sh.getCellByA1('F2').formattedValue || "0").replace(/[$,]/g, '')) || 0; 
        }
        
        let totalCapSent = 0;
        let playerDetails = [];

        playersIn.forEach(pn => {
          const r = players.find(row => row._rawData[1]?.toLowerCase().includes(pn));
          if (r) {
            const hit = parseFloat((r._rawData[6] || "0").replace(/[$,]/g, ''));
            totalCapSent += hit;
            
            // Find Bonus Info for this specific player
            const tLogRow = logs.find(log => log._rawData[0]?.toLowerCase().includes(r._rawData[1].toLowerCase()));
            let bonusText = "";
            if (tLogRow) {
              const bonus = tLogRow._rawData[4] || ""; 
              const kick = tLogRow._rawData[5] || "";
              if (bonus || kick) bonusText = `\n   ┗ ✨ *${kick ? `Kick:${kick} ` : ""}${bonus.slice(0, 30)}...*`;
            }

            playerDetails.push(`• ${r._rawData[1]}: **$${hit.toLocaleString()}**${bonusText}`);
          } else {
            playerDetails.push(`• ${pn}: *Not Found*`);
          }
        });

        return { title: sh ? sh.title : teamName, cap, totalCapSent, playerDetails };
      };

      const sA = await getSideData(tA, pA_input);
      const sB = await getSideData(tB, pB_input);
      
      const tradeEmbed = new EmbedBuilder()
        .setTitle('🤝 Detailed Trade Analysis')
        .setColor(0xe67e22)
        .addFields(
          { name: `📤 From ${sA.title}`, value: sA.playerDetails.join('\n') || "None", inline: false },
          { name: `📥 From ${sB.title}`, value: sB.playerDetails.join('\n') || "None", inline: false },
          { name: `${sA.title} New Cap`, value: `**$${(sA.cap + sA.totalCapSent - sB.totalCapSent).toLocaleString()}**`, inline: true },
          { name: `${sB.title} New Cap`, value: `**$${(sB.cap + sB.totalCapSent - sA.totalCapSent).toLocaleString()}**`, inline: true }
        );

      return await interaction.editReply({ embeds: [tradeEmbed] });
    }
  } catch (err) {
    console.error(err);
    if (!interaction.replied) await interaction.editReply("⚠️ Bot Error.");
  }
});

// --- SLEEPER TRANSACTION WATCHER ---
client.on('messageCreate', async (message) => {
  // 1. Log every message in the console to verify the bot is "hearing" the channel
  console.log(`Message heard in ${message.channelId}: ${message.content.slice(0, 20)}...`);

  if (message.channelId !== '1477399855541518366') return;
  if (message.author.id === client.user.id) return;

  try {
    const { players, logs } = await getSheetData();
    
    // Check if Sleeper Link mentioned a player name from your sheet
    const foundPlayer = players.find(p => {
      const fullName = p._rawData[1];
      if (!fullName) return false;
      
      // Standard format or "J. Jefferson" format
      const initialFormat = `${fullName.charAt(0)}. ${fullName.split(' ').pop()}`;
      
      return message.content.includes(fullName) || 
             message.embeds[0]?.description?.includes(fullName) ||
             message.embeds[0]?.description?.includes(initialFormat);
    });

    if (foundPlayer) {
      console.log(`✅ Player match found: ${foundPlayer._rawData[1]}. Adding reaction...`);
      await message.react('💰').catch(err => console.error("Failed to react:", err));

      const filter = (reaction, user) => reaction.emoji.name === '💰' && !user.bot;
      const collector = message.createReactionCollector({ filter, time: 60000 });

      collector.on('collect', async (reaction, user) => {
        console.log(`💰 Reaction clicked by ${user.tag}`);
        const embed = createPlayerEmbed(foundPlayer, logs);
        await message.reply({ 
          content: `📊 **Salary Insight for ${foundPlayer._rawData[1]}:**`, 
          embeds: [embed] 
        });
        collector.stop();
      });
    }
  } catch (err) {
    console.error("Watcher Error:", err);
  }
});

// --- CONFIG & CACHE ---
const SLEEPER_LEAGUE_ID = '1312556169230815232';
const CHANNEL_ID = '1477399855541518366';
let processedTxIds = new Set();
let rosterToTeamName = {}; // Cache for mapping Roster ID -> "Team Name"

// 1. Function to map Roster IDs to Team Names from Sleeper
async function updateTeamMap() {
  const usersRes = await fetch(`https://api.sleeper.app/v1/league/${SLEEPER_LEAGUE_ID}/users`);
  const rostersRes = await fetch(`https://api.sleeper.app/v1/league/${SLEEPER_LEAGUE_ID}/rosters`);
  const users = await usersRes.json();
  const rosters = await rostersRes.json();

  rosters.forEach(r => {
    const user = users.find(u => u.user_id === r.owner_id);
    // Use metadata team_name or fallback to display_name
    rosterToTeamName[r.roster_id] = user?.metadata?.team_name || user?.display_name || `Team ${r.roster_id}`;
  });
}

// 2. The Main Poller
async function pollSleeper() {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] 🔍 Checking Sleeper for new transactions...`);

  try {
    const { players, logs, idMap } = await getSheetData();
    const channel = await client.channels.fetch('1477399855541518366');
    
    // FETCH DATA
    const url = `https://api.sleeper.app/v1/league/${SLEEPER_LEAGUE_ID}/transactions/1`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Sleeper API Error: ${response.status}`);
    
    const transactions = await response.json();
    console.log(`[${timestamp}] 📡 Received ${transactions.length} transactions from Sleeper.`);

    // Sort to process oldest first
    transactions.sort((a, b) => a.status_updated - b.status_updated);

    for (const tx of transactions) {
      ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // --- MUTE HISTORY LOGIC ---
  // If the transaction happened BEFORE the bot started, skip it.
  //if (tx.status_updated < BOT_START_TIME) {
      //processedTxIds.add(tx.transaction_id); // Mark as seen so we don't check again
      //continue;
  //}
      // If we've seen this ID, skip it
      if (processedTxIds.has(tx.transaction_id)) continue;

      console.log(`🆕 NEW TRANSACTION FOUND: ${tx.transaction_id} (${tx.type} - ${tx.status})`);

      let title = tx.type === 'trade' ? (tx.status === 'pending' ? "🚨 PENDING TRADE" : "🤝 TRADE PROCESSED") : "📝 TRANSACTION";
      let embedColor = tx.status === 'pending' ? 0xFFA500 : 0x2ecc71;
      
      const embed = new EmbedBuilder().setTitle(title).setColor(embedColor).setTimestamp(new Date(tx.status_updated));

      let teamStats = {}; 

      // Helper to initialize a team's grouping
      const initTeam = (tName) => {
        if (!teamStats[tName]) {
          teamStats[tName] = { actions: [], netCap: 0 };
        }
      };

      // 1. Process Acquisitions (✅ Receives)
      for (const [pId, rId] of Object.entries(tx.adds || {})) {
        const d = getDetails(pId);
        const t = rosterToTeamName[rId];
        initTeam(t);
        teamStats[t].actions.push(`✅ **Gets:** ${d.text.replace('• ', '')}`);
        teamStats[t].netCap -= d.cap; 
      }

      // 2. Process Outgoing (📤 Sends)
      for (const [pId, rId] of Object.entries(tx.drops || {})) {
        const d = getDetails(pId);
        const t = rosterToTeamName[rId];
        initTeam(t);
        teamStats[t].actions.push(`📤 **Sends:** ${d.text.replace('• ', '')}`);
        teamStats[t].netCap += d.cap;
      }

      // 3. Generate Team-Based Embed Fields
      for (const [tName, data] of Object.entries(teamStats)) {
        const sh = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(tName.toLowerCase()));
        let capHeader = "📊 Cap Space Impact";
        
        if (sh) {
          await sh.loadCells('F2');
          const current = parseFloat((sh.getCellByA1('F2').formattedValue || "0").replace(/[$,]/g, '')) || 0;
          const after = current + data.netCap;
          capHeader = `📊 $${current.toLocaleString()} ➔ **$${after.toLocaleString()}**`;
        }

        embed.addFields({ 
          name: `🏟️ ${tName.toUpperCase()}`, 
          value: `${data.actions.join('\n')}\n${capHeader}`, 
          inline: false 
        });
      }

      await channel.send({ embeds: [embed] });
      processedTxIds.add(tx.transaction_id);
      console.log(`✅ Message sent for TX: ${tx.transaction_id}`);
    }
  } catch (err) {
    console.error(`❌ Poller Error at ${timestamp}:`, err.message);
  }
}

client.once('ready', () => { setInterval(pollSleeper, 60000); });

client.login(process.env.DISCORD_TOKEN);
