const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    ModalBuilder,
    TextInputBuilder,
    Collection,
    TextInputStyle,
    RoleSelectMenuBuilder,
} = require("discord.js");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const axios = require("axios");
const { runWeeklyAudit } = require("./utils/capCompliance.js");
const cron = require("node-cron");
const routes = require("./routes");
const { processAndSend } = require("./utils/transactionAuditor.js");
const vault = require("./utils/vault.js");
const helpCommand = require("./commands/help.js");
const { handleFreeAgencyHub } = require("./commands/login.js");
const salaryCommand = require('./commands/salary.js');
const appeals = require("./utils/appeals.js");
const setupManager = require("./utils/setupManager.js");
const faEngine = require("./utils/FreeAgency/faEngine.js");
// Added this
const {runScheduledLibrarySync, syncSleeperLibrary,normalizePlayerName} = require("./utils/sleeperLibrary");
const setupRouter = require("./utils/setupRouter");
const { google } = require("googleapis");
const { supabase } = require("./utils/supabaseClient");
const fs = require("node:fs");
const path = require('path');
const port = process.env.PORT || 10000;

// Keep-alive server for Render
const express = require("express");
const app = express();
// This is what UptimeRobot will "see"
app.get("/", (req, res) => {
    console.log(
        `📡 Ping received from UptimeRobot at ${new Date().toLocaleTimeString()}`,
    );
    res.status(200).send("Franchise Pro Bot: Standing By.");
});

// IMPORTANT: Must bind to 0.0.0.0 for Render
app.listen(port, () => {
    console.log(`🚀 Keep-alive server listening on port ${port}`);
});

const rawKey = process.env.GOOGLE_KEY || "";
const formattedKey = rawKey
    .replace(/^["']|["']$/g, '') 
    .replace(/\\n/g, '\n');

const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_EMAIL,
    key: formattedKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // <--- CRITICAL for reading Sleeper messages
        GatewayIntentBits.GuildMessageReactions, // <--- CRITICAL for reactions
    ],
});

client.commands = new Collection();
client.getSheetData = getSheetData;

if (!process.env.DISCORD_TOKEN) {
    console.error("🚨 CRITICAL: DISCORD_TOKEN variable is completely missing or undefined!");
} else {
    console.log(`📡 Token found. Character length: ${process.env.DISCORD_TOKEN.length}`);
}

client.on('error', (err) => console.error("❌ Discord client error:", err.message));
client.on('warn', (msg) => console.warn("⚠️ Discord warning:", msg));
client.on('shardError', (err) => console.error("❌ Discord shard error:", err.message));

console.log("🔌 Attempting to connect to Discord...");
client.login(process.env.DISCORD_TOKEN)
    .then(() => console.log("🔓 Token accepted. Establishing gateway connection..."))
    .catch((err) => console.error("❌ LOGIN FAILED IMMEDIATELY:", err.message));

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    // Set a new item in the Collection with the key as the command name and the value as the exported module
    if ("data" in command && "execute" in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(
            `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
        );
    }
}

app.use(express.json()); // Essential to read the data sent from Google

app.use("/", routes(client, getSheetData)); // for extension and fa reports sent to teams.

const faRouter = require("./routes/fa");
// Store getSheetData on Express app instance so routes can access it
async function getSheetData(guildId) {
    if (!guildId) return { players: [], logs: [], idMap: [], doc: null };

    // 1. Fetch config from Supabase
    const { data: config, error } = await supabase
        .from("league_configs")
        .select("*")
        .eq("guild_id", guildId)
        .single();

    if (error || !config) {
        console.error("❌ Database Lookup Error:", error?.message || "Server not registered.");
        return { players: [], logs: [], idMap: [], doc: null };
    }

    const sheetId = config.sheet_id;
    const now = Date.now();

    // 2. INCREASE CACHE TTL: 5 Minutes (300,000ms) instead of 30 seconds (30,000ms)
    if (leagueCache[sheetId] && now - leagueCache[sheetId].lastFetch < 300000 && leagueCache[sheetId].data?.doc) {
        const ageSeconds = Math.round((now - leagueCache[sheetId].lastFetch) / 1000); // 👈 Define it here!
        console.log(`⚡ [CACHE HIT] Loaded ${leagueCache[sheetId].data.players.length} players from memory (Cache Age: ${ageSeconds}s)`);
        return leagueCache[sheetId].data;
    }

    try {
    console.log(`🌐 [CACHE MISS] Fetching fresh sheet data from Google API...`);
    console.time("⏱️ Total getSheetData");

    let dynamicDoc = docCache.get(sheetId);

    if (!dynamicDoc) {
        console.log(`🔐 Authenticating Google Sheet instance for Sheet ID: ${sheetId}...`);
        let rawKey = process.env.GOOGLE_KEY || "";
        if (rawKey.startsWith('"') && rawKey.endsWith('"')) {
            rawKey = rawKey.slice(1, -1);
        }
        const formattedKey = rawKey.replace(/\\n/g, "\n");

        dynamicDoc = new GoogleSpreadsheet(sheetId);
        await dynamicDoc.useServiceAccountAuth({
            client_email: process.env.GOOGLE_EMAIL,
            private_key: formattedKey,
        });
        
        docCache.set(sheetId, dynamicDoc);
        console.log(`✅ Google Auth initialized and cached for sheet.`);
    }

    console.time("⏱️ 1. loadInfo");
    await dynamicDoc.loadInfo();
    console.timeEnd("⏱️ 1. loadInfo");

    const pTab = config.tab_players || "PlayerList";
    const lTab = config.tab_logs || "Transaction Log";
    const iTab = config.tab_ids || "Sleeper_Players";

    console.log(`📋 Target Tabs -> Players: "${pTab}" | Logs: "${lTab}" | IDs: "${iTab}"`);

    const playerSheet = dynamicDoc.sheetsByTitle[pTab];
    const logSheet = dynamicDoc.sheetsByTitle[lTab];
    const idSheet = dynamicDoc.sheetsByTitle[iTab];

    if (!playerSheet) {
        console.error(`❌ CRITICAL: Players tab ("${pTab}") not found in sheet ${sheetId}`);
        return { players: [], logs: [], idMap: [], doc: null };
    }

    const fetchWithTimeout = (promise, ms = 5000) => 
        Promise.race([
            promise, 
            new Promise((_, reject) => setTimeout(() => reject(new Error("Google Rows Fetch Timeout")), ms))
        ]).catch(err => {
            console.warn(`⚠️ Google fetch skipped: ${err.message}`);
            return [];
        });

    console.time("⏱️ 2. getRows (All Sheets)");
    const [pRows, tRows, idRows] = await Promise.all([
        fetchWithTimeout(playerSheet.getRows()),
        logSheet ? fetchWithTimeout(logSheet.getRows()) : [],
        idSheet ? fetchWithTimeout(idSheet.getRows()) : [],
    ]);
    console.timeEnd("⏱️ 2. getRows (All Sheets)");

    console.log(`📥 Rows Fetched -> Players: ${pRows.length} | Logs: ${tRows.length} | IDs: ${idRows.length}`);

    const dataMapper = require("./utils/dataMapper.js");

    console.time("⏱️ 3. Mapping Players Array");
    const processedPlayers = pRows
        .map((row) => {
            const parsed = dataMapper.parsePlayerRow(row, config?.column_mapping);
            if (!parsed) return null;
            return {
                name: parsed.name,
                team: parsed.team,
                salary: parsed.salary,
                capHit: parsed.capHit,
                years: parsed.years,
                deadCap: parsed.deadCap,
                structure: parsed.structure,
                position: parsed.position,
                sleeperId: parsed.sleeperId
            };
        })
        .filter(Boolean);
    console.timeEnd("⏱️ 3. Mapping Players Array");

    const freshData = {
        players: processedPlayers,
        logs: tRows,
        idMap: idRows,
        doc: dynamicDoc,
    };

    leagueCache[sheetId] = { lastFetch: now, data: freshData };
    console.timeEnd("⏱️ Total getSheetData");
    console.log(`✅ [CACHE LOADED] Freshly cached ${processedPlayers.length} players for sheet ${sheetId}`);

    return freshData;

} catch (err) {
    console.error("❌ Sheet Fetch Error:", err.message);
    if (leagueCache[sheetId]?.data) {
        console.log("⚠️ Returning stale cache fallback");
        return leagueCache[sheetId].data;
    }
    return { players: [], logs: [], idMap: [], doc: null };
}
}

app.set("getSheetData", getSheetData); 
// Mount the router
app.use("/", faRouter);

//Added this
async function getPlayerStats(playerSleeperId, leagueSleeperId) {
    if (!playerSleeperId) return null;

    // Create a hard 2.5s signal to instantly kill hanging socket requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    try {
        const axiosConfig = {
            signal: controller.signal, // Forcefully terminates the TCP socket when aborted
            timeout: 2500,
        };

        // 1. Fetch current NFL season state
        const stateRes = await axios.get("https://api.sleeper.app/v1/state/nfl", axiosConfig);
        const currentYear = parseInt(stateRes.data.season);
        const lastYear = currentYear - 1;

        // 2. Fetch stats for current and last year concurrently
        const promises = [
            axios.get(`https://api.sleeper.app/v1/stats/nfl/regular/${currentYear}`, axiosConfig).catch(() => null),
            axios.get(`https://api.sleeper.app/v1/stats/nfl/regular/${lastYear}`, axiosConfig).catch(() => null),
        ];

        if (leagueSleeperId) {
            promises.push(
                axios.get(`https://api.sleeper.app/v1/league/${leagueSleeperId}`, axiosConfig).catch(() => null)
            );
        }

        const [resCurrent, resLast, resLeague] = await Promise.all(promises);
        clearTimeout(timeoutId); // Clean up timer if requests finish cleanly

        const statsCurrent = resCurrent?.data ? resCurrent.data[playerSleeperId] : null;
        const statsLast = resLast?.data ? resLast.data[playerSleeperId] : null;

        const hasRealData = (s) => {
            if (!s) return false;
            return (
                (s.pts_ppr || 0) > 0 ||
                (s.pts_idp || 0) > 0 ||
                (s.pass_yd || 0) > 0 ||
                (s.tkl || 0) > 0 ||
                (s.idp_tkl || 0) > 0 ||
                (s.idp_tkl_solo || 0) > 0 ||
                (s.sack || 0) > 0 ||
                (s.idp_sack || 0) > 0
            );
        };

        const hasRealDataCurrent = hasRealData(statsCurrent);
        const hasRealDataLast = hasRealData(statsLast);

        const activeStats = hasRealDataCurrent ? statsCurrent : (hasRealDataLast ? statsLast : null);
        const yearUsed = hasRealDataCurrent ? currentYear : lastYear;

        if (!activeStats) return null;

        let customTotal = 0;
        if (resLeague?.data?.scoring_settings) {
            const scoringSettings = resLeague.data.scoring_settings;

            for (const [statName, pointValue] of Object.entries(scoringSettings)) {
                const val = 
                    activeStats[statName] ?? 
                    activeStats[`idp_${statName}`] ?? 
                    (statName === "tkl" ? (activeStats.idp_tkl || activeStats.tkl) : 0) ?? 
                    0;

                if (val) {
                    customTotal += val * pointValue;
                }
            }
        } else {
            customTotal = activeStats.pts_ppr ?? activeStats.pts_std ?? activeStats.pts_half_ppr ?? activeStats.pts_idp ?? 0;
        }

        return {
            ...activeStats,
            leagueScore: parseFloat(customTotal).toFixed(2),
            displayYear: yearUsed,
        };
    } catch (err) {
        console.error("❌ Seamless Stats Error:", err.message);
        return null; // Gracefully fall back so the command finishes immediately
    }
}

// Added this --- NEW: SUPABASE CONFIG FETCHER ---
async function getLeagueConfig(guildId) {
    const { data, error } = await supabase
        .from("league_configs")
        .select("*")
        .eq("guild_id", guildId)
        .single();

    if (error) {
        console.error(
            `Error fetching config for guild ${guildId}:`,
            error.message,
        );
        return null;
    }
    return data;
}

// --- CACHE SYSTEM ---
let cachedPlayers = [];
let cachedLogs = [];
let cachedIds = []; // To store Sleeper ID mappings
let lastFetchTime = 0;
const CACHE_LIFESPAN = 30000;
// This sets the "start time" to 2 hours ago, so the bot backfills recent trades
const BACKFILL_MS = 2 * 60 * 60 * 1000;
const BOT_START_TIME = Date.now() - BACKFILL_MS;
let processedTxIds = new Set();
let isFirstRun = true; // NEW: Controls the one-time historical post

// Added this
let leagueCache = {};

const docCache = new Map();

client.once("ready", async () => {
    console.log(`🚀 FRANCHISE PRO BOT ONLINE: Logged in as ${client.user.tag}`);
    const rest = new REST({ version: "10" }).setToken(
        process.env.DISCORD_TOKEN,
    );

    global.sleeperCache = new Map();
    console.log(`🤖 Logged in as ${client.user.tag}!`);
    // Pass the active client connection into our listening engine loop

    try {
        // 1. Register Slash Commands
        await rest.put(Routes.applicationCommands(client.user.id), {
            body: Array.from(client.commands.values()).map(c => c.data.toJSON())
        });
        console.log("✅ Slash Commands Synced");

        // 2. Delay Startup Tasks to avoid Discord Rate Limits (429 errors)
        setTimeout(async () => {
                    await sendStartupTestMessage();

                    await runScheduledLibrarySync(supabase);


                    if (client.ws.status !== 0) {
                        console.warn(
                            "⚠️ Discord connection cold. Status:",
                            client.ws.status,
                        );
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
        if (!response.ok)
            console.warn("⚠️ Local Heartbeat check returned non-200");
    } catch (err) {
        console.error("⚠️ Heartbeat Failed:", err.message);
    }
}, 120000);


// Cleaned up Test Message Function
async function sendStartupTestMessage() {
    try {
        const channel = await client.channels.fetch("1477399855541518366");
        if (!channel)
            return console.error("❌ Test failed: Channel not found.");

        const testEmbed = new EmbedBuilder()
            .setTitle("🔄 Bot Rebooted")
            .setDescription(
                "The **Franchise Pro Bot** has successfully restarted and is reconnecting to Google Sheets.",
            )
            .setColor(0x5865f2)
            .setFields({
                name: "Status",
                value: "🟢 Online & Listening",
                inline: true,
            })
            .setTimestamp();

        await channel.send({ embeds: [testEmbed] });
        console.log("✅ Startup test message sent to Discord.");
    } catch (err) {
        console.error("❌ Error sending startup message:", err);
    }
}

function createPlayerEmbed(pRow) {
    const data = pRow.rowRef?._rawData || pRow._rawData || [];
    const teamName = data[0] || pRow.team || "Free Agent";
    const playerName = data[1] || pRow.name || "Unknown";
    const deadCapStatus = (data[9] === "TRUE" || data[9] === true || pRow.deadCap) ? "✅ Yes" : "❌ No";
    const structure = data[10] || pRow.structure || "No additional contract notes.";

    return new EmbedBuilder()
        .setTitle(`📊 Player Report: ${playerName} (${teamName})`)
        .setColor(0x00ff00)
        .addFields(
            { name: "💰 Yearly Salary", value: data[4] || pRow.salary || "$0.00", inline: true },
            { name: "🧢 Cap Hit", value: data[6] || pRow.capHit || "$0.00", inline: true },
            { name: "⏳ Years Left", value: data[3] || pRow.years || "0", inline: true },
            { name: "💀 Dead Cap", value: deadCapStatus, inline: true },
            { name: "📜 Contract Structure", value: structure, inline: false }
        );
}

client.on("interactionCreate", async (interaction) => {
    if (interaction.user.bot) return;
    let timeoutId;

    const handleInteraction = async () => {

    let currentConfig = null;
    if (interaction.guild) {
        try {
            const { data } = await supabase
                .from("league_configs")
                .select("*")
                .eq("guild_id", interaction.guild.id)
                .single();
            currentConfig = data;
        } catch (dbErr) {
            console.error("Error fetching config on interaction:", dbErr);
        }
    }

    const getOwnerIdMap = typeof getTeamMap !== "undefined" ? getTeamMap : null;
        const adminRoleId = currentConfig?.admin_role_id;
        const hasRole = adminRoleId && interaction.member?.roles?.cache?.has(adminRoleId);
        const isNativeAdmin = interaction.member?.permissions?.has("Administrator");

        if (
            interaction.customId === "trigger_admin_modal" &&
            !hasRole &&
            !isNativeAdmin
        ) {
            return interaction.reply({
                content: "❌ **Access Denied.** Vault adjustments are restricted to league administrators.",
                flags: [64],
            });
        }
    if (
        interaction.isChannelSelectMenu() &&
        interaction.customId === "setup_channel_select"
    ) {
        const selectedChannelId = interaction.values[0];

        const { error } = await supabase.from("league_configs").upsert(
            {
                guild_id: interaction.guild.id,
                log_channel_id: selectedChannelId,
            },
            { onConflict: "guild_id" },
        );

        if (error) {
            return interaction.reply({
                content: "❌ Failed to save channel.",
                flags: [64],
            });
        }

        return interaction.reply({
            content: `✅ Success! All trades and transactions will now be logged in <#${selectedChannelId}>.`,
            flags: [64],
        });
    }

    if (
        interaction.isChannelSelectMenu() && 
        interaction.customId === "setup_log_channel"
    ) {
        await interaction.deferUpdate();
        const selectedChannelId = interaction.values[0];

        try {
            const { error } = await supabase.from("league_configs").upsert(
                {
                    guild_id: interaction.guild.id,
                    log_channel_id: selectedChannelId,
                },
                { onConflict: "guild_id" },
            );

            if (error) throw error;

            return await setupManager.sendAdminConfigMenu(interaction, supabase);

        } catch (dbError) {
            console.error("🚨 Error updating system log channel target:", dbError);
            return await interaction.followUp({
                content: "❌ Failed to save system log channel configuration changes.",
                flags: [64],
            });
        }
    }

    if (
        interaction.isChannelSelectMenu() &&
        interaction.customId === "setup_appeals_channel"
    ) {
        await interaction.deferUpdate();
        const targetChannelId = interaction.values[0];

        try {
            const { error } = await supabase.from("league_configs").upsert(
                {
                    guild_id: interaction.guild.id,
                    appeals_channel_id: targetChannelId,
                },
                { onConflict: "guild_id" },
            );

            if (error) throw error;

            return await interaction.followUp({
                content: `✅ **Success!** Appeals log alerts will now route to <#${targetChannelId}>.`,
                flags: [64],
            });
        } catch (dbError) {
            console.error("❌ Error updating appeals channel target:", dbError);
            return await interaction.followUp({
                content:
                    "❌ Failed to save appeals channel configuration changes.",
                flags: [64],
            });
        }
    }

    if (
        interaction.isChannelSelectMenu() &&
        interaction.customId === "setup_trade_channel"
    ) {
        await interaction.deferUpdate();
        const targetChannelId = interaction.values[0];

        try {
            const { error } = await supabase.from("league_configs").upsert(
                {
                    guild_id: interaction.guild.id,
                    trade_channel_id: targetChannelId,
                },
                { onConflict: "guild_id" },
            );

            if (error) throw error;

            return await interaction.followUp({
                content: `✅ **Success!** Trade alerts will now be sent to <#${targetChannelId}>.`,
                flags: [64],
            });
        } catch (dbError) {
            console.error(
                "❌ Error updating trade alert channel path:",
                dbError,
            );
            return await interaction.followUp({
                content:
                    "❌ An error occurred while writing the channel configuration to Supabase.",
                flags: [64],
            });
        }
    }

    const isSetupComponent =
        interaction.customId &&
        interaction.customId.startsWith("setup_") &&
        ![
            "setup_sheets_btn",
            "setup_map_cols_btn",
            "setup_sleeper_btn",
            "setup_sync_team_roles",
            "setup_confirm_save_roles",
            "setup_select_admin_role",
            "setup_log_channel",
            "setup_trade_channel", 
            "setup_trade_role", 
            "setup_appeals_votes_btn", 
            "setup_appeals_votes_modal", 
            "setup_appeals_channel",
            "setup_vault_config_btn",   
            "setup_select_audit_ping_role",
            "setup_vault_pass_modal",
        ].includes(interaction.customId) &&
    !interaction.customId.startsWith("setup_sync_team_roles") && 
    !interaction.customId.startsWith("nav_") &&
    !interaction.customId.includes("roles_page_");

if (isSetupComponent) {
    return await setupRouter.handleMenus(interaction, supabase);
}

if (interaction.customId && interaction.customId.startsWith("setup_sync_team_roles")) {
    return await setupManager.syncSleeperTeamRoles(interaction, supabase);
}

if (interaction.customId === "setup_confirm_save_roles") {
    return await setupManager.handleConfirmSaveRoles(interaction, supabase);
}


    if (
        interaction.isRoleSelectMenu() &&
        interaction.customId === "setup_trade_role"
    ) {
        await interaction.deferUpdate();
        const targetRoleId = interaction.values[0];

        try {
            const { error } = await supabase.from("league_configs").upsert(
                {
                    guild_id: interaction.guild.id,
                    trade_role_id: targetRoleId,
                },
                { onConflict: "guild_id" },
            );

            if (error) throw error;

            return await setupManager.sendDiscordConfig(interaction, supabase);
        } catch (dbError) {
            console.error(
                "❌ Error updating trade notification ping role:",
                dbError,
            );
            return await interaction.followUp({
                content: "❌ An error occurred while writing the role configuration to Supabase.",
                flags: [64],
            });
        }
    }

        if (
            interaction.isRoleSelectMenu() && 
            interaction.customId === "setup_select_audit_ping_role"
        ) {
            await interaction.deferUpdate();

                const selectedRoleId = interaction.values[0];

                try {
                    const { error } = await supabase
                        .from("league_configs")
                        .update({ audit_ping_role_id: selectedRoleId })
                        .eq("guild_id", interaction.guild.id);

                    if (error) throw error;

                    console.log(`[SetupRouter] Successfully updated Salary Alert Ping Role to: ${selectedRoleId}`);

                   
                    return await setupManager.sendAdminConfigMenu(interaction, supabase);

                } catch (dbError) {
                    console.error("❌ Error updating audit ping role inside SetupRouter:", dbError);
                    return await interaction.followUp({
                        content: "❌ An error occurred while writing the role configuration to Supabase.",
                        flags: [64],
                    });
                }
            }

    if (
        interaction.isRoleSelectMenu() &&
        interaction.customId === "setup_select_admin_role"
    ) {
        const selectedRoleId = interaction.values[0];

        const { error } = await supabase.from("league_configs").upsert(
            {
                guild_id: interaction.guild.id,
                admin_role_id: selectedRoleId,
            },
            { onConflict: "guild_id" },
        );

        if (error) {
            return interaction.reply({
                content: "❌ Failed to update administrative role restriction.",
                flags: [64],
            });
        }

        return interaction.reply({
            content: `✅ **Success!** Bot setup and Vault adjustments are now restricted to members holding the <@&${selectedRoleId}> role.`,
            flags: [64],
        });
    }

    if (interaction.isModalSubmit()) {
        const { customId } = interaction;

        if (interaction.customId === "setup_vault_pass_modal") {
            try {
                const newPassword = interaction.fields.getTextInputValue("vault_pass_input");

                const { error } = await supabase.from("league_configs").upsert(
                    {
                        guild_id: interaction.guild.id,
                        vault_password: newPassword,
                    },
                    { onConflict: "guild_id" },
                );

                if (error) throw error;

                return await interaction.reply({
                    content: "🔒 **Vault Access Updated:** Administrative override password has been successfully saved to secure storage.",
                    ephemeral: true,
                });
            } catch (err) {
                console.error("❌ Vault configuration save error:", err);
                return await interaction.reply({
                    content: "❌ **Database Error:** Failed to commit encryption profile credentials to Supabase.",
                    ephemeral: true,
                });
            }
        }
        if (customId === "modal_fa_sheet_setup") {
            return await vault.handleFASheetModalSubmission(interaction, supabase);
        }
        if (interaction.customId === "modal_auto_salary_config") {
            return await setupManager.handleAutoSalarySubmit(interaction, supabase);
        }
        if (interaction.customId === "setup_appeals_votes_modal") {
            try {
                const rawInput = interaction.fields.getTextInputValue(
                    "appeals_votes_input",
                );
                const parsedVotes = parseInt(rawInput, 10);

                if (isNaN(parsedVotes) || parsedVotes <= 0) {
                    return await interaction.reply({
                        content:
                            "❌ **Invalid Input:** Please enter a valid positive number.",
                        ephemeral: true,
                    });
                }

                const { error } = await supabase.from("league_configs").upsert(
                    {
                        guild_id: interaction.guild.id,
                        appeal_votes_required: parsedVotes,
                    },
                    { onConflict: "guild_id" },
                );

                if (error) throw error;

                return await interaction.reply({
                    content: `✅ **Success!** Appeals moving forward will now require \`${parsedVotes}\` required checkpoint votes.`,
                    ephemeral: true,
                });
            } catch (err) {
                console.error("❌ Modal Save Error:", err);
                return await interaction.reply({
                    content:
                        "❌ System encountered a database error processing text input parameters.",
                    ephemeral: true,
                });
            }
        }

        if (interaction.customId === "modal_setup_sheets") {
            return await setupManager.handleSheetsSubmit(interaction, supabase);
        }
        if (interaction.customId === "modal_map_players") {
            return await setupManager.handleMappingSubmit(
                interaction,
                supabase,
                "players",
            );
        }
        if (interaction.customId === "modal_map_teams") {
            return await setupManager.handleMappingSubmit(
                interaction,
                supabase,
                "teams",
            );
        }
        if (interaction.customId === "modal_setup_sleeper") {
            return await setupManager.handleSleeperSubmit(
                interaction,
                supabase,
            );
        }
        if (interaction.customId === "vault_player_search_modal")
            return await vault.showActionBranch(interaction);
        if (interaction.customId === "appealModal")
            return await appeals.handleAppealSubmit(interaction, supabase);
        if (interaction.customId === "adminLoginModal")
            return await vault.showAdminPanel(interaction, supabase);
        if (interaction.customId.startsWith("vlt_fin_")) {
                return await vault.handleFinalModalSubmission(interaction, supabase, client, getSheetData);
            }
        if (interaction.customId === "portal_restructure_modal") {
            const loginCmd = client.commands.get("login");
            if (loginCmd && typeof loginCmd.handleRestructureModalSubmit === "function") {
                return await loginCmd.handleRestructureModalSubmit(interaction, supabase, currentConfig, getSheetData);
            }
        }
            if (interaction.customId === "portal_extension_modal") {
                const loginCmd = client.commands.get("login");
                if (loginCmd && typeof loginCmd.handleExtensionModalSubmit === "function") {
                    return await loginCmd.handleExtensionModalSubmit(interaction, supabase, currentConfig, getSheetData);
            }
        }
        if (interaction.customId.startsWith("agent_submit_")) {
            const loginCmd = client.commands.get("login");
            if (loginCmd && typeof loginCmd.handleAgentModalSubmit === "function") {
                return await loginCmd.handleAgentModalSubmit(interaction);
            }
        }
        if (customId.startsWith("gm_submit_")) {
            const loginCmd = client.commands?.get("login") || require("./commands/login.js");

            if (loginCmd && typeof loginCmd.handleGmModalSubmit === "function") {
                return await loginCmd.handleGmModalSubmit(interaction, supabase);
            } else {
                console.error("❌ handleGmModalSubmit is not exported properly in login.js");
                return;
            }
        }
        if (customId === "modal_submit_fa_bid") {
            return await faEngine.handleBidSubmission(interaction, supabase);
        }
    } //End of isModalSubmit
    if (interaction.isButton()) {
        const { customId } = interaction;


        if (customId === "nav_main")
            return await setupManager.sendDashboard(interaction, supabase, true);
        if (customId === "nav_sheets")
            return await setupManager.sendSheetsMenu(interaction, supabase);
        if (customId === "nav_sleeper")
            return await setupManager.sendSleeperMenu(interaction, supabase);
        if (customId === "nav_team")
            return await setupManager.sendRolesDashboard(interaction, supabase);
        if (customId === "nav_discord")
            return await setupManager.sendDiscordConfig(interaction, supabase);
        if (customId === "cfg_sub_admin")
            return await setupManager.sendAdminConfigMenu(
                interaction,
                supabase,
            );
        if (customId === "cfg_sub_trade")
            return await setupManager.sendTradeConfigMenu(
                interaction,
                supabase,
            );
        if (customId === "cfg_sub_appeals")
            return await setupManager.sendAppealsConfigMenu(
                interaction,
                supabase,
            );

        if (customId === "setup_map_cols_btn")
            return await setupManager.sendColumnMappingMenu(
                interaction,
                supabase,
            );
        if (customId === "open_player_map_modal")
            return await setupManager.showPlayerMapModal(interaction, supabase);
        if (customId === "open_team_map_modal")
            return await setupManager.showTeamMapModal(interaction, supabase);
        if (customId === "setup_sheets_btn")
            return await setupManager.showSheetsModal(interaction, supabase);
        if (customId === "setup_sleeper_btn")
            return await setupManager.showSleeperModal(interaction, supabase);
        if (customId === "toggle_audit")
            return await setupManager.toggleAudit(interaction, supabase);
        if (customId === "trigger_admin_modal")
            return await vault.showAdminModal(interaction);
        if (customId === "vault_modify_search")
            return await vault.showPlayerSearch(interaction);
        if (customId === "setup_sync_team_roles")
            return await setupManager.syncSleeperTeamRoles(
                interaction,
                supabase,
            );
        if (interaction.customId === "setup_auto_salary_btn") {
            return await setupCmd.showAutoSalaryModal(interaction, supabase);
        }
        if (interaction.customId === "setup_confirm_save_roles")
            return await setupManager.handleConfirmSaveRoles(
                interaction,
                supabase,
            );

        if (customId === "setup_appeals_votes_btn") {
            const modal = new ModalBuilder()
                .setCustomId("setup_appeals_votes_modal")
                .setTitle("Scale Voting Rules");

            const voteInput = new TextInputBuilder()
                .setCustomId("appeals_votes_input")
                .setLabel("Votes Required")
                .setPlaceholder("e.g. 3, 5, 10")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(voteInput),
            );
            return await interaction.showModal(modal);
        }

        if (customId === "setup_vault_config_btn") {
            const modal = new ModalBuilder()
                .setCustomId("setup_vault_pass_modal")
                .setTitle("Secure Vault Authorization");

            const passwordInput = new TextInputBuilder()
                .setCustomId("vault_pass_input")
                .setLabel("Set Vault Override Password")
                .setPlaceholder("Enter secure passphrase for admin authorizations...")
                .setStyle(TextInputStyle.Short)
                .setMinLength(4)
                .setMaxLength(32)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(passwordInput));
            return await interaction.showModal(modal);
        }

        if (interaction.customId.startsWith("vault_sign_"))
            return await vault.showFinalActionModal(
                interaction,
                "sign",
                interaction.customId.replace("vault_sign_", ""),
            );
        if (interaction.customId.startsWith("vault_ext_"))
            return await vault.showFinalActionModal(
                interaction,
                "extension",
                interaction.customId.replace("vault_ext_", ""),
            );
        if (customId === "vault_fa_config") {
            return await vault.showFAConfig(interaction, supabase);
        }
        if (customId === "toggle_fa_status") {
            return await vault.toggleFAStatus(interaction, supabase);
        }
        if (customId === "open_fa_sheet_modal") {
            return await vault.showFASheetModal(interaction);
        }
        if (interaction.customId.startsWith("second_appeal_"))
            return await appeals.handleAppealButton(interaction, supabase);
        if (interaction.customId === "nav_roles_dashboard") {
            await setupManager.sendRolesDashboard(interaction, supabase);
        }

        if (interaction.customId.startsWith("nav_manual_roles")) {
            await setupManager.sendManualRoleMappingMenu(interaction, supabase);
        }
        if (interaction.customId === "run_manual_audit") {
            await interaction.deferUpdate();
            const vaultUtils = require("./utils/vault.js");
            return await vaultUtils.runManualAudit(interaction, supabase, client, getSheetData);
        }

        if (interaction.customId.startsWith("view_ext_")) {
        const playerName = interaction.customId.replace("view_ext_", "");
            const { logs } = await getSheetData(interaction.guild.id);
            const history = logs.filter((l) => l._rawData[0]?.toLowerCase() === playerName.toLowerCase());

            const isSecret = interaction.message?.flags?.has(64);

            if (history.length === 0) {
                return await interaction.reply({ 
                    content: `❌ No history found for ${playerName}`, 
                    flags: [64] 
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
                    name: "\u200B",
                    value: `📝 **Years:** ${actionType}\n💰 **Salary:** ${salary || "N/A"}\n✨ **Bonus:** ${bonus || "None"}`,
                    inline: false,
                });
            });

            return await interaction.reply({ 
                embeds: [histEmbed],
                flags: isSecret ? [64] : []
            });
        }
        if (customId.startsWith("tx_waiver_") || customId.startsWith("tx_edit_")) {
            const vaultUtils = require("./utils/vault.js");
            return await vaultUtils.handleTransactionButton(interaction, supabase, client, getSheetData);
        }
        if (customId.startsWith("portal_secrets_")) {
            const loginCmd = client.commands.get("login");
            if (loginCmd && typeof loginCmd.handleSecretsButton === "function") {
                return await loginCmd.handleSecretsButton(interaction);
            }
        }
        if (customId.startsWith("portal_restructure_")) {
            const loginCmd = client.commands.get("login");
            if (loginCmd && typeof loginCmd.handleRestructureButton === "function") {
                return await loginCmd.handleRestructureButton(interaction);
            }
        }
        if (customId.startsWith("portal_confirm_restructure_")) {
            const loginCmd = client.commands.get("login");
            if (loginCmd && typeof loginCmd.handleConfirmRestructure === "function") {
                return await loginCmd.handleConfirmRestructure(interaction, supabase, currentConfig, getSheetData);
            }
        }
        if (customId.startsWith("portal_extension_")) {
            const loginCmd = client.commands.get("login");
            if (loginCmd && typeof loginCmd.handleExtensionButton === "function") {
                return await loginCmd.handleExtensionButton(interaction);
            }
        }
        if (customId.startsWith("portal_assign_agent_")) {
            const loginCmd = client.commands.get("login");
            if (loginCmd && typeof loginCmd.handleAgentAssignment === "function") {
                return await loginCmd.handleAgentAssignment(interaction);
            }
        }
        if (
            customId.startsWith("agent_approve_") || 
            customId.startsWith("agent_counter_") || 
            customId.startsWith("agent_message_") || 
            customId.startsWith("agent_reject_")
        ) {
            const loginCmd = client.commands.get("login");
            if (loginCmd && typeof loginCmd.handleAgentAction === "function") {
                return await loginCmd.handleAgentAction(interaction);
            }
        }
        if (interaction.customId.startsWith("gm_")) {
            // Fetch the login command from your client's command collection or require it directly
            const loginCmd = client.commands?.get("login") || require("./commands/login.js");

            if (loginCmd && typeof loginCmd.handleGmAction === "function") {
                return await loginCmd.handleGmAction(interaction);
            } else {
                console.error("❌ handleGmAction is not exported properly in login.js");
                return;
            }
        }
        if (customId.startsWith("portal_fa_")) {
            return await handleFreeAgencyHub(interaction, supabase);
        }
        if (customId.startsWith("portal_secret_btn_")) {
            const loginCmd = client.commands.get("login");
            if (loginCmd && typeof loginCmd.handleSecretButtonClick === "function") {
                return await loginCmd.handleSecretButtonClick(interaction);
            }
        }
        if (customId.startsWith("portal_sim_impact_")) {
            const salaryCmd = client.commands.get("salary");
            if (salaryCmd && typeof salaryCmd.handleSimulateImpact === "function") {
                return await salaryCmd.handleSimulateImpact(interaction, supabase, currentConfig, getSheetData);
            }
        }
        if (customId === "fa_open_bid_modal") {
            return await faEngine.showBidModal(interaction, supabase);
        }

        if (customId === "fa_view_my_bids") {
            return await faEngine.showMyBids(interaction, supabase);
        }
    } // <--- THIS ends the "isButton" check.


    if (interaction.isStringSelectMenu() && interaction.customId === "portal_secret_menu_choice") {
        const loginCmd = client.commands.get("login");
        if (loginCmd && typeof loginCmd.handleSecretMenuChoice === "function") {
            return await loginCmd.handleSecretMenuChoice(interaction);
        }
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "fa_withdraw_select") {
            return await faEngine.handleWithdrawBid(interaction, supabase);
        }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("portal_secret_modal_")) {
        const loginCmd = client.commands.get("login");
        if (loginCmd && typeof loginCmd.handleSecretModalSubmit === "function") {
            return await loginCmd.handleSecretModalSubmit(interaction, supabase, currentConfig, getSheetData, getPlayerStats, getOwnerIdMap);
        }
    }

    // --- SLASH COMMANDS START HERE ---
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "setup") {
            const adminRoleId = currentConfig?.admin_role_id;
            const hasRole =
                adminRoleId && interaction.member.roles.cache.has(adminRoleId);
            const isNativeAdmin =
                interaction.member.permissions.has("Administrator");

            if (!hasRole && !isNativeAdmin) {
                return await interaction.reply({
                    content:
                        "❌ Access Denied. Please contact admin for access.",
                    flags: [64],
                });
            }

            return await setupManager.sendDashboard(interaction, supabase);
        }

        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        console.log(`📡 [INTERACTION] Incoming command: /${interaction.commandName} in Guild: ${interaction.guild?.id}`);

        try {
            await command.execute(
                interaction,
                supabase,
                currentConfig,
                getSheetData,
                getPlayerStats, 
                getOwnerIdMap  
            );
            console.log(`✅ [INTERACTION] Completed /${interaction.commandName}`);
            } catch (cmdErr) {
                console.error(`Error executing /${interaction.commandName}:`, cmdErr);
            
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({
                        content: `❌ **Execution Error:** ${cmdErr.message || "An unexpected error occurred."}`
                    }).catch(() => {});
                }
        }
        } // Closes: if (interaction.isChatInputCommand())
    }; // Closes: const handleInteraction = async () =>

    timeoutId = null;

    try {
        // Run the interaction directly without Promise.race or artificial timeouts
        await handleInteraction();
    } catch (err) {
        console.error("❌ [INTERACTION ERROR]", err.stack || err);
        
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({
                content: "💥 An unexpected error occurred while processing this request."
            }).catch(() => {});
        } else {
            await interaction.reply({
                content: "💥 An unexpected error occurred while processing this request.",
                flags: [64]
            }).catch(() => {});
        }
    }
});


async function pollAllLeagues() {
    console.log(`[${new Date().toLocaleTimeString()}] 🔍 Starting global Sleeper poll...`);

    let nflWeek = 1;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000); // 5s limit
        const stateRes = await fetch("https://api.sleeper.app/v1/state/nfl", { signal: controller.signal });
        clearTimeout(timeout);

        if (stateRes.ok) {
            const nflState = await stateRes.json();
            nflWeek = nflState.season_type === "regular" ? nflState.week : 1;
        }
    } catch (err) {
        console.error("⚠️ Failed to fetch dynamic NFL state:", err.message);
    }

    const { data: configs, error } = await supabase.from("league_configs").select("*");
    if (error || !configs || configs.length === 0) return;

    for (const config of configs) {
        try {
            if (!config.sleeper_id) continue;

            const guild = client.guilds.cache.get(config.guild_id);
            if (!guild) continue;

            console.log(`📡 Fetching data for Sleeper League ${config.sleeper_id} (Week ${nflWeek})...`);

            // Fetch transactions FIRST (Fast Sleeper API call with timeout)
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(
                `https://api.sleeper.app/v1/league/${config.sleeper_id}/transactions/${nflWeek}`,
                { signal: controller.signal }
            );
            clearTimeout(timeout);

            if (!res.ok) continue;

            const allTx = await res.json();
            if (!Array.isArray(allTx) || allTx.length === 0) continue;

            const sortedTx = allTx
                .filter((tx) => tx.status === "complete")
                .sort((a, b) => a.status_updated - b.status_updated);

            if (sortedTx.length === 0) continue;

            // Handle First Run Initialization
            if (isFirstRun) {
                for (const tx of sortedTx) {
                    processedTxIds.add(`${config.sleeper_id}_${tx.transaction_id}`);
                }
                console.log(`🔒 Initialized ${sortedTx.length} existing transactions into cache for league ${config.sleeper_id}`);
                continue; 
            }

            // Check if there are NEW unprocessed transactions BEFORE fetching heavy Sheet data
            const newTxList = sortedTx.filter(tx => !processedTxIds.has(`${config.sleeper_id}_${tx.transaction_id}`));
            if (newTxList.length === 0) continue; // Skip Google Sheets fetch completely!

            // --- HEAVY FETCHES ONLY RUN WHEN A NEW TRANSACTION IS FOUND ---
            console.log(`⚡ New transaction detected! Fetching Sheet Data & Team Map...`);
            const { players, doc } = await getSheetData(config.guild_id);
            const teamMap = await getTeamMap(config.sleeper_id);

            const logChannel = await client.channels.fetch(config.log_channel_id).catch(() => null);
            if (!logChannel) continue;

            for (const tx of newTxList) {
                const txKey = `${config.sleeper_id}_${tx.transaction_id}`;
                console.log(`📤 Sending Transaction ${tx.transaction_id} to #${logChannel.name}...`);

                await processAndSend(tx, logChannel, players, teamMap, config, doc);
                processedTxIds.add(txKey);
            }

        } catch (err) {
            console.error(`❌ Error polling league ${config.sleeper_id}:`, err.message);
        }
    }
    isFirstRun = false;
}


//Added this
async function getTeamMap(sleeperId) {
    if (!sleeperId) {
        console.warn("⚠️ [getTeamMap] Skipped: No Sleeper League ID configured.");
        return {};
    }
    try {
        const [uRes, rRes] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${sleeperId}/users`),
            fetch(`https://api.sleeper.app/v1/league/${sleeperId}/rosters`),
        ]);

        if (!uRes.ok || !rRes.ok) {
            console.warn(`⚠️ [getTeamMap] Failed to fetch users or rosters for league ${sleeperId}`);
            return {};
        }

        const users = await uRes.json();
        const rosters = await rRes.json();

        let map = {};
        if (Array.isArray(rosters) && Array.isArray(users)) {
            rosters.forEach((r) => {
                const user = users.find((u) => u.user_id === r.owner_id);
                map[r.roster_id] =
                    user?.metadata?.team_name ||
                    user?.display_name ||
                    `Team ${r.roster_id}`;
            });
        }
        return map;
    } catch (e) {
        console.error("Team Map Error:", e.message);
        return {};
    }
}

//Added argument

client.on("messageCreate", async (message) => {
    await vault.handleVaultTrigger(message);
});

//cron.schedule('* * * * *', async () => { <- use for testing ONLY
// ==========================================
// WEDNESDAY: Salary Cap Compliance Audit (10:00 AM)
cron.schedule("0 10 * * 3", async () => {
    console.log("⏳ Running Scheduled Wednesday Cap Compliance Audit...");
    try {
        const { data: configs, error } = await supabase
            .from("league_configs")
            .select("*");

        if (error || !configs || configs.length === 0) {
            console.error("❌ Scheduled Audit Error: No registered leagues found in database.");
            return;
        }

        for (const config of configs) {
            if (!config.guild_id) continue;
            if (!client.guilds.cache.has(config.guild_id)) {
                console.log(`⏩ Skipping Guild: ${config.guild_id} (Bot is no longer in this server)`);
                continue;
            }
            console.log(`🤖 Processing automated CAP audit for Guild: ${config.guild_id}`);

            // Pass "cap" as the 5th parameter to tell the function to ONLY check cap math
            await runWeeklyAudit(client, supabase, getSheetData, config.guild_id, config, "all");
        }
    } catch (cronErr) {
        console.error("❌ Cron Exception during Wednesday Weekly Audit:", cronErr);
    }
});

// SUNDAY: Live Lineup / Tanking Audit (12:30 PM)
cron.schedule("30 12 * * 0", async () => {
    console.log("⏳ Running Scheduled Sunday Lineup & Tanking Audit...");
    try {
        const { data: configs, error } = await supabase
            .from("league_configs")
            .select("*");

        if (error || !configs || configs.length === 0) {
            console.error("❌ Scheduled Audit Error: No registered leagues found in database.");
            return;
        }

        for (const config of configs) {
            if (!config.guild_id) continue;
            if (!client.guilds.cache.has(config.guild_id)) {
                console.log(`⏩ Skipping Guild: ${config.guild_id} (Bot is no longer in this server)`);
                continue;
            }
            console.log(`🤖 Processing automated LINEUP audit for Guild: ${config.guild_id}`);

            // Pass "lineups" as the 5th parameter to tell the function to ONLY check lineups
            await runWeeklyAudit(client, supabase, getSheetData, config.guild_id, config, "all");
        }
    } catch (cronErr) {
        console.error("❌ Cron Exception during Sunday Weekly Audit:", cronErr);
    }
});

// 🗓️ Every Tuesday at 4:00 AM (Refreshes the player database after Monday Night Football)
cron.schedule("0 4 * * 2", async () => {
    console.log("⏳ Running Scheduled Weekly Sleeper Database Sync & Cache Reload...");
    try {
        if (!global.sleeperCache) global.sleeperCache = new Map();
        // 1. Fetch fresh player details from Sleeper and upsert to Supabase
        await runScheduledLibrarySync(supabase);
        console.log("✅ Sleeper library data successfully synchronized to Supabase.");

        console.log(`🔄 Weekly Cache Reload Complete! Loaded ${global.sleeperCache.size} active players.`);
    } catch (cronErr) {
        console.error("❌ Error running scheduled Tuesday Sleeper Sync & Cache Reload:", cronErr);
    }
});

if (processedTxIds.size > 1000) {
    processedTxIds.clear(); // Clear old IDs so memory stays low
}

// Catch unhandled promise rejections (The most common silent killer)
process.on("unhandledRejection", (reason, promise) => {
    console.error("⚠️ Unhandled Rejection at:", promise, "reason:", reason);
});

// Catch uncaught exceptions
process.on("uncaughtException", (err) => {
    console.error("🚫 Uncaught Exception:", err);
});
