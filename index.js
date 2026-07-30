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
const { runScheduledLibrarySync } = require('./utils/sleeperLibrary.js');
// Added this
const {
    syncSleeperLibrary,
    normalizePlayerName,
} = require("./utils/sleeperLibrary");
const setupRouter = require("./utils/setupRouter");
const { google } = require("googleapis");
const { supabase } = require("./utils/supabaseClient");
const fs = require("node:fs");
const path = require("node:path");
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

const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_EMAIL,
    key: process.env.GOOGLE_KEY.replace(/\\n/g, "\n"),
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

//Added this
async function getPlayerStats(playerSleeperId, leagueSleeperId) {
    // If leagueSleeperId is missing, we use a default or skip custom scoring
    if (!playerSleeperId) return null;

    try {
        const currentYear = 2026;
        const lastYear = 2025;

        // 1. Fetch Stats for both years
        // Note: resLeague will only work if we have a leagueSleeperId
        const promises = [
            axios.get(
                `https://api.sleeper.app/v1/stats/nfl/regular/${currentYear}`,
            ),
            axios.get(
                `https://api.sleeper.app/v1/stats/nfl/regular/${lastYear}`,
            ),
        ];

        if (leagueSleeperId) {
            promises.push(
                axios.get(
                    `https://api.sleeper.app/v1/league/${leagueSleeperId}`,
                ),
            );
        }

        const [res2026, res2025, resLeague] = await Promise.all(promises);

        // FIX: Match the argument name 'playerSleeperId'
        const stats2026 = res2026.data[playerSleeperId];
        const stats2025 = res2025.data[playerSleeperId];

        // 2. Identify which year is "Real"
        const hasRealData2026 =
            stats2026 &&
            (stats2026.pts_ppr > 0 ||
                stats2026.tkl > 0 ||
                stats2026.pass_yd > 0 ||
                stats2026.sack > 0);

        const activeStats = hasRealData2026 ? stats2026 : stats2025;
        const yearUsed = hasRealData2026 ? currentYear : lastYear;

        if (!activeStats) return null;

        // 3. INTERNAL CALCULATION: Apply Custom Scoring if league info exists
        let customTotal = 0;
        if (resLeague && resLeague.data.scoring_settings) {
            const scoringSettings = resLeague.data.scoring_settings;
            for (const [statName, pointValue] of Object.entries(
                scoringSettings,
            )) {
                if (activeStats[statName]) {
                    customTotal += activeStats[statName] * pointValue;
                }
            }
        } else {
            // Fallback to standard PPR if no league settings available
            customTotal = activeStats.pts_ppr || 0;
        }

        // 4. Return the object
        return {
            ...activeStats,
            leagueScore: parseFloat(customTotal).toFixed(2),
            displayYear: yearUsed,
        };
    } catch (err) {
        console.error("❌ Seamless Stats Error:", err.message);
        return null;
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
async function getSheetData(guildId) {
    if (!guildId) return { players: [], logs: [], idMap: [], doc: null };

    // 1. Get the league's specific configuration from Supabase
    const { data: config, error } = await supabase
        .from("league_configs")
        .select("*")
        .eq("guild_id", guildId)
        .single();

    // Safety check: if server isn't registered
    if (error || !config) {
        console.error(
            "❌ Database Lookup Error:",
            error?.message || "Server not registered.",
        );
        return { players: [], logs: [], idMap: [], doc: null };
    }

    const sheetId = config.sheet_id;
    const now = Date.now();

    // 2. Check Cache First (Optional but recommended)
    if (leagueCache[sheetId] && now - leagueCache[sheetId].lastFetch < 30000 && leagueCache[sheetId].data?.doc) {
        return leagueCache[sheetId].data;
    }

    try {
        // 3. Use Service Account Auth ONLY
        const dynamicDoc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await dynamicDoc.loadInfo();

        const pTab = config.tab_players || "PlayerList";
        const lTab = config.tab_logs || "Transaction Log";
        const iTab = config.tab_ids || "Sleeper_Players";

        const playerSheet = dynamicDoc.sheetsByTitle[pTab];
        const logSheet = dynamicDoc.sheetsByTitle[lTab];
        const idSheet = dynamicDoc.sheetsByTitle[iTab];

        // 4. Critical Tab Check
        if (!playerSheet) {
            console.error(
                `❌ CRITICAL: Players tab ("${pTab}") not found in sheet ${sheetId}`,
            );
            return { players: [], logs: [], idMap: [], doc: null };
        }

        // 5. Fetch Rows (Using empty array fallback if optional tabs are missing)
        const [pRows, tRows, idRows] = await Promise.all([
            playerSheet.getRows(),
            logSheet ? logSheet.getRows() : [],
            idSheet ? idSheet.getRows() : [],
        ]);

        const dataMapper = require("./utils/dataMapper.js");

        const processedPlayers = pRows
            .map((row) => {
                const parsed = dataMapper.parsePlayerRow(
                    row,
                    config?.column_mapping,
                );
                if (!parsed) return null;

                // Attach the raw Google Sheet row reference so commands can write edits back to cells
                return {
                    ...parsed,
                    rowRef: row,
                };
            })
            .filter(Boolean); // Filters out any corrupted rows

        const freshData = {
            players: processedPlayers,
            logs: tRows,
            idMap: idRows,
            doc: dynamicDoc,
        };

        // 6. Save to cache
        leagueCache[sheetId] = { lastFetch: now, data: freshData };
        return freshData;
    } catch (err) {
        console.error("❌ Sheet Fetch Error:", err.message);
        return { players: [], logs: [], idMap: [], doc: null };
    }
}


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

// --- HELPER: CREATE PLAYER EMBED ---
function createPlayerEmbed(pRow) {
    const teamName = pRow._rawData[0] || "Free Agent";
    const playerName = pRow._rawData[1];
    const deadCapStatus =
        pRow._rawData[9] === "TRUE" || pRow._rawData[9] === true
            ? "✅ Yes"
            : "❌ No";

    // Pull directly from Column K (index 10)
    const structure = pRow._rawData[10] || "No additional contract notes.";

    return new EmbedBuilder()
        .setTitle(`📊 Player Report: ${playerName} (${teamName})`)
        .setColor(0x00ff00)
        .addFields(
            {
                name: "💰 Yearly Salary",
                value: pRow._rawData[4] || "$0.00",
                inline: true,
            },
            {
                name: "🧢 Cap Hit",
                value: pRow._rawData[6] || "$0.00",
                inline: true,
            },
            {
                name: "⏳ Years Left",
                value: pRow._rawData[3] || "0",
                inline: true,
            },
            { name: "💀 Dead Cap", value: deadCapStatus, inline: true },
            { name: "📜 Contract Structure", value: structure, inline: false },
        );
}

// --- INTERACTION HANDLER ---
client.on("interactionCreate", async (interaction) => {
    if (interaction.user.bot) return;

    // If it's a chat slash command, we check for "!vault" context or equivalent setups
    if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "vault"
    ) {
        // Your specific config gateway can go here if needed!
    }

    // 🆕 UPDATED CONFIGURATION CHECK (Safe for Interaction Contexts):
    currentConfig = null;
    try {
        const { data } = await supabase
            .from("league_configs")
            .select("*")
            .eq("guild_id", interaction.guild.id)
            .single();
        currentConfig = data;
    } catch (dbErr) {
        console.error("Error fetching config on command launch:", dbErr);
    }

    const adminRoleId = currentConfig?.admin_role_id;
    // 🛠️ Fixed: message.member -> interaction.member
    const hasRole =
        adminRoleId && interaction.member.roles.cache.has(adminRoleId);
    const isNativeAdmin = interaction.member.permissions.has("Administrator");

    // If this specific component or command requires authorization check:
    if (
        interaction.customId === "trigger_admin_modal" &&
        !hasRole &&
        !isNativeAdmin
    ) {
        return interaction.reply({
            content:
                "❌ **Access Denied.** Vault adjustments are restricted to league administrators.",
            flags: [64], // Ephemeral response so only they see it
        });
    }
    //Added this
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

            // Routes directly to the Admin Config menu view to show changes instantly
            return await setupManager.sendAdminConfigMenu(interaction, supabase);

        } catch (dbError) {
            console.error("🚨 Error updating system log channel target:", dbError);
            return await interaction.followUp({
                content: "❌ Failed to save system log channel configuration changes.",
                flags: [64],
            });
        }
    }
        
    // 📢 HANDLE APPEALS CHANNEL DROPDOWN SUBMISSION (Placed safely before the setup router filter)
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

    // 📢 HANDLE TRADE CHANNEL DROPDOWN SUBMISSION
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

    // 🛠️ UNIVERSAL SETUP ROUTER FILTER (UPDATED)
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
    !interaction.customId.startsWith("setup_sync_team_roles") && // 🛠️ FIX: Dynamic pagination bypass (catches setup_sync_team_roles_page_X)
    !interaction.customId.startsWith("nav_") &&
    !interaction.customId.includes("roles_page_");

if (isSetupComponent) {
    return await setupRouter.handleMenus(interaction, supabase);
}

// 🎭 ROUTE ROLE SYNCHRONIZATION BUTTONS TO setupManager
if (interaction.customId && interaction.customId.startsWith("setup_sync_team_roles")) {
    return await setupManager.syncSleeperTeamRoles(interaction, supabase);
}

if (interaction.customId === "setup_confirm_save_roles") {
    return await setupManager.handleConfirmSaveRoles(interaction, supabase);
}


    // 🔔 HANDLE TRADE ROLE DROPDOWN SUBMISSION - PLACED BEFORE THE UNIVERSAL FILTER
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
                    // 2. Commit the change to the new Supabase column
                    const { error } = await supabase
                        .from("league_configs")
                        .update({ audit_ping_role_id: selectedRoleId })
                        .eq("guild_id", interaction.guild.id);

                    if (error) throw error;

                    console.log(`[SetupRouter] Successfully updated Salary Alert Ping Role to: ${selectedRoleId}`);

                    // 3. Re-render the menu. 
                    // (Since this code is inside the setup router, call the function directly from your menu module)
                    return await setupManager.sendAdminConfigMenu(interaction, supabase);

                } catch (dbError) {
                    console.error("❌ Error updating audit ping role inside SetupRouter:", dbError);
                    return await interaction.followUp({
                        content: "❌ An error occurred while writing the role configuration to Supabase.",
                        flags: [64],
                    });
                }
            }

    // 💾 SAVE ADMIN ROLE CONFIGURATION TO SUPABASE (MOVED OUTSIDE MODAL BLOCKS)
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

    // 📩 MODAL SUBMISSIONS GO HERE
    if (interaction.isModalSubmit()) {
        const { customId } = interaction;
        
        if (interaction.customId === "setup_vault_pass_modal") {
            try {
                const newPassword = interaction.fields.getTextInputValue("vault_pass_input");

                const { error } = await supabase.from("league_configs").upsert(
                    {
                        guild_id: interaction.guild.id,
                        vault_password: newPassword, // Saves the dynamic text token straight to database
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

        // 📄 HANDLE GOOGLE SHEETS SETUP SUBMISSION
        if (interaction.customId === "modal_setup_sheets") {
            return await setupManager.handleSheetsSubmit(interaction, supabase);
        }
        // 👤 HANDLE PLAYER COLUMN MAPPING SUBMISSION
        if (interaction.customId === "modal_map_players") {
            return await setupManager.handleMappingSubmit(
                interaction,
                supabase,
                "players",
            );
        }
        // 🏢 HANDLE TEAM CELL MAPPING SUBMISSION
        if (interaction.customId === "modal_map_teams") {
            return await setupManager.handleMappingSubmit(
                interaction,
                supabase,
                "teams",
            );
        }
        // 🏆 HANDLE SLEEPER SETTINGS SUBMISSION
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
                const vaultModule = require("./utils/vault.js"); 
                return await vaultModule.handleFinalModalSubmission(interaction, supabase, client, getSheetData);
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
    }
    if (interaction.isButton()) {
        const { customId } = interaction;
        

        // Navigation Layout Engine Router
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

        // Layout Core Modal Mapping Configurations
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
        if (interaction.customId.startsWith("second_appeal_"))
            return await appeals.handleAppealButton(interaction, supabase);
        // 1. Enter the midway Roles Dashboard Menu
        if (interaction.customId === "nav_roles_dashboard") {
            await setupManager.sendRolesDashboard(interaction, supabase);
        }

        // 2. Open Manual Mapping Select Menu View
        if (interaction.customId.startsWith("nav_manual_roles")) {
            await setupManager.sendManualRoleMappingMenu(interaction, supabase);
        }
        // Isolate manual audit safely on its own level
        if (interaction.customId === "run_manual_audit") {
            await interaction.deferUpdate();
            const vaultUtils = require("./utils/vault.js");
            return await vaultUtils.runManualAudit(interaction, supabase, client, getSheetData);
        }

        // Convert the dangling else if into a standard, isolated if statement
        if (interaction.customId.startsWith("view_ext_")) {
            const playerName = interaction.customId.replace("view_ext_", "");
            const { logs } = await getSheetData(interaction.guild.id);
            const history = logs.filter((l) => l._rawData[0]?.toLowerCase() === playerName.toLowerCase());

            if (history.length === 0) {
                return await interaction.reply({ content: `❌ No history found for ${playerName}`, flags: [64] });
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

            return await interaction.reply({ embeds: [histEmbed] });
        }
        // Route transaction buttons safely
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
            return await handleFreeAgencyHub(interaction);
        }
    } // <--- THIS ends the "isButton" check.

    const getOwnerIdMap = getTeamMap;
    
    if (interaction.isStringSelectMenu() && interaction.customId === "portal_secret_menu_choice") {
        const loginCmd = client.commands.get("login");
        if (loginCmd && typeof loginCmd.handleSecretMenuChoice === "function") {
            return await loginCmd.handleSecretMenuChoice(interaction);
        }
    }

    // 🟢 UPDATED: Routes the dynamic modal submit to login.js
    if (interaction.isModalSubmit() && interaction.customId.startsWith("portal_secret_modal_")) {
        const loginCmd = client.commands.get("login");
        if (loginCmd && typeof loginCmd.handleSecretModalSubmit === "function") {
            return await loginCmd.handleSecretModalSubmit(interaction, supabase, currentConfig, getSheetData, getPlayerStats, getOwnerIdMap);
        }
    }

    // --- SLASH COMMANDS START HERE ---
    // Added this
    // --- SLASH COMMANDS START HERE ---
    if (interaction.isChatInputCommand()) {
        
        // 1. FETCH CONFIG FIRST (Moved to the very top so it's defined everywhere)
        let currentConfig = null;
        try {
            const { data } = await supabase
                .from("league_configs")
                .select("*")
                .eq("guild_id", interaction.guild.id)
                .single();
            currentConfig = data;
        } catch (dbErr) {
            console.error("Error fetching config on command launch:", dbErr);
        }

        // 2. Intercept dashboard commands early with the secure check
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

        try {
            // This order makes it perfectly compatible with your files
            await command.execute(
                interaction,
                supabase,
                currentConfig,
                getSheetData,
                getPlayerStats, // 👈 Passed 5th! Now salary.js matches perfectly
                getOwnerIdMap   // 👈 Passed 6th
            );
        } catch (error) {
            console.error(`❌ Error executing /${interaction.commandName}:`, error);
        }
    } // Closes: if (interaction.isChatInputCommand())
}); // Closes: client.on("interactionCreate")


async function pollAllLeagues() {
    console.log(
        `[${new Date().toLocaleTimeString()}] 🔍 Starting global Sleeper poll...`,
    );

    // 🟢 NEW: Fetch the dynamic current NFL week state
    let nflWeek = 1;
    try {
        const stateRes = await fetch("https://api.sleeper.app/v1/state/nfl");
        if (stateRes.ok) {
            const nflState = await stateRes.json();
            // Fallback to 1 if it's the off-season or preseason, otherwise use the active week
            nflWeek = nflState.season_type === "regular" ? nflState.week : 1;
        }
    } catch (err) {
        console.error("⚠️ Failed to fetch dynamic NFL state, defaulting to Week 1:", err.message);
    }

    // 1. Get all leagues from Supabase that have auditing enabled
    const { data: configs, error } = await supabase
        .from("league_configs")
        .select("*")
        .eq("audit_enabled", true);

    if (error) {
        console.error("🚨 Supabase Fetch Error:", error.message);
        return;
    }

    if (!configs || configs.length === 0) {
        console.log("ℹ️ No leagues currently have Audit Mode enabled.");
        return;
    }

    console.log(`active: Processing ${configs.length} league(s).`);

    for (const config of configs) {
        try {
            const guild = client.guilds.cache.get(config.guild_id);
            if (!guild) {
                console.warn(`⏩ Skipping League: Bot is not connected to Guild ID ${config.guild_id}`);
                continue;
            }

            if (!config.sleeper_id) {
                console.warn(`⏩ Skipping Guild ${config.guild_id}: Missing sleeper_id in config.`);
                continue;
            }

            console.log(`📡 Fetching data for Sleeper League ${config.sleeper_id} (Week ${nflWeek})...`);
            // 2. Fetch data specific to THIS league
            // We need the sheet data to know who the players are
            const { players, doc } = await getSheetData(config.guild_id);
            const teamMap = await getTeamMap(config.sleeper_id);

            // Fetch transactions for the calculated NFL week
            const res = await fetch(
                `https://api.sleeper.app/v1/league/${config.sleeper_id}/transactions/${nflWeek}`
            );

            if (!res.ok) {
                console.warn(`⚠️ Sleeper API unreachable for league: ${config.sleeper_id}`);
                continue;
            }

            const allTx = await res.json();

            if (!Array.isArray(allTx) || allTx.length === 0) {
                console.log(`ℹ️ No transactions found for league ${config.sleeper_id} in Week ${nflWeek}`);
                continue;
            }

            // 4. Sort transactions by time so we process oldest to newest
            // Filter completed transactions and sort oldest -> newest
            const sortedTx = allTx
                .filter((tx) => tx.status === "complete")
                .sort((a, b) => a.status_updated - b.status_updated);

            if (sortedTx.length === 0) {
                console.log(`ℹ️ No completed transactions found for league ${config.sleeper_id}`);
                continue;
            }

            const targetTxList = sortedTx.slice(-10);
            console.log(`📋 Found ${sortedTx.length} completed txs. Processing the most recent ${targetTxList.length}...`);

            // Fetch the specific log channel for THIS league
            const logChannel = await client.channels
                .fetch(config.log_channel_id)
                .catch((err) => {
                    console.error(`❌ Channel Fetch Error for ID ${config.log_channel_id}:`, err.message);
                    return null;
                });

            if (!logChannel) {
                console.error(`❌ Channel Error: Log channel ${config.log_channel_id} not accessible by bot.`);
                continue;
            }

            // Process each of the target transactions
            for (const tx of targetTxList) {
                const txKey = `${config.sleeper_id}_${tx.transaction_id}`;

                // Skip if this transaction was already processed during this bot session
                if (processedTxIds.has(txKey)) continue;

                console.log(`📤 Sending Transaction ${tx.transaction_id} to #${logChannel.name}...`);

                await processAndSend(
                    tx,
                    logChannel,
                    players,
                    teamMap,
                    config,
                    doc
                );

                // Track in-memory so it isn't resent on subsequent polling cycles
                processedTxIds.add(txKey);
            }

        } catch (err) {
            console.error(`❌ Error polling league ${config.sleeper_id}:`, err);
        }
    }
}
setInterval(pollAllLeagues, 60000); // Check all leagues every minute


//Added this
async function getTeamMap(sleeperId) {
    if (!sleeperLeagueId) {
        console.warn("⚠️ [getTeamMap] Skipped: No Sleeper League ID configured.");
        return {};
    }
    try {
        const [uRes, rRes] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${sleeperId}/users`),
            fetch(`https://api.sleeper.app/v1/league/${sleeperId}/rosters`),
        ]);
        const users = await uRes.json();
        const rosters = await rRes.json();

        let map = {}; // Create a local map
        rosters.forEach((r) => {
            const user = users.find((u) => u.user_id === r.owner_id);
            map[r.roster_id] =
                user?.metadata?.team_name ||
                user?.display_name ||
                `Team ${r.roster_id}`;
        });
        return map; // Return it to the loop
    } catch (e) {
        console.error("Team Map Error:", e);
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

