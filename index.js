const { 
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, 
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
  ComponentType, ModalBuilder, TextInputBuilder, Collection, TextInputStyle 
} = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');
const axios = require("axios");
const { runWeeklyAudit } = require('./utils/capCompliance.js');
const cron = require('node-cron');
const routes = require('./routes');
const vault = require('./utils/vault.js');

const fs = require('node:fs');
const path = require('node:path');

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


client.commands = new Collection();

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

const doc = new GoogleSpreadsheet('1-G39QNK9o0qbgBp3nKjjXHGuuSH4bx_xqNsR51jABM8', serviceAccountAuth);

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
const CACHE_LIFESPAN = 30000; 
// This sets the "start time" to 2 hours ago, so the bot backfills recent trades
const BACKFILL_MS = 2 * 60 * 60 * 1000; 
const BOT_START_TIME = Date.now() - BACKFILL_MS;
let processedTxIds = new Set();
let isFirstRun = true; // NEW: Controls the one-time historical post

// Replace 'YOUR_SHEET_ID' with the long string from your spreadsheet URL

async function getSheetData() {
  const now = Date.now();
  if (now - lastFetchTime < CACHE_LIFESPAN && cachedPlayers.length > 0) {
    return { players: cachedPlayers, logs: cachedLogs, idMap: cachedIds, doc: doc };
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
    return { players: cachedPlayers, logs: cachedLogs, idMap: cachedIds, doc: doc };
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
    .setName('appeal')
    .setDescription('Submit an official appeal to the committee'),
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
  
  if (interaction.isModalSubmit()) {
    
    if (interaction.customId === 'appealModal') {
        const reason = interaction.fields.getTextInputValue('appealReason');
        const appealChannel = await client.channels.fetch('1483467245970657413'); // Replace ID

        // Inside your appealModal handler
              const appealEmbed = new EmbedBuilder()
                .setTitle('⚖️ New Appeal Submitted')
                .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                .setDescription(`**Appeal Reason:**\n${reason}\n\n**Submitted by:** <@${interaction.user.id}>`) 
                .setColor(0xF1C40F)
                .addFields({ name: 'Status', value: '⏳ Waiting for Seconds (0/4)' })
                // ADD THIS LINE: This "hides" the ID in the footer for the bot to check later
                .setFooter({ text: `Submitter ID: ${interaction.user.id}` }) 
                .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('second_appeal_0') // We will track the count in the ID
                .setLabel('Second this Appeal')
                .setStyle(ButtonStyle.Primary)
        );

        await appealChannel.send({ content: '🔔 **New Appeal Alert**', embeds: [appealEmbed], components: [row] });
        return await interaction.reply({ content: '✅ Your appeal has been posted. It needs 4 more people to second it.', ephemeral: true });
    }  
  
    if (interaction.customId === 'adminLoginModal') {
    return await vault.showAdminPanel(interaction);
  }
  } 
  
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('second_appeal_')) {
        const messageEmbed = interaction.message.embeds[0];
        if (!messageEmbed) return;

        const embed = EmbedBuilder.from(messageEmbed);
        
        // 1. Get the current count from the Button's Custom ID instead of the footer
        // This is much more reliable than regex on text
        let count = parseInt(interaction.customId.split('_')[2]) + 1;

        const footerText = embed.data.footer?.text || ""; 
        const submitterId = footerText.replace("Submitter ID: ", "");

        // 2. Prevent self-seconding
        if (interaction.user.id === submitterId) {
            return await interaction.reply({ 
                content: "❌ You cannot second your own appeal!", 
                ephemeral: true 
            });
        }
        
        const userName = interaction.user.displayName;
        let currentDesc = embed.data.description || "";

        // 3. Anti-Spam Check
        if (currentDesc.includes(`• ${userName}`)) {
            return await interaction.reply({ content: "❌ You already seconded this!", ephemeral: true });
        }

        // Update the list of names
        if (!currentDesc.includes("**Seconded by:**")) {
            currentDesc += `\n\n**Seconded by:**\n• ${userName}`;
        } else {
            currentDesc += `\n• ${userName}`;
        }
        embed.setDescription(currentDesc);

        // 4. Check if we hit the goal (4)
        if (count < 4) {
            // Update the Status Field and the Button
            embed.setFields({ name: 'Status', value: `⏳ Waiting for Seconds (${count}/4)` });
            
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`second_appeal_${count}`) // Stores the NEW count for the next click
                    .setLabel(`Second (${count}/4)`)
                    .setStyle(ButtonStyle.Primary)
            );

            return await interaction.update({ embeds: [embed], components: [row] });

        } else {
            // SUCCESS: 4 SECONDS REACHED
            embed.setColor(0x2ECC71).setFields({ name: 'Status', value: '✅ Seconded! Awaiting Committee Poll.' });
            
            await interaction.update({ embeds: [embed], components: [] });
            
            // Send the Log Ping
            try {
                const LOG_CHANNEL_ID = '1477399855541518366';
                const logChannel = await interaction.client.channels.fetch(LOG_CHANNEL_ID);
                const logEmbed = EmbedBuilder.from(embed)
                    .setTitle('📄 Finalized Appeal Report')
                    .setColor(0x3498DB);
            
                await logChannel.send({ 
                    content: `🚨 **NEW APPEAL ACTION REQUIRED** 🚨\n<@&1399502952506458252> - This appeal has been seconded by the community.`,
                    embeds: [logEmbed] 
                });
            } catch (err) {
                console.error("Log Channel Error:", err);
            }

            return await interaction.followUp({ 
                content: `🚨 **APPEAL SECONDED** 🚨\nThe appeal has reached 4 seconds and is now official.` 
            });
        }
    }
}
    if (interaction.customId === 'trigger_admin_modal') {
    	return await vault.showAdminModal(interaction);
    }
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

// --- SLASH COMMANDS START HERE ---
	if (!interaction.isChatInputCommand()) return;

		const command = interaction.client.commands.get(interaction.commandName);

if (command) {
    try {
        // If it's a command from the folder, run it!
        // We pass getSheetData so the command can access the spreadsheet
        await command.execute(interaction, getSheetData,getPlayerStats);
        return; // Stop here so it doesn't try to run the logic below
    } catch (error) {
        console.error(error);
        // Only reply here if the command hasn't replied yet
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Error!', ephemeral: true });
        }
    }
}
	
	if (interaction.commandName === 'appeal') {
	        const modal = new ModalBuilder()
	            .setCustomId('appealModal')
	            .setTitle('Official League Appeal');
	
	        const reasonInput = new TextInputBuilder()
	            .setCustomId('appealReason')
	            .setLabel("What are you appealing and why?")
	            .setStyle(TextInputStyle.Paragraph)
	            .setPlaceholder("e.g., The trade between Team A and Team B was unfairly vetoed...")
	            .setRequired(true);
	
	        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
	        return await interaction.showModal(modal);
	    }
	   
	
	    // Defer for all other commands
	    await interaction.deferReply();
	
	    try {
	        const { players, logs } = await getSheetData();
	
	

    } catch (error) { // This was missing or misplaced
        console.error(error);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: 'There was an error executing this command!' });
        } else {
            await interaction.reply({ content: 'There was an error executing this command!', ephemeral: true });
        }
    }
}); // This finally closes client.on('interactionCreate', ...)

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

const getDetails = (pId, players, idMap) => {
  const idRow = idMap.find(row => row._rawData[0] === pId);
  const name = idRow ? idRow._rawData[1] : `Unknown (${pId})`;
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
    const d = getDetails(pId, players, idMap);
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


client.login(process.env.DISCORD_TOKEN);
