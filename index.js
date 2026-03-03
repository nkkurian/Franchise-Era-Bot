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
let processedTxIds = new Set();
let isFirstRun = true; // NEW: Controls the one-time historical post

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
    // 1. Register Slash Commands
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`🚀 FRANCHISE PRO BOT ONLINE`);

    // 2. Load Sheets Data FIRST (Crucial for IDs)
    console.log("📥 Pre-loading Sheet Data...");
    await getSheetData(); 

    // 3. Load Sleeper Team Map
    console.log("📥 Loading Sleeper Team Map...");
    await updateTeamMap(); 
    console.log(`✅ Team Map Loaded.`);

    // 4. Send Startup Message
    await sendStartupTestMessage();

    // 5. Start Poller (Now that maps are ready)
    await pollSleeper();          
    setInterval(pollSleeper, 60000); 

  } catch (err) { 
    console.error("Startup Error:", err); 
  }
});

// Cleaned up Test Message Function
async function sendStartupTestMessage() {
  try {
    const channel = await client.channels.fetch('1477399855541518366');
    if (!channel) return console.error("❌ Test failed: Channel not found.");

    const testEmbed = new EmbedBuilder()
      .setTitle("🔄 Bot Rebooted")
      .setDescription("The **Franchise Pro Bot** has successfully restarted and is reconnecting to Google Sheets.")
      .setColor(0x5865F2)
      .setFields({ name: 'Status', value: '🟢 Online & Listening', inline: true })
      .setTimestamp();

    await channel.send({ embeds: [testEmbed] });
    console.log("✅ Startup test message sent to Discord.");
  } catch (err) {
    console.error("❌ Error sending startup message:", err);
  }
}

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

    if (interaction.commandName === 'team') {
      const teamInput = interaction.options.getString('teamname');
      
      // 1. Find the correct sheet for the team
      const sh = doc.sheetsByIndex.find(s => 
        s.title.toLowerCase().trim().includes(teamInput.toLowerCase().trim())
      );

      if (!sh) {
        return await interaction.editReply(`❌ Could not find a sheet for team: **${teamInput}**`);
      }

      // 2. Load Cap Cell (F2) and Player Rows simultaneously
      await sh.loadCells('F2');
      const capValue = sh.getCellByA1('F2').formattedValue || "$0.00";

      // 3. Find top 5 earners for this team from the cached PlayerList
      const teamPlayers = players
        .filter(p => p._rawData[0]?.toLowerCase().trim() === sh.title.toLowerCase().trim())
        .map(p => ({
          name: p._rawData[1],
          hit: parseFloat((p._rawData[6] || "0").replace(/[$,]/g, '')) || 0,
          hitStr: p._rawData[6] || "$0.00"
        }))
        .sort((a, b) => b.hit - a.hit)
        .slice(0, 5);

      const earnerList = teamPlayers.length > 0 
        ? teamPlayers.map((p, i) => `${i+1}. **${p.name}**: ${p.hitStr}`).join('\n')
        : "No players found on roster.";

      const teamEmbed = new EmbedBuilder()
        .setTitle(`🏟️ Team Report: ${sh.title}`)
        .setColor(0x3498db)
        .addFields(
          { name: '💰 Current Cap Space', value: `**${capValue}**`, inline: false },
          { name: '🔝 Top 5 Cap Hits', value: earnerList, inline: false }
        )
        .setFooter({ text: `Data synced from Google Sheets` })
        .setTimestamp();

      return await interaction.editReply({ embeds: [teamEmbed] });
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

// --- CONFIG & CACHE ---
const SLEEPER_LEAGUE_ID = '1334625446184099840';
const CHANNEL_ID = '1477399855541518366';
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
  const idRow = idMap.find(row => row._rawData[0] === pId);
  const name = idRow ? idRow._rawData[1] : `Unknown (${pId})`;
  
  // Try to find the player in the Sheet
  const pData = players.find(p => p._rawData[1] === name);
  
  // FALLBACK: If player isn't in the sheet, don't crash! 
  if (!pData) {
    return { 
      name, 
      cap: 0, 
      isDeadCap: false, 
      text: `• **${name}**: $Unknown (Not in Sheet)` 
    };
  }

  const cap = parseFloat((pData._rawData[6] || "0").replace(/[$,]/g, '')) || 0;
  const years = pData._rawData[3] || "0";
  const isDeadCap = pData._rawData[9] === "TRUE" || pData._rawData[9] === true;
  
  return { 
    name, 
    cap, 
    isDeadCap, 
    text: `• **${name}**: $${cap.toLocaleString()} (${years}yrs)` 
  };
}; 

  // 2. PLAYER DETECTION

// --- DATABASE FOR TRACKING POSTED TRADES ---
// --- TRANSACTION POLLER ---
// --- [REPLACE YOUR pollSleeper AND processAndSend FUNCTIONS WITH THESE] ---

// --- [REPLACE YOUR pollSleeper AND processAndSend FUNCTIONS WITH THESE] ---

async function pollSleeper() {
  console.log(`[${new Date().toLocaleTimeString()}] 🔍 Checking Sleeper for new moves...`);
  try {
    const { players, logs, idMap } = await getSheetData();
    const channel = await client.channels.fetch('1477399855541518366');
    
    // Get current league state to find the correct week
    const stateRes = await fetch(`https://api.sleeper.app/v1/state/nfl`);
    const leagueState = await stateRes.json();
    let week = leagueState.display_week || 1;

    // Fetch transactions for the current week
    let url = `https://api.sleeper.app/v1/league/${SLEEPER_LEAGUE_ID}/transactions/${week}`;
    let response = await fetch(url);
    let transactions = await response.json();

    // Offseason Fallback: If current week is empty, check week 1
    if (!Array.isArray(transactions) || transactions.length === 0) {
      url = `https://api.sleeper.app/v1/league/${SLEEPER_LEAGUE_ID}/transactions/1`;
      response = await fetch(url);
      transactions = await response.json();
    }

    if (!Array.isArray(transactions)) return;

    // Sort by time so we process oldest to newest
    transactions.sort((a, b) => a.status_updated - b.status_updated);

    if (isFirstRun) {
      // 1. Get the 3 most recent valid moves for the historical post
      const initialMoves = transactions.filter(tx => 
        (tx.type === 'trade' && (tx.status === 'complete' || tx.status === 'pending')) ||
        ((tx.type === 'free_agent' || tx.type === 'waiver') && tx.status === 'complete')
      ).slice(-3);

      console.log(`📥 Initializing: Processing the 3 most recent moves...`);
      for (const tx of initialMoves) {
        const txKey = `${tx.transaction_id}_${tx.status}`;
        await processAndSend(tx, channel, players, logs, idMap);
        processedTxIds.add(txKey);
      }
      
      // 2. CRITICAL FIX: Only mark COMPLETED transactions as "seen"
      // We leave 'pending' trades OUT of this list so the next loop finds them and posts them.
      transactions.forEach(tx => {
        if (tx.status === 'complete') {
          processedTxIds.add(`${tx.transaction_id}_${tx.status}`);
        }
      });

      isFirstRun = false;
      console.log("✅ Initialization Complete. Listening for NEW and PENDING moves now.");
    } else {
      // Real-time loop
      for (const tx of transactions) {
        const txKey = `${tx.transaction_id}_${tx.status}`;
        
        // Only process if it's a new ID OR a status change (e.g., Pending -> Complete)
        if (processedTxIds.has(txKey)) continue;

        const isTrade = tx.type === 'trade' && (tx.status === 'complete' || tx.status === 'pending');
        const isFA = (tx.type === 'free_agent' || tx.type === 'waiver') && tx.status === 'complete';

        if (isTrade || isFA) {
          await processAndSend(tx, channel, players, logs, idMap);
          processedTxIds.add(txKey);
          console.log(`📢 New Transaction Posted: ${tx.transaction_id} (${tx.status})`);
        }
      }
    }
  } catch (err) {
    console.error(`❌ Poller Error:`, err.message);
  }
}

async function processAndSend(tx, channel, players, logs, idMap) {
  let title = "📝 TRANSACTION";
  let color = 0x2ecc71; 

  if (tx.type === 'trade') {
    // Distinct visual difference for Pending vs Complete
    title = tx.status === 'pending' ? "🚨 PENDING TRADE OFFER" : "🤝 TRADE COMPLETED";
    color = tx.status === 'pending' ? 0xFFA500 : 0x2ecc71;
  } else {
    title = tx.type === 'free_agent' ? "🏃 FA PICKUP" : "⏳ WAIVER CLAIM";
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setTimestamp(tx.status_updated ? new Date(tx.status_updated) : new Date());

  let teamSummaries = {};
  const initTeam = (rId) => {
    const tName = rosterToTeamName[rId] || `Team ${rId}`;
    if (!teamSummaries[tName]) teamSummaries[tName] = { adds: [], drops: [], net: 0, deadCap: 0 };
    return tName;
  };

  // Process Players Added
  for (const [pId, rId] of Object.entries(tx.adds || {})) {
    const tName = initTeam(rId);
    const d = getDetails(pId, players, logs, idMap);
    teamSummaries[tName].adds.push(d.text);
    teamSummaries[tName].net -= d.cap;
  }

  // Process Players Dropped
  for (const [pId, rId] of Object.entries(tx.drops || {})) {
    const tName = initTeam(rId);
    const d = getDetails(pId, players, logs, idMap);
    teamSummaries[tName].drops.push(d.text);
    teamSummaries[tName].net += d.cap;
    if (d.isDeadCap) teamSummaries[tName].deadCap += d.cap;
  }

  // Process Draft Picks
  if (tx.draft_picks) {
    tx.draft_picks.forEach(pick => {
      const gainer = initTeam(pick.owner_id);
      const loser = initTeam(pick.previous_owner_id);
      const pickName = `${pick.season} Rd ${pick.round} (${rosterToTeamName[pick.roster_id] || 'Orig'})`;
      teamSummaries[gainer].adds.push(`🎫 **${pickName}**`);
      teamSummaries[loser].drops.push(`📤 **${pickName}**`);
    });
  }

  for (const [tName, data] of Object.entries(teamSummaries)) {
    let description = "";
    if (data.adds.length) description += `✅ **In:**\n${data.adds.join('\n')}\n`;
    if (data.drops.length) description += `📤 **Out:**\n${data.drops.join('\n')}\n`;
    if (data.deadCap > 0) description += `💀 **DEAD CAP WARNING:** $${data.deadCap.toLocaleString()}\n`;

    // Fetch the current cap from the specific team sheet
    const sh = doc.sheetsByIndex.find(s => s.title.toLowerCase().trim() === tName.toLowerCase().trim());
    let capFooter = "📊 *Cap data pending sheet sync*";
    if (sh) {
        await sh.loadCells('F2');
        const current = parseFloat((sh.getCellByA1('F2').formattedValue || "0").replace(/[$,]/g, '')) || 0;
        capFooter = `💰 $${current.toLocaleString()} ➔ **$${(current + data.net).toLocaleString()}**`;
    }
    embed.addFields({ name: `🏟️ ${tName.toUpperCase()}`, value: `${description}${capFooter}`, inline: false });
  }

  await channel.send({ embeds: [embed] });
}


client.login(process.env.DISCORD_TOKEN);
