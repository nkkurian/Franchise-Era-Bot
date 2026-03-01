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
// This sets the "start time" to 2 hours ago, so the bot backfills recent trades
const BACKFILL_MS = 2 * 60 * 60 * 1000; 
const BOT_START_TIME = Date.now() - BACKFILL_MS;

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
    
    await updateTeamMap(); // Maps Roster IDs to Team Names
    pollSleeper();         // Runs immediately
    setInterval(pollSleeper, 60000); // Checks every minute
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
            // This is the bottleneck. By using Promise.all below, we run these in parallel.
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

    // 🚀 SPEED BOOST: Fetch both sides simultaneously
    const [sA, sB] = await Promise.all([
        getSideData(tA, pA_input),
        getSideData(tB, pB_input)
    ]);
      
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

const getDetails = (pId, players, logs, idMap) => {
  // 1. DRAFT PICK DETECTION (Matches ID format like '2026_1_5')
  if (isNaN(pId) || pId.includes('_')) {
    const pickName = pId.replace(/_/g, ' ');
    return { 
      name: pickName, 
      cap: 0, 
      text: `• 🎫 **${pickName}** ($0 - Entry Level)` 
    };
  }

  // 2. PLAYER DETECTION
  const idRow = idMap.find(row => row._rawData[0] === pId);
  const name = idRow ? idRow._rawData[1] : `Unknown Player (${pId})`;
  const pData = players.find(p => p._rawData[1] === name);
  
  if (!pData) return { name, cap: 0, text: `• ${name}: *No Contract Found*` };

  const cap = parseFloat((pData._rawData[6] || "0").replace(/[$,]/g, '')) || 0;
  const years = pData._rawData[3] || "?";
  
  // 3. BONUS CHECK
  const tLogRow = logs.find(l => l._rawData[0]?.toLowerCase().includes(name.toLowerCase()));
  const bonus = tLogRow ? `\n   ┗ ✨ *${tLogRow._rawData[5] || ""} ${tLogRow._rawData[4] || ""}*` : "";
  
  return { 
    name, 
    cap, 
    text: `• ${name}: **$${cap.toLocaleString()}** (${years}yrs)${bonus}` 
  };
};

let isFirstRun = true;

// 2. The Main Poller
async function pollSleeper() {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] 🔍 Checking Sleeper...`);

  try {
    const { players, logs, idMap } = await getSheetData();
    const channel = await client.channels.fetch('1477399855541518366');
    
    const url = `https://api.sleeper.app/v1/league/${SLEEPER_LEAGUE_ID}/transactions/1`;
    const response = await fetch(url);
    const transactions = await response.json();

    // NEW: Console Log the last 5 trades found in the API for debugging
    console.log("--- 📋 RECENT API HISTORY (Last 5) ---");
    transactions.slice(0, 5).forEach(t => {
       console.log(`ID: ${t.transaction_id} | Status: ${t.status} | Type: ${t.type} | Date: ${new Date(t.status_updated).toLocaleString()}`);
    });
    console.log("--------------------------------------");

    // Sort to process oldest first
    // Sort to process oldest first
   if (isFirstRun) {
      console.log("🕒 Bot Restarted: Fetching last 3 historical trades for backfill...");
      // Sort newest first to pick the top 3, then we'll process them
      const recentThree = transactions
        .sort((a, b) => b.status_updated - a.status_updated)
        .slice(0, 3);
        
      // Temporarily lower the BOT_START_TIME for these 3 only
      recentThree.forEach(tx => {
          // We manually process these by ensuring they aren't in the skip set
          processedTxIds.delete(tx.transaction_id); 
      });
      isFirstRun = false; 
    }

    // Sort to process oldest first (standard order)
    transactions.sort((a, b) => a.status_updated - b.status_updated);

    for (const tx of transactions) {
      if (processedTxIds.has(tx.transaction_id)) continue;

      // Filter: Only Complete or Pending
      if (tx.status !== 'complete' && tx.status !== 'pending') continue;

      // Skip if older than backfill window (unless it's one of our 'forced' ones from above)
      if (tx.status_updated < BOT_START_TIME && !isFirstRun) {
        processedTxIds.add(tx.transaction_id); 
        continue;
      }

      console.log(`🆕 SENDING TO DISCORD: ${tx.transaction_id} | Status: ${tx.status}`);

  // 3. Log that we are processing a transaction (helps debug if it doesn't show in Discord)
  console.log(`processing TX: ${tx.transaction_id} | Type: ${tx.type} | Status: ${tx.status}`);

      let title = tx.type === 'trade' ? (tx.status === 'pending' ? "🚨 PENDING TRADE" : "🤝 TRADE PROCESSED") : "📝 TRANSACTION";
      const embed = new EmbedBuilder().setTitle(title).setColor(tx.status === 'pending' ? 0xFFA500 : 0x2ecc71).setTimestamp(new Date(tx.status_updated));

      let teamSummaries = {}; // Grouping: { "Team Name": { actions: [], net: 0 } }

      const initTeam = (rId) => {
        const tName = rosterToTeamName[rId];
        if (!teamSummaries[tName]) teamSummaries[tName] = { actions: [], net: 0 };
        return tName;
      };

      // 1. Process Assets Gained
      for (const [pId, rId] of Object.entries(tx.adds || {})) {
        const tName = initTeam(rId);
        const d = getDetails(pId, players, logs, idMap);
        teamSummaries[tName].actions.push(`✅ **Gets:** ${d.text.replace('• ', '')}`);
        teamSummaries[tName].net -= d.cap;
      }

      // 2. Process Assets Lost
      for (const [pId, rId] of Object.entries(tx.drops || {})) {
        const tName = initTeam(rId);
        const d = getDetails(pId, players, logs, idMap);
        teamSummaries[tName].actions.push(`📤 **Sends:** ${d.text.replace('• ', '')}`);
        teamSummaries[tName].net += d.cap;
      }

      // 3. Build Team-Specific Embed Fields
      for (const [tName, data] of Object.entries(teamSummaries)) {
        const sh = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(tName.toLowerCase()));
        let capStr = "📊 Cap Impact Pending";
        
        if (sh) {
          await sh.loadCells('F2');
          const cur = parseFloat((sh.getCellByA1('F2').formattedValue || "0").replace(/[$,]/g, '')) || 0;
          capStr = `📊 $${cur.toLocaleString()} ➔ **$${(cur + data.net).toLocaleString()}**`;
        }

        embed.addFields({ 
          name: `🏟️ ${tName.toUpperCase()}`, 
          value: `${data.actions.join('\n')}\n${capStr}`, 
          inline: false 
        });
      }

      await channel.send({ embeds: [embed] });
      processedTxIds.add(tx.transaction_id);
    }
      
  } catch (err) {
    console.error(`❌ Poller Error:`, err.message);
  }
}
client.login(process.env.DISCORD_TOKEN);
