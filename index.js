const { 
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, 
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
  ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle 
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

// --- NEW: FREE AGENCY WEBHOOK ENDPOINT ---
app.use(express.json()); // Essential to read the data sent from Google

app.post('/fa-report', async (req, res) => {
  const { teamName, channelId, ownerPings } = req.body;

  try {
    console.log(`📡 FA Request Received for: ${teamName}`);
    
    await doc.loadInfo();
    const teamSheet = doc.sheetsByTitle[teamName];

    if (!teamSheet) {
      console.error(`❌ Sheet not found for team: ${teamName}`);
      return res.status(404).send("Team sheet not found.");
    }

    // 1. Fetch "Extensions Left" from Cell J2
    await teamSheet.loadCells('J2');
    const extensionsLeft = teamSheet.getCellByA1('J2').value ?? "0";

    // 2. Fetch all rows for player data
    const rows = await teamSheet.getRows();
    
    // 3. Filter for Free Agents (0 years left)
    const faPlayers = rows.filter(row => {
      const years = row._rawData[2]; 
      const name = row._rawData[0];
      return name && years === "0";
    });

    const playerList = faPlayers.length > 0 
      ? faPlayers.map(p => `• **${p._rawData[0]}** (${p._rawData[1]})`).join('\n')
      : "✅ All players are currently under contract for 2026.";

    // 4. Create the Spreadsheet Link Button
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('📂 Open League Spreadsheet')
        .setURL(`https://docs.google.com/spreadsheets/d/1-G39QNK9o0qbgBp3nKjjXHGuuSH4bx_xqNsR51jABM8`)
        .setStyle(ButtonStyle.Link)
    );

    // 5. Send to Discord
    const channel = await client.channels.fetch(channelId);
    if (!channel) throw new Error("Channel not found");

    const faEmbed = new EmbedBuilder()
      .setTitle(`🚨 2026 Expiring Contracts: ${teamName}`)
      .setDescription(playerList)
      .setColor(0xFF0000)
      .addFields(
        { name: '⏳ Extensions Remaining', value: `**${extensionsLeft}**`, inline: true },
        {name: 'Final Date:', value: 'The last date to resign is March 23. Resign before or they will be dropped'}, 
        { name: '🛠️ Errors?', value: `Ping <@&1479107336617332787> to be fixed`, inline: false }
      )
      .setFooter({ text: "Franchise Era Front Office • Official Roster Report" })
      .setTimestamp();

    await channel.send({
      content: `🚨 Attention ${ownerPings}! 🚨\nYour offseason roster report has arrived.`,
      embeds: [faEmbed],
      components: [buttonRow]
    });

    console.log(`✅ FA Report Posted for ${teamName}`);
    res.status(200).send("Report Sent Successfully");

  } catch (err) {
    console.error(err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("⚠️ Bot Error.");
    }
  }
});

// --- EXTENSION ELIGIBILITY ENDPOINT ---
app.post('/extension-report', async (req, res) => {
  const { teamName, channelId, ownerPings } = req.body;

  try {
    await doc.loadInfo();
    const teamSheet = doc.sheetsByTitle[teamName];
    if (!teamSheet) return res.status(404).send("Team not found");

    // 1. Get Extensions Left from J2
    await teamSheet.loadCells('J2');
    const extensionsLeft = teamSheet.getCellByA1('J2').value ?? "0";

    // 2. Fetch Roster
    const rows = await teamSheet.getRows();
    
    // 3. Filter: Years is 1 or 2 AND IsExtended (Col K / index 10) is not TRUE
    const eligible = rows.filter(row => {
      const name = row._rawData[0];
      const years = parseInt(row._rawData[2]);
      const isExtended = row._rawData[10]; // Column K
      
      return name && (years === 1 || years === 2) && isExtended !== "TRUE" && isExtended !== true;
    });

    const eligibleList = eligible.length > 0 
      ? eligible.map(p => `• **${p._rawData[0]}** (${p._rawData[1]}) | ${p._rawData[2]}yr left`).join('\n')
      : "✅ No players currently eligible for extension.";

    const channel = await client.channels.fetch(channelId);
    
    const extEmbed = new EmbedBuilder()
      .setTitle(`🏆 Extension Eligibility: ${teamName}`)
      .setDescription(eligibleList)
      .setColor(0x9b59b6) // Purple for "Elite/Extension" status
      .addFields({ name: '⭐ Extensions Remaining', value: `**${extensionsLeft}**`, inline: false })
      .setFooter({ text: "Questions? Ping @cap-goat • Role ID: 1479107336617332787" })
      .setTimestamp();

    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('📂 Open Roster')
        .setURL(`https://docs.google.com/spreadsheets/d/1-G39QNK9o0qbgBp3nKjjXHGuuSH4bx_xqNsR51jABM8`)
        .setStyle(ButtonStyle.Link)
    );

    await channel.send({
      content: `⭐️ Attention ${ownerPings}! ⭐️\nHere are your eligible extension candidates for the 2026 offseason.`,
      embeds: [extEmbed],
      components: [buttonRow]
    });

    res.status(200).send("Extension Report Sent");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
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
    // 1. HANDLE BUTTON CLICKS (History & Selection)
  if (!interaction.guild) {
        return await interaction.reply({ 
            content: "❌ My commands only work inside the league server.", 
            ephemeral: true 
        }).catch(() => null); // catch in case DM replies are totally disabled
    }
  
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'adminLoginModal') {
      const password = interaction.fields.getTextInputValue('adminPassword');
  
      // CHANGE THIS to whatever password you want
      if (password === 'LeagueAdmin2026') {
        
        const adminEmbed = new EmbedBuilder()
          .setTitle('🛠️ Admin Command Center')
          .setDescription('Authentication successful. Select an admin action below.')
          .setColor(0xe74c3c);
  
        // Example Admin Buttons
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('run_sync')
            .setLabel('Force Roster Sync')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('clear_ghosts')
            .setLabel('Clear All Ghosts')
            .setStyle(ButtonStyle.Secondary)
        );
  
        return await interaction.reply({ 
          embeds: [adminEmbed], 
          components: [row], 
          ephemeral: true // Only YOU can see this menu
        });

    } else {
      return await interaction.reply({ 
        content: '❌ Incorrect password. Access denied.', 
        ephemeral: true 
      });
    }
  }
}  
  if (interaction.isButton()) {
        // Handle the History Button
    if (interaction.customId === 'trigger_admin_modal') {
        const modal = new ModalBuilder()
            .setCustomId('adminLoginModal')
            .setTitle('Commissioner Authentication');

        const passwordInput = new TextInputBuilder()
            .setCustomId('adminPassword')
            .setLabel("Enter Admin Password")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(passwordInput));
        return await interaction.showModal(modal);
    }
    if (interaction.customId.startsWith('view_ext_')) {
            const playerName = interaction.customId.replace('view_ext_', '');
            const { logs } = await getSheetData();
            const history = logs.filter(l => l._rawData[0]?.toLowerCase() === playerName.toLowerCase());

            if (history.length === 0) {
                return await interaction.reply({ content: `❌ No history found for ${playerName}`, ephemeral: true });
            }

            const histEmbed = new EmbedBuilder()
                .setTitle(`📜 History: ${playerName}`)
                .setColor(0x9b59b6)
                .setTimestamp();

            history.forEach((entry) => {
                const years = entry._rawData[2];  // Column C
                const salary = entry._rawData[3]; // Column D
                const bonus = entry._rawData[4];  // Column E

                histEmbed.addFields({
                    name: `📅 Contract Year: ${years ? years + ' yrs' : 'N/A'}`,
                    value: `💰 **Salary:** ${salary ? salary + 'M' : 'N/A'}\n✨ **Bonus:** ${bonus || 'None listed'}`,
                    inline: false
                });
            });

            // This is now PUBLIC (No ephemeral tag)
            return await interaction.reply({ embeds: [histEmbed] });
        }
        // Selection buttons (from multiple search results) are handled by the collector in the /salary logic below
        return; 
    }

    if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName === 'admin') {
        const modal = new ModalBuilder()
            .setCustomId('adminLoginModal')
            .setTitle('Admin Access');

        const passwordInput = new TextInputBuilder()
            .setCustomId('adminPassword')
            .setLabel("Enter Admin Password")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(passwordInput);
        modal.addComponents(firstActionRow);

        return await interaction.showModal(modal);
    }

    // Defer for all other commands
    await interaction.deferReply();

    try {
        const { players, logs } = await getSheetData();

        if (interaction.commandName === 'help') {
            const helpEmbed = new EmbedBuilder()
                .setTitle('📚 Franchise Pro Bot: Command Guide')
                .setColor(0x00AAFF)
                .setDescription('Manage league salaries and contracts.')
                .addFields(
                    { name: '🤝 `/trade`', value: 'Analyze trade cap impact.' },
                    { name: '💰 `/salary`', value: 'Check player contract & history.' },
                    { name: '🔄 `/extension`', value: 'View historical log data.' },
                    { name: '📊 `/team`', value: 'View team cap and top earners.' },
                    { name: '🏆 `/top`', value: 'View highest salaries in the league.' }
                )
                .setFooter({ text: `Tracking ${players.length} players and ${logs.length} transactions.` })
                .setTimestamp();

            return await interaction.editReply({ embeds: [helpEmbed] });
        }
    if (interaction.commandName === 'help') {
      const { players, logs } = await getSheetData();
      
      const helpEmbed = new EmbedBuilder()
        .setTitle('📚 Franchise Pro Bot: Command Guide')
        .setColor(0x00AAFF)
        .setDescription('Manage and view league salaries, trades, and contracts.')
        .addFields(
          { 
            name: '🤝 `/trade` [Team A] [Players A] [Team B] [Players B]', 
            value: 'Analyze the cap impact of a trade. Calculates new cap totals for both teams based on players moved.' 
          },
          { 
            name: '💰 `/salary [player]`', 
            value: 'Search for a player\'s current contract. If they have a history in the logs, a **View History** button will appear.' 
          },
          { 
            name: '🔄 `/extension [name]`', 
            value: 'Search the Transaction Log for a player\'s historical salary changes, extensions, and bonus structures.' 
          },
          { 
            name: '📊 `/team [teamname] [count] [position]`', 
            value: 'View a team\'s cap space and top earners. You can now filter by position or increase the list size.' 
          },
          { 
            name: '🏆 `/top [count] [position]`', 
            value: 'View the highest annual salaries across the entire league with a position dropdown menu.' 
          }
        )
        .setFooter({ text: `Tracking ${players.length} players and ${logs.length} transactions.` }) //
        .setTimestamp();

      return await interaction.editReply({ embeds: [helpEmbed] });
    }

    if (interaction.commandName === 'extension') {
      const inputName = interaction.options.getString('name').toLowerCase();
      const { logs } = await getSheetData();

      // Filter logs where Column A matches the name
      const extensionHistory = logs.filter(row => 
        row._rawData[0]?.toLowerCase().includes(inputName)
      );

      if (extensionHistory.length === 0) {
        return await interaction.editReply(`❌ No records found for **${inputName}** in the Transaction Log.`);
      }

      const extensionEmbed = new EmbedBuilder()
        .setTitle(`📝 History: ${extensionHistory[0]._rawData[0]}`)
        .setColor(0x9b59b6)
        .setTimestamp();

      extensionHistory.forEach((entry) => {
        const salary = entry._rawData[3]; // Column D
        const bonus = entry._rawData[4];  // Column E
        
        // Strictly only listing Salary and Bonus
        if (salary || bonus) {
          extensionEmbed.addFields({
            name: `💰 Annual Salary: ${salary ? salary + 'M' : 'N/A'}`,
            value: `✨ **Bonus:** ${bonus || 'None listed'}`,
            inline: false
          });
        }
      });

      return await interaction.editReply({ embeds: [extensionEmbed] });
    }
    
    if (interaction.commandName === 'top') {
  const count = interaction.options.getInteger('count') || 10; 
  const posFilter = interaction.options.getString('position') || 'ALL';

  let filteredPlayers = players.filter(p => p._rawData[1]); 
  
  if (posFilter !== 'ALL') {
    filteredPlayers = filteredPlayers.filter(p => {
      const playerPos = p._rawData[2]?.toUpperCase();
      
      // Handle Defensive Line grouping
      if (posFilter === 'DL') {
        return ['DL', 'DE', 'DT'].includes(playerPos);
      }
      
      // Handle Defensive Back grouping
      if (posFilter === 'DB') {
        return ['DB', 'CB', 'S'].includes(playerPos);
      }
      
      // Standard exact match for QB, RB, WR, TE, LB, K
      return playerPos === posFilter;
    });
  }

  const leaderboard = filteredPlayers
    .map(p => {
      const salaryStr = p._rawData[4] || "$0.00";
      let salaryNum = parseFloat(salaryStr.replace(/[$,]/g, '')) || 0;
      if (salaryStr.toLowerCase().includes('m') && salaryNum < 1000) {
        salaryNum *= 1000000;
      }

      return {
        team: p._rawData[0] || "FA",
        name: p._rawData[1],
        pos: p._rawData[2],
        salaryNum: salaryNum,
        salaryStr: salaryStr
      };
    })
    .sort((a, b) => b.salaryNum - a.salaryNum)
    .slice(0, count);

  if (leaderboard.length === 0) {
    return await interaction.editReply(`❌ No players found for: **${posFilter}**.`);
  }

  const listText = leaderboard.map((p, i) => 
    `${i + 1}. **${p.name}** (${p.pos}) - ${p.team}: **${p.salaryStr}**`
  ).join('\n');

  // Dynamic Title logic for the embed
  let displayPos = posFilter;
  if (posFilter === 'DL') displayPos = 'DL/DE/DT';
  if (posFilter === 'DB') displayPos = 'DB/CB/S';
  if (posFilter === 'ALL') displayPos = 'Overall';

  const topEmbed = new EmbedBuilder()
    .setTitle(`💰 League Top ${leaderboard.length} ${displayPos} Salaries`)
    .setColor(0x2ecc71)
    .setDescription(listText)
    .setTimestamp();

  return await interaction.editReply({ embeds: [topEmbed] });
}
    
    if (interaction.commandName === 'salary') {
      const input = interaction.options.getString('player').toLowerCase();
      const matches = players.filter(r => r._rawData[1]?.toLowerCase().includes(input));

      if (matches.length === 0) return await interaction.editReply(`❌ Player **${input}** not found.`);

      const sendSalaryResponse = async (targetInteraction, playerRow, isUpdate = false) => {
        const pName = playerRow._rawData[1];
        const embed = createPlayerEmbed(playerRow);
        const components = [];

        const hasHistory = logs.some(l => l._rawData[0]?.toLowerCase() === pName.toLowerCase());

        if (hasHistory) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`view_ext_${pName}`)
              .setLabel('View Extension History')
              .setStyle(ButtonStyle.Secondary)
          );
          components.push(row);
        }

        const payload = { content: null, embeds: [embed], components: components };
        return isUpdate ? await targetInteraction.update(payload) : await targetInteraction.editReply(payload);
      };

      if (matches.length === 1) {
        return await sendSalaryResponse(interaction, matches[0]);
      }

      const limitedMatches = matches.slice(0, 5);
      const selectionRow = new ActionRowBuilder().addComponents(
        limitedMatches.map((m, index) =>
          new ButtonBuilder()
            .setCustomId(`select_player_${index}`)
            .setLabel(m._rawData[1])
            .setStyle(ButtonStyle.Primary)
        )
      );

      const response = await interaction.editReply({
        content: `Multiple players found. Please select one:`,
        components: [selectionRow]
      });

      const collector = response.createMessageComponentCollector({ 
        componentType: ComponentType.Button, 
        time: 60000 
      });

      collector.on('collect', async (i) => {
        if (i.customId.startsWith('select_player_')) {
          const index = parseInt(i.customId.split('_')[2]);
          const selectedPlayer = limitedMatches[index];
          await sendSalaryResponse(i, selectedPlayer, true);
          collector.stop();
        }
      });
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
                let structureText = r._rawData[10] ? `\n    ┗ 📜 *${r._rawData[10].slice(0, 50)}...*` : "";
                playerDetails.push(`• ${r._rawData[1]}: **$${hit.toLocaleString()}**${structureText}`);
            } else {
                playerDetails.push(`• ${pn}: *Not Found*`);
            }
        });
        return { title: sh ? sh.title : teamName, cap, totalCapSent, playerDetails };
      };

      const [sA, sB] = await Promise.all([getSideData(tA, pA_input), getSideData(tB, pB_input)]);
      
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
    // 1. Only respond to your secret phrase
    if (message.content.toLowerCase() === '!vault' && !message.author.bot) {
        
        // 2. Delete your message immediately so others don't see the command
        await message.delete().catch(() => null); 

        // 3. Send a "Ghost Button" that only the person who typed !vault can see
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('trigger_admin_modal')
                .setLabel('🔓 Open Admin Vault')
                .setStyle(ButtonStyle.Danger)
        );

        // This message is ephemeral (invisible to others)
        return await message.channel.send({ 
            content: "🔒 **Secure Access Point Detected.** Click below to authenticate.", 
            components: [row],
            ephemeral: true 
        });
    }
});

client.login(process.env.DISCORD_TOKEN);
