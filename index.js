const { 
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, 
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
  ComponentType, ModalBuilder, TextInputBuilder, Collection, TextInputStyle 
} = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const axios = require("axios");
const { runWeeklyAudit } = require('./utils/capCompliance.js');
const cron = require('node-cron');
const routes = require('./routes');
const vault = require('./utils/vault.js');
const appeals = require('./utils/appeals.js');

const fs = require('node:fs');
const path = require('node:path');
const port = process.env.PORT || 10000;

// Keep-alive server for Render
const express = require('express');
const app = express();
// This is what UptimeRobot will "see"
app.get('/', (req, res) => {
  console.log(`📡 Ping received from UptimeRobot at ${new Date().toLocaleTimeString()}`);
  res.status(200).send('Franchise Pro Bot: Standing By.');
});

// IMPORTANT: Must bind to 0.0.0.0 for Render
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Keep-alive server listening on port ${port}`);
});

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


client.commands = new Collection();
client.getSheetData = getSheetData;

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
	const filePath = path.join(commandsPath, file);
	const command = require(filePath);
	// Set a new item in the Collection with the key as the command name and the value as the exported module
	if ('data' in command && 'execute' in command) {
		client.commands.set(command.data.name, command);
	} else {
		console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
	}
}

// --- AUTO-RECONNECT LOGIC ---
client.on('shardDisconnect', (event, id) => {
    console.error(`💔 Bot disconnected from Discord (Shard ${id}). Attempting to reconnect...`);
});

client.on('shardResume', (id, replayedEvents) => {
    console.log(`♻️ Bot successfully resumed connection (Shard ${id}).`);
});

// If the bot completely crashes without an error log
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

const doc = new GoogleSpreadsheet('1-G39QNK9o0qbgBp3nKjjXHGuuSH4bx_xqNsR51jABM8', serviceAccountAuth);
const idDoc = new GoogleSpreadsheet("12sQJfIHicd1P50ZDgDUfXT__21OukswPEdrUXj-N-cY", serviceAccountAuth,);


// --- NEW: FREE AGENCY WEBHOOK ENDPOINT ---
app.use(express.json()); // Essential to read the data sent from Google

app.use('/', routes(client, doc)); // for extension and fa reports sent to teams. 

async function getPlayerStats(sleeperId) {
    if (!sleeperId) return null;

    try {
        const leagueId = process.env.SLEEPER_LEAGUE_ID;
        const currentYear = new Date().getFullYear(); // 2026
        const lastYear = currentYear - 1; // 2025

        // 1. Fetch Stats for both years and League Scoring in parallel
        const [res2026, res2025, resLeague] = await Promise.all([
            axios.get(
                `https://api.sleeper.app/v1/stats/nfl/regular/${currentYear}`,
            ),
            axios.get(
                `https://api.sleeper.app/v1/stats/nfl/regular/${lastYear}`,
            ),
            axios.get(`https://api.sleeper.app/v1/league/${leagueId}`),
        ]);

        const stats2026 = res2026.data[sleeperId];
        const stats2025 = res2025.data[sleeperId];
        const scoringSettings = resLeague.data.scoring_settings;

        // 2. Identify which year is "Real" (Check Offense + IDP stats)
        const hasRealData2026 =
            stats2026 &&
            (stats2026.pts_ppr > 0 ||
                stats2026.tkl > 0 ||
                stats2026.pass_yd > 0 ||
                stats2026.sack > 0);

        const activeStats = hasRealData2026 ? stats2026 : stats2025;
        const yearUsed = hasRealData2026 ? currentYear : lastYear;

        if (!activeStats) return null;

        // 3. INTERNAL CALCULATION: Apply your League's Custom Scoring
        let customTotal = 0;
        for (const [statName, pointValue] of Object.entries(scoringSettings)) {
            if (activeStats[statName]) {
                customTotal += activeStats[statName] * pointValue;
            }
        }

        // 4. Return everything as one neat object
        return {
            ...activeStats,
            leagueScore: customTotal.toFixed(2),
            displayYear: yearUsed,
        };
    } catch (err) {
        console.error("❌ Seamless Stats Error:", err.message);
        return null;
    }
}


// --- CACHE SYSTEM ---
let cachedPlayers = [];
let cachedLogs = [];
let cachedIds = []; // Added to store Sleeper ID mappings
let lastFetchTime = 0;
const CACHE_LIFESPAN = 3600000; 
// This sets the "start time" to 2 hours ago, so the bot backfills recent trades
const BACKFILL_MS = 2 * 60 * 60 * 1000; 
const BOT_START_TIME = Date.now() - BACKFILL_MS;
let processedTxIds = new Set();
let isFirstRun = true; // NEW: Controls the one-time historical post

let idLookupMap = new Map();
async function getSheetData() {
  const now = Date.now();
  if (now - lastFetchTime < CACHE_LIFESPAN && cachedPlayers.length > 0) {
    return { players: cachedPlayers, logs: cachedLogs, idMap: cachedIds, idLookup: idLookupMap, doc: doc };
  }
  
 try {
    console.log("🔄 Cache expired or empty. Fetching fresh data from Google...");
    await doc.loadInfo();
    const [pRows, tRows, idRows] = await Promise.all([
      doc.sheetsByTitle['PlayerList'].getRows(),
      doc.sheetsByTitle['Transaction Log'].getRows(),
      doc.sheetsByTitle['Sleeper_Players'].getRows()
    ]);
    
    // CONVERT TO MAP FOR INSTANT SEARCHING
    idLookupMap.clear();
    idRows.forEach(row => {
        // Assuming Column 0 is SleeperID and Column 1 is Name
        idLookupMap.set(row._rawData[0], row._rawData[1]); 
    });

    cachedPlayers = pRows;
    cachedLogs = tRows;
    cachedIds = idRows;
    lastFetchTime = now;
    
    console.log(`📊 Cache Updated: ${pRows.length} players, ${idRows.length} IDs mapped.`);
    return { players: cachedPlayers, logs: cachedLogs, idMap: cachedIds, idLookup: idLookupMap, doc: doc };
  } catch (err) {
    console.error("❌ Sheet Fetch Error:", err);
    return { players: [], logs: [], idMap: [], idLookup: new Map() };
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
    .setName('trade')
    .setDescription('Analyze trade impact')
    .addStringOption(o => o.setName('teama').setDescription('First team').setRequired(true))
    .addStringOption(o => o.setName('teama_players').setDescription('Players from first team').setRequired(true))
    .addStringOption(o => o.setName('teamb').setDescription('Second team').setRequired(true))
    .addStringOption(o => o.setName('teamb_players').setDescription('Players from second team').setRequired(true)),
new SlashCommandBuilder()
    .setName('team')
    .setDescription('Check team cap space')
    .addStringOption(o => o.setName('teamname').setDescription('Enter team name').setRequired(true)),
  new SlashCommandBuilder()
  .setName('top')
  .setDescription('View highest annual salaries in the league')
  .addIntegerOption(o => o.setName('count').setDescription('Number of players to show (e.g., 10)'))
  .addStringOption(o => o.setName('position')
    .setDescription('Select a specific position or "ALL"')
    .addChoices(
      { name: '🌎 All Positions', value: 'ALL' },
      { name: '🏈 Quarterback (QB)', value: 'QB' },
      { name: '🏃 Running Back (RB)', value: 'RB' },
      { name: '👐 Wide Receiver (WR)', value: 'WR' },
      { name: '🛡️ Tight End (TE)', value: 'TE' },
      { name: '🧱 Offensive Line (OL)', value: 'OL' },
      { name: '⚔️ Defensive Line (DL)', value: 'DL' },
      { name: '🏹 Linebacker (LB)', value: 'LB' },
      { name: '🧤 Defensive Back (DB)', value: 'DB' },
      { name: '👟 Kicker/Punter (K/P)', value: 'K/P' }
    )),
  new SlashCommandBuilder()
    .setName('extension')
    .setDescription('Check historical contract extensions for a player')
    .addStringOption(o => o.setName('name').setDescription('Enter player name').setRequired(true)),

	new SlashCommandBuilder()
        .setName("sent-trade")
        .setDescription("Alert a team that you sent them a trade offer")
        .addStringOption((o) =>
            o
                .setName("team")
                .setDescription("The team you sent the trade to")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("notes")
                .setDescription(
                    'Optional: What did you send? (e.g. "Sent for CMC")',
                ),
        ),
    new SlashCommandBuilder()
        .setName("trade-alert")
        .setDescription("Post a trade block or buying alert")
        .addStringOption((o) =>
            o
                .setName("action") // Changed from "message" to "action"
                .setDescription("Are you trading away or looking for players?")
                .setRequired(true)
                .addChoices(
                    {
                        name: "📤 Trade Away (On the Block)",
                        value: "TRADING AWAY",
                    },
                    {
                        name: "📥 Trade For (Looking For)",
                        value: "LOOKING FOR",
                    },
                ),
        ),
	
	new SlashCommandBuilder()
        .setName('appeal')
        .setDescription('Submit an official appeal to the committee'),
	
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`🚀 FRANCHISE PRO BOT ONLINE: Logged in as ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    try {
        // 1. Register Slash Commands
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log("✅ Slash Commands Synced");

        // 2. Delay Startup Tasks to avoid Discord Rate Limits (429 errors)
        setTimeout(async () => {
            await sendStartupTestMessage();
            await initializeData();
			// Inside initializeData()
            
            // Check Discord Connection Status
            if (client.ws.status !== 0) {
                console.warn('⚠️ Discord connection cold. Status:', client.ws.status);
            }
        }, 3000);

    } catch (err) { 
        console.error("Startup Error:", err); 
    }
});

setInterval(async () => {
    try {
        const response = await fetch(`http://127.0.0.1:${port}/`);
        // Only log if it FAILS to keep logs clean
        if (!response.ok) console.warn('⚠️ Local Heartbeat check returned non-200');
    } catch (err) {
        console.error('⚠️ Heartbeat Failed:', err.message);
    }
}, 120000);

async function initializeData() {
    try {
        console.log("📥 Pre-loading Sheet Data...");
        await getSheetData(); 

        console.log("📥 Loading Sleeper Team Map...");
        await updateTeamMap(); 

         console.log("🔍 Starting Sleeper Poller...");
         // await pollSleeper(); // Run once
         // setInterval(pollSleeper, 60000); // Then every minute
    } catch (err) {
        console.error("❌ Background Init Error:", err);
    }
}

//Owners of teams map from Sheets
async function getOwnerIdMap() {

    try {
        // 2. Load the spreadsheet metadata
        await idDoc.loadInfo();

        // 3. Access the specific tab
        const sheet = idDoc.sheetsByTitle["Salary Calculators"];

        if (!sheet) {
            console.error(
                "❌ Error: Could not find tab named 'salary calculators'",
            );
            return [];
        }

        return await sheet.getRows();
    } catch (err) {
        console.error("❌ Error in getOwnerIdMap:", err.message);
        return [];
    }
}

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
function createPlayerEmbed(pRow) {
  const teamName = pRow._rawData[0] || "Free Agent";
  const playerName = pRow._rawData[1];
  const deadCapStatus = pRow._rawData[9] === "TRUE" || pRow._rawData[9] === true ? "✅ Yes" : "❌ No";
  
  // Pull directly from Column K (index 10)
  const structure = pRow._rawData[10] || "No additional contract notes.";

  return new EmbedBuilder()
    .setTitle(`📊 Player Report: ${playerName} (${teamName})`)
    .setColor(0x00ff00)
    .addFields(
      { name: '💰 Yearly Salary', value: pRow._rawData[4] || "$0.00", inline: true },
      { name: '🧢 Cap Hit', value: pRow._rawData[6] || "$0.00", inline: true },
      { name: '⏳ Years Left', value: pRow._rawData[3] || "0", inline: true },
      { name: '💀 Dead Cap', value: deadCapStatus, inline: true },
      { name: '📜 Contract Structure', value: structure, inline: false }
    );
}

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {

	if (interaction.isChatInputCommand()) {
        try {
            await interaction.deferReply();
        } catch (e) {
            console.error("Failed to defer:", e);
            return;
        }

        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        
        try {
            // 2. Now do the heavy lifting
            return await command.execute(interaction, getSheetData, getPlayerStats);
        } catch (error) {
            console.error("❌ Command Execution Error:", error);
            // Use catch on editReply so a dead interaction doesn't crash the whole bot
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply("❌ Error executing command.").catch(() => {});
            }
        }
        return; // Exit the block
    }
  
  if (interaction.isModalSubmit()) {
        if (interaction.customId === 'vault_player_search_modal') return await vault.showActionBranch(interaction);
        if (interaction.customId === 'appealModal') return await appeals.handleAppealSubmit(interaction);
        if (interaction.customId === 'adminLoginModal') return await vault.showAdminPanel(interaction);
	  
if (interaction.customId.startsWith('vlt_fin_')) {
        await interaction.deferReply({ ephemeral: true });
        const [, , action, playerName] = interaction.customId.split('_');
    
    // 1. Get raw inputs from the modal
    const rawSalary = interaction.fields.getTextInputValue('in_sal');
    const rawCapHit = interaction.fields.getTextInputValue('in_cap');
    const yearsInput = interaction.fields.getTextInputValue('in_yrs');
    const structure = interaction.fields.getTextInputValue('in_struct');

    // 2. Perform Calculations (Convert to Millions)
    const salary = Math.round((parseFloat(rawSalary.replace(/[^0-9.]/g, '')) * 1000000)) || 0;
    const capHit = Math.round((parseFloat(rawCapHit.replace(/[^0-9.]/g, '')) * 1000000)) || 0;
    const years = parseInt(yearsInput) || 0;
    const totalValue = salary * years;

    try {
        const { players, doc } = await getSheetData();
        const pRow = players.find(r => r._rawData[1]?.toLowerCase() === playerName.toLowerCase());

        if (!pRow) return await interaction.editReply(`❌ Player **${playerName}** not found.`);

        if (action === 'sign') {
            // Update based on your Sheet Columns: 
            // Index 4 = Yearly Salary, Index 6 = Cap Hit, Index 3 = Years, Index 10 = Structure
            pRow._rawData[3] = years;      // Update Years (Column D)
		    pRow._rawData[4] = salary;     // Update Salary (Column E)
		    
		    // SKIP pRow._rawData[5] !! 
		
		    pRow._rawData[6] = capHit;     // Update Cap Hit (Column G)
		    pRow._rawData[10] = structure; // Update Notes (Column K)
		
		    await pRow.save();
        } 
        
        if (action === 'extension') {
            const logSheet = doc.sheetsByTitle['Transaction Log'];
            await logSheet.addRow({
                'Player': playerName,
                'Type': 'Extension',
                'Salary': salary,
                'Cap Hit': capHit,
                'Bonus/Structure': structure,
                'Date': new Date().toLocaleDateString()
            });
        }

		const logChannel = await client.channels.fetch('1477399855541518366'); 
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle(`📑 Vault Update: ${action.toUpperCase()}`)
                .setColor(action === 'sign' ? 0x2ecc71 : 0x3498db)
                .addFields(
                    { name: '👤 Player', value: playerName, inline: true },
                    { name: '⏳ Duration', value: `${years} Years`, inline: true },
                    { name: '💰 Avg Salary', value: `$${(salary/1000000).toFixed(1)}M`, inline: true },
                    { name: '📉 Cap Hit', value: `$${(capHit/1000000).toFixed(1)}M`, inline: true },
                    { name: '💎 Total Value', value: `$${(totalValue/1000000).toFixed(1)}M`, inline: true },
                    { name: '📝 Notes', value: structure }
                )
                .setTimestamp()
                .setFooter({ text: `Admin: ${interaction.user.tag}` });

            await logChannel.send({ embeds: [logEmbed] });
        }
		

        lastFetchTime = 0; // Force cache refresh
        return await interaction.editReply(`✅ Processed **${action}** for **${playerName}**! Check the sheet.`);
        } catch (err) {
            return await interaction.editReply("❌ Error writing to Sheets.");
        }
    }
    return;
  } 
  
  if (interaction.isButton()) {

	if (interaction.customId === 'vault_modify_search') return await vault.showPlayerSearch(interaction);
    if (interaction.customId.startsWith('vault_sign_')) return await vault.showFinalActionModal(interaction, 'sign', interaction.customId.replace('vault_sign_', ''));
    if (interaction.customId.startsWith('vault_ext_')) return await vault.showFinalActionModal(interaction, 'extension', interaction.customId.replace('vault_ext_', ''));
    if (interaction.customId.startsWith('second_appeal_')) return await appeals.handleAppealButton(interaction);
    if (interaction.customId === 'trigger_admin_modal') return await vault.showAdminModal(interaction);
    if (interaction.customId === 'run_sync') {
      await interaction.deferUpdate(); // Prevents "Interaction Failed" error
  
      try {
        // 1. Pings your Google Apps Script to run the backend sync
        // Replace with your actual Deployed Web App URL
        const GAS_URL = 'https://script.google.com/macros/s/AKfycbx5B3peiWwgfv6KRvrp71z1u2bQiByv8bMCO4XhHjFcsmttCnu3eW70_H2fFmf5Pn24Mw/exec';
        await fetch(GAS_URL);
  
        // 2. Force the Bot to dump the old cache and fetch new data
        lastFetchTime = 0; 
        cachedPlayers = []; 
        const { players } = await getSheetData();
  
        return await interaction.followUp({ 
          content: `✅ **Sync Complete.** Google Apps Script triggered and **${players.length}** players reloaded into bot memory.`, 
          ephemeral: true 
        });
      } catch (err) {
        console.error("Sync Error:", err);
        return await interaction.followUp({ 
          content: "⚠️ Connection to Google Apps Script failed. Check your Web App URL.", 
          ephemeral: true 
        });
      }

		} else if (interaction.customId === 'run_manual_audit') {
        await interaction.deferUpdate(); 
        await interaction.followUp({ content: "⏳ Starting manual audit...", ephemeral: true });

        try {
            // This calls the function from your utils/audit.js file
            await runWeeklyAudit(client, getSheetData);

            return await interaction.followUp({ 
                content: "✅ **Audit Complete.** Results posted to <#1477399855541518366>.", 
                ephemeral: true 
            });
        } catch (err) {
            console.error("Manual Audit Error:", err);
            return await interaction.followUp({ content: "❌ Audit failed.", ephemeral: true });
        }
 
    } else if (interaction.customId.startsWith("view_ext_")) {
            // Fixed 'else if'
            const playerName = interaction.customId.replace("view_ext_", "");
            const { logs } = await getSheetData();
            const history = logs.filter(
                (l) =>
                    l._rawData[0]?.toLowerCase() === playerName.toLowerCase(),
            );

            if (history.length === 0) {
                return await interaction.reply({
                    content: `❌ No history found for ${playerName}`,
                    ephemeral: true,
                });
            }

            const histEmbed = new EmbedBuilder()
                .setTitle(`📜 Extension: ${playerName}`)
                .setColor(0x9b59b6)
                .setTimestamp();

            history.forEach((entry) => {
                const actionType = entry._rawData[2] || "Extension";
                const rawSalary = entry._rawData[3];
                const salary = rawSalary ? `${rawSalary}M` : "N/A";
                const bonus = entry._rawData[4];
                histEmbed.addFields({
                    name: "\u200B", // Invisible title
                    value: `📝 **Years:** ${actionType}\n💰 **Salary:** ${salary || "N/A"}\n✨ **Bonus:** ${bonus || "None"}`,
                    inline: false,
                });
            });

            return await interaction.reply({ embeds: [histEmbed] });
        }
	  
    } // <--- THIS ends the "isButton" check.
});

const SLEEPER_LEAGUE_ID = '1312556169230815232';
let rosterToTeamName = {}; 

async function updateTeamMap() {
  try {
    const [uRes, rRes] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${SLEEPER_LEAGUE_ID}/users`),
      fetch(`https://api.sleeper.app/v1/league/${SLEEPER_LEAGUE_ID}/rosters`)
    ]);
    const users = await uRes.json();
    const rosters = await rRes.json();

    rosters.forEach(r => {
      const user = users.find(u => u.user_id === r.owner_id);
      rosterToTeamName[r.roster_id] = user?.metadata?.team_name || user?.display_name || `Team ${r.roster_id}`;
    });
  } catch (e) { console.error("Team Map Error:", e); }
}

const getDetails = (pId, players, idMap, idLookupMap) => {
  // FAST: Map lookup is instant
  const name = idLookupMap.get(pId) || `Unknown (${pId})`;
  
  // Now find them in the Player Sheet
  const pData = players.find(p => p._rawData[1] === name);
  
  if (!pData) return { name, cap: 0, isDeadCap: false, text: `• **${name}**: $Unknown (Not in Sheet)` };

  const cap = parseFloat((pData._rawData[6] || "0").replace(/[$,]/g, '')) || 0;
  const years = pData._rawData[3] || "0";
  const isDeadCap = pData._rawData[9] === "TRUE" || pData._rawData[9] === true;
  const structure = pData._rawData[10] ? `\n    ┗ 📜 *${pData._rawData[10]}*` : "";
  
  return { name, cap, isDeadCap, text: `• **${name}**: $${cap.toLocaleString()} (${years}yrs)${structure}` };
};


async function pollSleeper() {
  console.log(`[${new Date().toLocaleTimeString()}] 🔍 Checking Sleeper for new moves...`);
  try {
    const { players, idMap } = await getSheetData();
    const channel = await client.channels.fetch('1477399855541518366');
    
    const [res0, res1] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${SLEEPER_LEAGUE_ID}/transactions/0`),
      fetch(`https://api.sleeper.app/v1/league/${SLEEPER_LEAGUE_ID}/transactions/1`)
    ]);

	  if (!res0.ok) throw new Error(`Sleeper API Error: ${res0.status}`);

    const allTx = [...(await res0.json() || []), ...(await res1.json() || [])];
    if (!allTx.length) return;

    allTx.sort((a, b) => a.status_updated - b.status_updated);

    if (isFirstRun) {
      allTx.forEach(tx => processedTxIds.add(`${tx.transaction_id}_${tx.status}`));
      isFirstRun = false;
      console.log("✅ Initialization Complete: Historical moves silenced.");
    } else {
      for (const tx of allTx) {
        const txKey = `${tx.transaction_id}_${tx.status}`;
        if (processedTxIds.has(txKey)) continue;

        if (tx.type === 'trade' || ((tx.type === 'free_agent' || tx.type === 'waiver') && tx.status === 'complete')) {
          await processAndSend(tx, channel, players, idMap);
          processedTxIds.add(txKey);
          console.log(`📢 Posted: ${tx.transaction_id} (${tx.status})`);
        }
      }
    }
  } catch (err) { console.error("Poll Error:", err); }
}

async function processAndSend(tx, channel, players, idMap) {
  let title = tx.type === 'trade' ? (tx.status === 'pending' ? "🚨 PENDING TRADE" : "🤝 TRADE COMPLETED") : "📝 TRANSACTION";
  let color = tx.status === 'pending' ? 0xFFA500 : 0x2ecc71;
  let needsSalaryPing = false;

  const embed = new EmbedBuilder().setTitle(title).setColor(color).setTimestamp();
  let teamSummaries = {};

  const initTeam = (rId) => {
    const tName = rosterToTeamName[rId] || `Team ${rId}`;
    if (!teamSummaries[tName]) teamSummaries[tName] = { adds: [], drops: [], net: 0, deadCap: 0 };
    return tName;
  };

  for (const [pId, rId] of Object.entries(tx.adds || {})) {
    const d = getDetails(pId, players, idMap, idLookupMap);
    const tName = initTeam(rId);
    teamSummaries[tName].adds.push(d.text);
    teamSummaries[tName].net -= d.cap;
    if (d.cap === 0) needsSalaryPing = true;
  }

  for (const [pId, rId] of Object.entries(tx.drops || {})) {
    const d = getDetails(pId, players, idMap);
    const tName = initTeam(rId);
    teamSummaries[tName].drops.push(d.text);
    teamSummaries[tName].net += d.cap;
    if (d.isDeadCap) teamSummaries[tName].deadCap += d.cap;
  }

  for (const [tName, data] of Object.entries(teamSummaries)) {
    let desc = (data.adds.length ? `✅ **In:**\n${data.adds.join('\n')}\n` : "") + (data.drops.length ? `📤 **Out:**\n${data.drops.join('\n')}\n` : "");
    if (needsSalaryPing) desc += `⚠️ **NOTICE:** Missing salary data.\n`;
    embed.addFields({ name: `🏟️ ${tName.toUpperCase()}`, value: desc || "No player movement", inline: false });
  }

  await channel.send({ embeds: [embed] });
  if (needsSalaryPing) await channel.send("⚠️ <@&1479107336617332787> **Missing Salary Alert:** A transaction occurred with $0.00 salary in the sheets.");
}

client.on('messageCreate', async (message) => {
	await vault.handleVaultTrigger(message);
});


// Every Wednesday at 10:00 AM
//cron.schedule('* * * * *', async () => { <- use for testing ONLY
cron.schedule('0 10 * * 3', async () => { // Testing every minute
    runWeeklyAudit(client, getSheetData);
});

if (processedTxIds.size > 1000) {
    processedTxIds.clear(); // Clear old IDs so memory stays low
}

// Catch unhandled promise rejections (The most common silent killer)
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Catch uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('🚫 Uncaught Exception:', err);
});


// // --- ADD THIS DEBUG LISTENER TEMPORARILY ---
// client.on('debug', (info) => {
//     // This will show exactly what the bot is doing (Heartbeats, Handshakes, etc.)
//     if (info.includes('Heartbeat') || info.includes('Latency')) return; // Ignore spam
//     console.log(`📡 [DEBUG]: ${info}`);
// });

// console.log("🔌 Attempting to connect to Discord...");

// client.login(process.env.DISCORD_TOKEN).then(() => {
//     console.log("🔓 Token accepted. Establishing gateway connection...");
// }).catch(err => {
//     console.error("❌ LOGIN FAILED IMMEDIATELY:");
//     console.error(err);
    
//     if (err.message.includes("Used disallowed intents")) {
//         console.error("👉 DISALLOWED INTENTS: Double check the Developer Portal (Message Content, etc) AND your code's Intent list.");
//     }
// });


console.log("🔌 Attempting to connect to Discord...");

client.on('debug', m => {
    if (m.includes('Failed to parse') || m.includes('400')) {
        console.log('📡 NETWORK DEBUG:', m);
    }
});

client.login(process.env.DISCORD_TOKEN)
  .then(() => {
    console.log("🔓 Token accepted. Establishing gateway connection...");
  })
  .catch(err => {
    console.error("❌ LOGIN FAILED IMMEDIATELY:");
    console.error(err);
    
    if (err.message.includes("Used disallowed intents")) {
        console.error("👉 DISALLOWED INTENTS: Check Message Content Intent in Discord Developer Portal.");
    }
  });
