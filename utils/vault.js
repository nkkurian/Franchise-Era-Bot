const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const DataMapper = require("./dataMapper.js");

// Add a quick, reliable resolver inside or right above handleTransactionButton
const getOrFetchPlayerName = async (pId) => {
    // 1. Check local cache
    let cachedName = global.sleeperCache?.get(pId)?.name;
    if (cachedName) return cachedName;

    // 2. Direct API fallback if cache missed
    try {
        const res = await fetch(`https://api.sleeper.app/v1/players/nfl`);
        if (res.ok) {
            const players = await res.json();
            const player = players[pId];
            if (player) {
                const fullName = `${player.first_name} ${player.last_name}`.trim();
                // Optionally update cache
                if (global.sleeperCache) global.sleeperCache.set(pId, { name: fullName });
                return fullName;
            }
        }
    } catch (e) {
        console.error(`Failed to resolve player ID ${pId}:`, e);
    }

    return null; 
};

module.exports = {
    handleVaultTrigger: async (message) => {
        if (message.content.toLowerCase() === "!vault" && !message.author.bot) {
            await message.delete().catch(() => null);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("trigger_admin_modal")
                    .setLabel("🔓 Open Admin Vault")
                    .setStyle(ButtonStyle.Danger),
            );

            const vaultMsg = await message.channel.send({
                content: "🔒 **Secure Access Point Detected.**",
                components: [row],
            });
        }
    },

    showAdminModal: async (interaction) => {
        const modal = new ModalBuilder()
            .setCustomId("adminLoginModal")
            .setTitle("Admin Access");

        const passwordInput = new TextInputBuilder()
            .setCustomId("adminPassword")
            .setLabel("Enter Admin Password")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(passwordInput),
        );
        return await interaction.showModal(modal);
    },
    showAdminPanel: async (interaction, supabase) => {
        await interaction.deferReply();

        const { data: config } = await supabase
            .from("league_configs")
            .select("vault_password")
            .eq("guild_id", interaction.guild.id)
            .single();

        // 2. STOP if there is no password in the database
        if (!config?.vault_password) {
            return await interaction.reply({
                content: "⚠️ **Vault Access Disabled:** No administrative password has been configured for this server yet.\n\n*Please head over to the **setup** menu on your dashboard to set a password before using this command.*",
                flags: [64]
            });
        }

        // 3. Verify input against database value
        const password = interaction.fields.getTextInputValue("adminPassword");
        if (password === config.vault_password) {
            const adminEmbed = new EmbedBuilder()
                .setTitle("🛠️ Welcome to the Vault!")
                .setDescription(
                    "Choose an option below",
                )
                .setColor(0xe74c3c);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("run_manual_audit")
                    .setLabel("⚖️ Run Cap Audit")
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId("vault_modify_search")
                    .setLabel("👤 Modify Player")
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                .setCustomId("vault_fa_config")
                .setLabel("Free Agency Config")
                .setStyle(ButtonStyle.Success)
                .setEmoji("🏈"),
            );
            return await interaction.editReply({
                        embeds: [adminEmbed],
                        components: [row],
                        flags: [64],
                    });
                } else {
                    return await interaction.editReply({
                        content: "❌ Incorrect password.",
                        flags: [64],
                    });
                } // Closes the 'else' block
        }, // 🛠️ FIX: Cleanly closes 'showAdminPanel' and maps to the next object property

    showPlayerSearch: async (interaction) => {
        const modal = new ModalBuilder()
            .setCustomId("vault_player_search_modal")
            .setTitle("Find Player");
        const nameInput = new TextInputBuilder()
            .setCustomId("search_name")
            .setLabel("Player Name")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g. Patrick Mahomes")
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
        await interaction.showModal(modal);
    },

    // 2. Ask what to do with that player
    showActionBranch: async (interaction) => {
        await interaction.deferReply({ flags: [64] }); // or ephemeral: true depending on your d.js version
        // This comes from index.js via the interaction handler
        // We need to fetch the sheet data to show current stats
        const playerName = interaction.fields.getTextInputValue("search_name");

        // Use the global/passed getSheetData function
        // Note: You'll need to ensure getSheetData is accessible here
        // Or pass it as an argument if your setup requires it.
        const { players } = await interaction.client.getSheetData(interaction.guild.id);

        const pRow = players.find(
            (p) => p.name?.toLowerCase() === playerName.toLowerCase(),
        );

        const embed = new EmbedBuilder()
            .setTitle(`Vault Management: ${playerName}`)
            .setColor(0x3498db);

        if (pRow) {
            // Found the player! Show current sheet info
            // Found the player! Show current cleanly parsed properties
            const currentTeam = pRow.team || "Free Agent";
            const currentSalary = pRow.aav ? `$${pRow.aav.toLocaleString()}` : "$0.00";
            const currentCap = pRow.capHit ? `$${pRow.capHit.toLocaleString()}` : "$0.00";
            const currentYears = pRow.yearsLeft || "0";
            const currentNotes = pRow.notes || "None.";

            embed.setDescription(
                `**Current Contract Found:**\n` +
                    `🏟️ **Team:** ${currentTeam}\n` +
                    `💰 **Salary:** ${currentSalary}\n` +
                    `🧢 **Cap Hit:** ${currentCap}\n` +
                    `⏳ **Years:** ${currentYears}\n` +
                    `📜 **Notes:** ${currentNotes}\n\n` +
                    `*Select the transaction type to update this player:*`,
            );
        } else {
            // Player not found in sheet
            embed
                .setColor(0xe74c3c)
                .setDescription(
                    `⚠️ **Warning:** **${playerName}** was not found in the PlayerList sheet.\n\n` +
                        `If you proceed with **Sign**, a new record might be created or the update may fail.`,
                );
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`vault_sign_${playerName}`)
                .setLabel("✍️ Sign")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`vault_extension_${playerName}`)
                .setLabel("⏳ Extend")
                .setStyle(ButtonStyle.Primary),
        );

        await interaction.editReply({
            embeds: [embed],
            components: [row],
            flags: [64],
        });
    },

    // 3. The Final Data Entry Modal
    // 3. The Final Data Entry Modal
    showFinalActionModal: async (interaction, action, playerName) => {
        const modal = new ModalBuilder()
            .setCustomId(`vlt_fin_${action}_${playerName}`)
            .setTitle(`${action.toUpperCase()}: ${playerName}`);

        // Field 1: Yearly Salary (Numeric only)
        const salaryRow = new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("in_sal")
                .setLabel("Yearly Salary (Number only, e.g. 15)")
                .setPlaceholder("Do not add $ or M")
                .setStyle(TextInputStyle.Short)
                .setRequired(true),
        );

        // Field 2: Cap Hit (New Field)
        const capHitRow = new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("in_cap")
                .setLabel("Cap Hit (Number only, e.g. 5)")
                .setPlaceholder("Usually Salary + Bonus Proration")
                .setStyle(TextInputStyle.Short)
                .setRequired(true),
        );

        // Field 3: Years
        const yearsRow = new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("in_yrs")
                .setLabel("Years")
                .setStyle(TextInputStyle.Short)
                .setRequired(true),
        );

        // Field 4: Notes
        const notesRow = new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("in_struct")
                .setLabel("Notes / Structure")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false),
        );

        modal.addComponents(salaryRow, capHitRow, yearsRow, notesRow);
        return await interaction.showModal(modal);
    },
    runManualAudit: async (interaction, supabase, client, getSheetData) => {
        //await interaction.deferUpdate();
        await interaction.followUp({
            content: "⏳ Starting manual audit...",
            flags: [64], // Ephemeral flag
        });

        try {
            // Fetch the configuration object from Supabase first
            const { data: currentConfig } = await supabase
                .from("league_configs")
                .select("*")
                .eq("guild_id", interaction.guild.id)
                .single();

            // Requiring the audit handler function on-demand
            const { runWeeklyAudit } = require("./capCompliance.js");

            // Define the client using the interaction object, or fall back to the passed argument
            const finalClient = interaction.client || client;

            // Swap out "activeClient" for "finalClient"
            await runWeeklyAudit(finalClient, supabase, getSheetData, interaction.guild.id, currentConfig, "all");

            const activeLogChannel = currentConfig?.log_channel_id

            return await interaction.followUp({
                content: `✅ **Audit Complete.** Results posted to <#${activeLogChannel}>.`,
                    flags: [64],
            });
        } catch (err) {
            console.error("Manual Audit Error:", err);
            return await interaction.followUp({
                content: "❌ Audit failed.",
                flags: [64],
            });
        }
    },
    handleFinalModalSubmission: async (interaction, supabase, client, getSheetData) => {
        let currentConfig = null;
            try {
                const { data } = await supabase
                    .from("league_configs")
                    .select("*")
                    .eq("guild_id", interaction.guild.id)
                    .single();
                currentConfig = data;
            } catch (dbErr) {
                console.error(
                    "Error fetching config on financial modal submission:",
                    dbErr,
                );
            }

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

            await interaction.deferReply({ flags: [64] });

            const [, , action, playerName] = interaction.customId.split("_");

            // 1. Get raw inputs from the modal
            const rawSalary = interaction.fields.getTextInputValue("in_sal");
            const rawCapHit = interaction.fields.getTextInputValue("in_cap");
            const yearsInput = interaction.fields.getTextInputValue("in_yrs");
            const structure = interaction.fields.getTextInputValue("in_struct");

            // 2. Perform Calculations (Convert to Millions)
            const salary =
                Math.round(
                    parseFloat(rawSalary.replace(/[^0-9.]/g, "")) * 1000000,
                ) || 0;
            const capHit =
                Math.round(
                    parseFloat(rawCapHit.replace(/[^0-9.]/g, "")) * 1000000,
                ) || 0;
            const years = parseInt(yearsInput) || 0;
            const totalValue = salary * years;

            try {
                const { players, doc } = await getSheetData(interaction.guild.id);

                // 🎯 Grab the main player worksheet
                const mainTabName = currentConfig?.tab_players || doc.sheetsByIndex[0].title;
                const mainSheet = doc.sheetsByTitle[mainTabName];

                const pRow = players.find(
                    (p) => p.name?.toLowerCase() === playerName.toLowerCase()
                );

                const formatCurrency = (val) => {
                    return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                };

                if (action === "sign") {
                    // 🔄 CASE 1: Player exists -> Modify their existing row cells directly
                    if (pRow && pRow.rowRef) {
                        // 🛠️ Ensure mainSheet header values are loaded
                        await mainSheet.loadHeaderRow().catch(() => null);
                        const sheetHeaders = mainSheet.headerValues || [];

                        const salaryConf = currentConfig?.column_mapping?.aav;        
                        const capHitConf = currentConfig?.column_mapping?.cap_hit;    
                        const yearsConf = currentConfig?.column_mapping?.years_left;
                        const notesConf = currentConfig?.column_mapping?.map_notes || currentConfig?.column_mapping?.notes;

                        const findColumnIndex = (configVal) => {
                            if (configVal === undefined || configVal === null) return -1;
                            if (typeof configVal === 'number') return configVal;
                            if (typeof configVal === 'string' && configVal.trim().length === 1 && /^[a-zA-Z]$/.test(configVal.trim())) {
                                return configVal.trim().toUpperCase().charCodeAt(0) - 65;
                            }
                            if (typeof configVal === 'string' && !isNaN(configVal.trim())) {
                                return parseInt(configVal.trim());
                            }
                            return sheetHeaders.indexOf(configVal);
                        };

                        const salaryIdx = findColumnIndex(salaryConf);
                        const capHitIdx = findColumnIndex(capHitConf);
                        const yearsIdx  = findColumnIndex(yearsConf);
                        const notesIdx  = findColumnIndex(notesConf);

                        // 🛠️ FIX: Use pRow.rowRef.rowNumber or fallback to pRow.rowRef._rowNumber
                        const rowNum = pRow.rowRef.rowNumber || pRow.rowRef._rowNumber;
                        const rowIndex = rowNum - 1;

                        // 🛠️ FIX: Use mainSheet instead of pRow.rowRef._worksheet
                        await mainSheet.loadCells({
                            startRowIndex: rowIndex,
                            endRowIndex: rowIndex + 1
                        });

                        if (salaryIdx !== -1) mainSheet.getCell(rowIndex, salaryIdx).value = formatCurrency(salary);
                        if (capHitIdx !== -1) mainSheet.getCell(rowIndex, capHitIdx).value = formatCurrency(capHit);
                        if (yearsIdx !== -1)  mainSheet.getCell(rowIndex, yearsIdx).value = String(years);
                        if (notesIdx !== -1)  mainSheet.getCell(rowIndex, notesIdx).value = String(structure || "");

                        console.log("📝 Committing isolated cell changes to existing player...");
                        await mainSheet.saveUpdatedCells();
                    }
                    else {
                        console.log(`➕ Player not found. Appending brand new row for ${playerName}...`);

                        await mainSheet.loadHeaderRow().catch(() => null);
                        const sheetHeaders = mainSheet.headerValues || [];

                        const mapping = currentConfig?.column_mapping || {};

                        // 🛠️ 1. Dynamic Variables for Sleeper Data Extraction
                        let detectedPosition = "FA"; 
                        let detectedTeamName = "Free Agent"; // Default fallback
                        const leagueId = currentConfig?.league_id || interaction.guild.id; 

                        try {
                            // Fetch the global NFL player library
                            const sleeperRes = await fetch("https://api.sleeper.app/v1/players/nfl");
                            if (sleeperRes.ok) {
                                const masterPlayers = await sleeperRes.json();

                                // Find the player's core profile
                                const foundPlayer = Object.values(masterPlayers).find(
                                    (p) => `${p.first_name} ${p.last_name}`.toLowerCase() === playerName.toLowerCase()
                                );

                                if (foundPlayer) {
                                    if (foundPlayer.position) detectedPosition = foundPlayer.position;
                                    const pId = foundPlayer.player_id;

                                    // Fetch current league rosters and users to locate the manager
                                    const rostersRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`);
                                    const usersRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`);

                                    if (rostersRes.ok && usersRes.ok) {
                                        const rosters = await rostersRes.json();
                                        const users = await usersRes.json();

                                        // Find which roster contains this specific player ID
                                        const owningRoster = rosters.find(r => r.players && r.players.includes(pId));

                                        if (owningRoster && owningRoster.owner_id) {
                                            // Find the manager user profile matching that roster
                                            const manager = users.find(u => u.user_id === owningRoster.owner_id);
                                            if (manager) {
                                                // Extract custom team name, metadata nickname, or fallback to their username
                                                detectedTeamName = manager.metadata?.team_name || manager.metadata?.nickname || manager.display_name || "Assigned Team";
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (pErr) {
                            console.error("Failed fetching real-time team context from Sleeper API:", pErr);
                        }

                        // Using DataMapper to cleanly turn letters into header strings
                        const getHeaderByLetter = (letter, defaultFallback) => {
                            const idx = DataMapper.letterToIndex(letter);
                            return (idx !== -1 && sheetHeaders[idx]) ? sheetHeaders[idx] : defaultFallback;
                        };

                        const nameHeader  = getHeaderByLetter(mapping.map_name || mapping.name, "Player Name");
                        const posHeader   = getHeaderByLetter(mapping.map_pos || mapping.pos, "Position");
                        const teamHeader  = getHeaderByLetter(mapping.map_team || mapping.team, "Team Name"); // 🛠️ Re-enabled
                        const yrsHeader   = getHeaderByLetter(mapping.map_years_left || mapping.years_left, "Years");
                        const aavHeader   = getHeaderByLetter(mapping.map_aav || mapping.aav, "Yearly Salary");
                        const capHeader   = getHeaderByLetter(mapping.map_cap_hit || mapping.cap_hit, "Cap Hit");
                        const notesHeader = getHeaderByLetter(mapping.map_notes || mapping.notes, "Contract Structure");

                        const newRowData = {};
                        newRowData[nameHeader]  = playerName;
                        newRowData[posHeader]   = detectedPosition; 
                        newRowData[teamHeader]  = detectedTeamName;
                        newRowData[yrsHeader]   = String(years);
                        newRowData[aavHeader]   = formatCurrency(salary);
                        newRowData[capHeader]   = formatCurrency(capHit);
                        newRowData[notesHeader] = String(structure);

                        console.log(`📝 Appending row for ${playerName} on team: ${detectedTeamName}`, newRowData);
                        await mainSheet.addRow(newRowData);
                    }
                }
                // Added this
                if (action === "extension") {
                    const logTabName =
                        currentConfig?.tab_logs || "Transaction Log";
                    const logSheet = doc.sheetsByTitle[logTabName];
                    await logSheet.addRow({
                        Player: playerName,
                        Type: "Extension",
                        Salary: salary,
                        "Cap Hit": capHit,
                        "Bonus/Structure": structure,
                        Date: new Date().toLocaleDateString(),
                    });
                }

                const dynamicLogChannelId = currentConfig?.log_channel_id || "1485437733429182604";

                const logChannel = await client.channels.fetch(dynamicLogChannelId).catch(() => null);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle(`📑 Vault Update: ${action.toUpperCase()}`)
                        .setColor(action === "sign" ? 0x2ecc71 : 0x3498db)
                        .addFields(
                            {
                                name: "👤 Player",
                                value: playerName,
                                inline: true,
                            },
                            {
                                name: "⏳ Duration",
                                value: `${years} Years`,
                                inline: true,
                            },
                            {
                                name: "💰 Avg Salary",
                                value: `$${(salary / 1000000).toFixed(1)}M`,
                                inline: true,
                            },
                            {
                                name: "📉 Cap Hit",
                                value: `$${(capHit / 1000000).toFixed(1)}M`,
                                inline: true,
                            },
                            {
                                name: "💎 Total Value",
                                value: `$${(totalValue / 1000000).toFixed(1)}M`,
                                inline: true,
                            },
                            { name: "📝 Notes", value: structure },
                        )
                        .setTimestamp()
                        .setFooter({ text: `Admin: ${interaction.user.tag}` });

                    await logChannel.send({ embeds: [logEmbed] });
                }

                lastFetchTime = 0; // Force cache refresh
                return await interaction.editReply(
                    `✅ Processed **${action}** for **${playerName}**! Check the sheet.`,
                );
            } catch (err) {
                console.error("⛔ GOOGLE SHEETS WRITE ERROR:", err);
                return await interaction.editReply(
                    "❌ Error writing to Sheets.",
                    );
                 } 
            }, 

    handleTransactionButton: async (interaction, supabase, client, getSheetData) => {
        const { customId } = interaction;

        // Ensure user has permission to audit transactions
        let currentConfig = null;
        try {
            const { data } = await supabase
                .from("league_configs")
                .select("*")
                .eq("guild_id", interaction.guild.id)
                .single();
            currentConfig = data;
        } catch (dbErr) {
            console.error("Error fetching config on tx button interaction:", dbErr);
        }

        // Case A: Handle Waiver Salary shortcut button press
        if (customId.startsWith("tx_waiver_")) {
            await interaction.deferReply({ flags: [64] });

            // Format: tx_waiver_[pId]_[defaultAAV]_[defaultYears]
            const [_, __, pId, defaultAAV, defaultYears] = customId.split("_");

        const playerName = await getOrFetchPlayerName(pId);

            if (!playerName) {
                return await interaction.editReply({ 
                    content: `❌ Could not resolve player name for ID: **${pId}**. Sheet update cancelled to prevent corrupted entries.` 
                });
            }

            const mockModalInteraction = {
                ...interaction,
                guild: interaction.guild,  
                member: interaction.member, 
                user: interaction.user,     
                client: interaction.client, 
                customId: `vlt_fin_sign_${playerName}`,
                fields: {
                    getTextInputValue: (fieldId) => {
                        if (fieldId === "in_sal") return defaultAAV === "Min" ? "0.5" : defaultAAV.replace(/[^0-9.]/g, "");
                        if (fieldId === "in_cap") return defaultAAV === "Min" ? "0.5" : defaultAAV.replace(/[^0-9.]/g, "");
                        if (fieldId === "in_yrs") return String(defaultYears);
                        if (fieldId === "in_struct") return "";
                        return "";
                    }
                },
                deferReply: async () => {}, 
                editReply: async (payload) => await interaction.editReply(payload),
                reply: async (payload) => await interaction.editReply(payload)
            };

            const vaultModule = require("./vault.js");
            return await vaultModule.handleFinalModalSubmission(mockModalInteraction, supabase, client, getSheetData);
        }

        // Case B: Handle Edit Salary manual override modal popup
        if (customId.startsWith("tx_edit_")) {
            const pId = customId.replace("tx_edit_", "");
            const playerName = await getOrFetchPlayerName(pId);

                if (!playerName) {
                    return await interaction.reply({ 
                        content: `❌ Could not resolve player name for ID: **${pId}**.`,
                        flags: [64]
                    });
                }

                const vaultModule = require("./vault.js");
                return await vaultModule.showFinalActionModal(interaction, "sign", playerName);
            }

        },
    showFAConfig: async (interaction, supabase) => {
        await interaction.deferReply();

        const { data: config } = await supabase
            .from("league_configs")
            .select("fa_enabled, fa_sheet_id, fa_sheet_tab")
            .eq("guild_id", interaction.guild.id)
            .single();

        const isEnabled = config?.fa_enabled ? "🟢 Enabled" : "🔴 Disabled";
        const sheetId = config?.fa_sheet_id || "*Not Set*";
        const sheetTab = config?.fa_sheet_tab || "*Not Set*";

        const faEmbed = new EmbedBuilder()
            .setTitle("🏈 Free Agency Configuration")
            .setColor(config?.fa_enabled ? 0x2ecc71 : 0xe74c3c)
            .setDescription("Manage Free Agency bidding settings for this server.")
            .addFields(
                { name: "Status", value: isEnabled, inline: true },
                { name: "Sheet ID", value: `\`${sheetId}\``, inline: false },
                { name: "Sheet Tab Name", value: `\`${sheetTab}\``, inline: false }
            );

        const configRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("toggle_fa_status")
                .setLabel(config?.fa_enabled ? "Disable FA" : "Enable FA")
                .setStyle(config?.fa_enabled ? ButtonStyle.Danger : ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId("open_fa_sheet_modal")
                .setLabel("Set Sheet & Tab")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("📝")
        );

        return await interaction.editReply({ embeds: [faEmbed], components: [configRow] });
    },

    toggleFAStatus: async (interaction, supabase) => {
        // Fetch current status
        const { data: config } = await supabase
            .from("league_configs")
            .select("fa_enabled, fa_sheet_id, fa_sheet_tab")
            .eq("guild_id", interaction.guild.id)
            .single();

        const newStatus = !config?.fa_enabled;

        // Update database
        await supabase
            .from("league_configs")
            .update({ fa_enabled: newStatus })
            .eq("guild_id", interaction.guild.id);

        // Re-build updated embed
        const isEnabledStr = newStatus ? "🟢 Enabled" : "🔴 Disabled";
        const sheetId = config?.fa_sheet_id || "*Not Set*";
        const sheetTab = config?.fa_sheet_tab || "*Not Set*";

        const updatedEmbed = new EmbedBuilder()
            .setTitle("🏈 Free Agency Configuration")
            .setColor(newStatus ? 0x2ecc71 : 0xe74c3c)
            .setDescription("Manage Free Agency bidding settings for this server.")
            .addFields(
                { name: "Status", value: isEnabledStr, inline: true },
                { name: "Sheet ID", value: `\`${sheetId}\``, inline: false },
                { name: "Sheet Tab Name", value: `\`${sheetTab}\``, inline: false }
            );

        const configRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("toggle_fa_status")
                .setLabel(newStatus ? "Disable FA" : "Enable FA")
                .setStyle(newStatus ? ButtonStyle.Danger : ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId("open_fa_sheet_modal")
                .setLabel("Set Sheet & Tab")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("📝")
        );

        // Instantly update the existing Discord message in-place!
        return await interaction.update({ embeds: [updatedEmbed], components: [configRow] });
    },

    showFASheetModal: async (interaction) => {
        const modal = new ModalBuilder()
            .setCustomId("modal_fa_sheet_setup")
            .setTitle("Free Agency Sheet Config");

        const sheetIdInput = new TextInputBuilder()
            .setCustomId("input_fa_sheet_id")
            .setLabel("Google Sheet ID")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g. 1BxiMVs0XRm5nX0s...")
            .setRequired(true);

        const sheetTabInput = new TextInputBuilder()
            .setCustomId("input_fa_sheet_tab")
            .setLabel("Sheet Tab Name")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g. FA Bids")
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(sheetIdInput),
            new ActionRowBuilder().addComponents(sheetTabInput)
        );

        return await interaction.showModal(modal);
    },

    handleFASheetModalSubmission: async (interaction, supabase) => {
        await interaction.deferUpdate(); // Acknowledge modal without posting a new message

        const sheetId = interaction.fields.getTextInputValue("input_fa_sheet_id").trim();
        const sheetTab = interaction.fields.getTextInputValue("input_fa_sheet_tab").trim();

        // Update database
        const { error } = await supabase
            .from("league_configs")
            .update({
                fa_sheet_id: sheetId,
                fa_sheet_tab: sheetTab
            })
            .eq("guild_id", interaction.guild.id);

        if (error) {
            return await interaction.followUp({ content: `❌ Error saving settings: ${error.message}`, flags: [64] });
        }

        // Fetch refreshed config state
        const { data: config } = await supabase
            .from("league_configs")
            .select("fa_enabled")
            .eq("guild_id", interaction.guild.id)
            .single();

        const isEnabledStr = config?.fa_enabled ? "🟢 Enabled" : "🔴 Disabled";

        const updatedEmbed = new EmbedBuilder()
            .setTitle("🏈 Free Agency Configuration")
            .setColor(config?.fa_enabled ? 0x2ecc71 : 0xe74c3c)
            .setDescription("Manage Free Agency bidding settings for this server.")
            .addFields(
                { name: "Status", value: isEnabledStr, inline: true },
                { name: "Sheet ID", value: `\`${sheetId}\``, inline: false },
                { name: "Sheet Tab Name", value: `\`${sheetTab}\``, inline: false }
            );

        const configRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("toggle_fa_status")
                .setLabel(config?.fa_enabled ? "Disable FA" : "Enable FA")
                .setStyle(config?.fa_enabled ? ButtonStyle.Danger : ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId("open_fa_sheet_modal")
                .setLabel("Set Sheet & Tab")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("📝")
        );

        // Edit the original menu embed directly!
        return await interaction.editReply({ embeds: [updatedEmbed], components: [configRow] });
    },
}; 