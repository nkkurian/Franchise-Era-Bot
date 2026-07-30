const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    StringSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ChannelType,
} = require("discord.js");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { google } = require("googleapis");
const { JWT } = require("google-auth-library");

// We pass supabase in from index.js so we can use it here
module.exports = {
    // 1. GENERATE THE MAIN DASHBOARD
    async sendDashboard(interaction, supabase, isUpdate = false) {
        // Fetch current config to show status (Optional but pro)
        const { data: config } = await supabase
            .from("league_configs")
            .select("*")
            .eq("guild_id", interaction.guild.id)
            .single();

        const setupEmbed = new EmbedBuilder()
        .setTitle("🛠️ League Setup Dashboard")
        .setDescription("Configure your league sources and toggles. Settings are saved instantly to the database.")
        .setColor(0x5865f2)
        .addFields(
            { name: "📋 Sheet Status", value: config?.sheet_id ? "✅ Linked" : "❌ Not Set", inline: true },
            { name: "🏆 Sleeper Status", value: config?.sleeper_id ? "✅ Linked" : "❌ Not Set", inline: true },
            { name: "🛡️ Audit Mode", value: config?.audit_enabled ? "🟢 Enabled" : "🔴 Disabled", inline: true },
        )
        .setFooter({ text: "Franchise Pro Management System" });

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("nav_sheets")
                .setLabel("Google Sheets")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("📄"),
            new ButtonBuilder()
                .setCustomId("nav_sleeper")
                .setLabel("Sleeper and Misc")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("🏆"),
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("nav_team")
                .setLabel("Team Settings")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("👥"),
            new ButtonBuilder()
                .setCustomId("nav_discord")
                .setLabel("Discord Config")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("⚙️"),
        );
        if (isUpdate) {
            return await interaction.update({
                embeds: [setupEmbed],
                components: [row1, row2],
            });
        } else {
            return await interaction.reply({
                embeds: [setupEmbed],
                components: [row1, row2],
            });
        }
    },

    
        async sendSheetsMenu(interaction, supabase) {
        const { data: config } = await supabase
            .from("league_configs")
            // ADD min_contract_salary AND auto_salary_rules TO SELECT
            .select("sheet_id, tab_players, tab_logs, min_contract_salary, auto_salary_rules")
            .eq("guild_id", interaction.guild.id)
            .single();

            const rawVal = Number(config?.min_contract_salary);
            const minSalaryDisplay = !isNaN(rawVal) && rawVal > 0 
                ? `$${rawVal}M` 
                : "❌ *Not Set*";

        const autoRulesDisplay = config?.auto_salary_rules && Object.keys(config.auto_salary_rules).length > 0 
            ? "✅ *Configured*" 
            : "⚪ *Using Defaults*";

        const embed = new EmbedBuilder()
            .setTitle("📄 Google Sheets Configuration")
            .setDescription(
                "Manage your data connection sync settings. Make sure your service account email is added to your sheet as an Editor.",
            )
            .addFields(
                {
                    name: "📋 Connected Sheet ID",
                    value: config?.sheet_id
                        ? `\`${config.sheet_id}\``
                        : "❌ *Not Set*",
                    inline: false,
                },
                {
                    name: "👤 Players Tab Name",
                    value: config?.tab_players
                        ? `\`${config.tab_players}\``
                        : "❌ *Not Set*",
                    inline: true,
                },
                {
                    name: "📜 Future Salaries Tab",
                    value: config?.tab_logs
                        ? `\`${config.tab_logs}\``
                        : "*None (Disabled)*",
                    inline: true,
                },
                {
                    name: "⚙️ Auto Salary Engine",
                    value: `${autoRulesDisplay} (Min: ${minSalaryDisplay})`,
                    inline: false,
                }
            )
            .setColor(0x2ecc71);

        const buttons = [
            new ButtonBuilder()
                .setCustomId("setup_sheets_btn")
                .setLabel("Link Sheet ID & Tabs")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("🔗"),
            new ButtonBuilder()
                .setCustomId("setup_map_cols_btn")
                .setLabel("Map Columns Layout")
                .setStyle(ButtonStyle.Success)
                .setEmoji("🗺️"),
            new ButtonBuilder()
            .setCustomId("setup_auto_salary_btn")
            .setLabel("Salary Minimums")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("🤖"),
            new ButtonBuilder()
                .setCustomId("nav_main")
                .setLabel("Back")
                .setStyle(ButtonStyle.Secondary),
        ];

        if (config?.sheet_id) {
            buttons.push(
                new ButtonBuilder()
                    .setLabel("Open Sheet")
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://docs.google.com/spreadsheets/d/${config.sheet_id}`)
            );
        }
    const row = new ActionRowBuilder().addComponents(buttons.slice(0, 5));

        const payload = { embeds: [embed], components: [row] };
        return (interaction.replied || interaction.deferred) ? await interaction.editReply(payload) : await interaction.update(payload);
    },

    async showAutoSalaryModal(interaction, supabase) {
            const { data: config } = await supabase
                .from("league_configs")
                .select("min_contract_salary, auto_salary_rules")
                .eq("guild_id", interaction.guild.id)
                .single();

            const rules = config?.auto_salary_rules || {};

            const modal = new ModalBuilder()
                .setCustomId("modal_auto_salary_config")
                .setTitle("Configure Salary Automation Rules");

            const fields = [
                { id: "salary_min", label: "League Minimum Salary (in Mil)", val: config?.min_contract_salary, placeholder: "3" },
                { id: "rule_waiver_aav", label: "Default Waiver AAV Value(in Millions)", val: rules.waiver_aav, placeholder: "1" },
                { id: "rule_waiver_years", label: "Default Waiver Years Duration", val: rules.waiver_years, placeholder: "1" },
                { id: "rule_edit_years", label: "Default Edit Years (Cuts/Out)", val: rules.edit_years, placeholder: "0" }
            ];

            const rows = fields.map((f) =>
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId(f.id)
                        .setLabel(f.label)
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder(f.placeholder)
                        .setValue(f.val !== undefined && f.val !== null ? String(f.val) : "")
                        .setRequired(f.id === "salary_min"),
                ),
            );

            modal.addComponents(rows);
            await interaction.showModal(modal);
        },

        // NEW: Add a verification branch inside your modal handler router 
        async handleAutoSalarySubmit(interaction, supabase) {
            await interaction.deferUpdate();
            try {
                const minSal = parseFloat(interaction.fields.getTextInputValue("salary_min").replace(/[$,]/g, "")) || 0;

                const autoRules = {
                    waiver_aav: interaction.fields.getTextInputValue("rule_waiver_aav")?.trim() || null,
                    waiver_years: interaction.fields.getTextInputValue("rule_waiver_years")?.trim() || null,
                    edit_years: interaction.fields.getTextInputValue("rule_edit_years")?.trim() || null,
                };

                const { error } = await supabase.from("league_configs").upsert({
                    guild_id: interaction.guild.id,
                    min_contract_salary: minSal,
                    auto_salary_rules: autoRules,
                });

                if (error) throw error;
                return await this.sendSheetsMenu(interaction, supabase);
            } catch (err) {
                console.error("🚨 ERROR SAVING AUTO SALARY SETTINGS:", err);
                return await interaction.followUp({
                    content: "❌ An internal database error occurred while saving salary details.",
                    flags: [64]
                });
            }
        },

    async sendColumnMappingMenu(interaction, supabase) {
        if (!interaction.deferred && !interaction.replied)
            await interaction.deferUpdate();

        const { data: config } = await supabase
            .from("league_configs")
            .select("*")
            .eq("guild_id", interaction.guild.id)
            .single();

        const mapping = config?.column_mapping || {};

        const getStatus = (key) => {
            const colLetter = mapping[key];
            if (
                colLetter === undefined ||
                colLetter === null ||
                colLetter === ""
            )
                return "❌ *Not Set*";
            return `✅ **Column ${String(colLetter).toUpperCase()}**`;
        };

        const embed = new EmbedBuilder()
            .setTitle("🗺️ Column & Cell Mapping Layout")
            .setDescription(
                "Enter the **Column Letter** (A, B, C) for player data, or the exact **Cell Coordinates** (e.g., H2, B15) for team-wide metrics.\n\u200B",
            )
            .setColor(0xf1c40f)
            // Inside sendColumnMappingMenu fields array replacement:
            .addFields(
                // Player Row
                { name: "👤 Player Name", value: getStatus("name"), inline: true },
                { name: "🏠 Team Name", value: getStatus("team"), inline: true },
                { name: "🏈 Position", value: getStatus("pos"), inline: true },

                // Financial Row (Split Salary into AAV & Cap Hit)
                { name: "⏳ Years Left (Col)", value: getStatus("years_left"), inline: true },
                { name: "💰 Player AAV (Col)", value: getStatus("aav"), inline: true },
                { name: "🛡️ Player Cap Hit (Col)", value: getStatus("cap_hit"), inline: true },

                // Advanced Settings Row
                { name: "🏦 Team Cap Space (Cell)", value: getStatus("team_cap"), inline: true },
                { name: "📜 Team Extensions (Cell)", value: getStatus("team_ext"), inline: true },
                { name: "🔄 Trade Limit (Cell)", value: getStatus("trade_limit"), inline: true },
                { name: "📝 Player Notes (Col)", value: getStatus("notes"), inline: true }
            )
            .setFooter({
                text: "Settings save instantly to your configuration storage.",
            });

        const buttonsRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("open_player_map_modal")
                .setLabel("Map Player Columns")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("👤"),
            new ButtonBuilder()
                .setCustomId("open_team_map_modal")
                .setLabel("Map Team Columns")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("🏢"),
            new ButtonBuilder()
                .setCustomId("nav_sheets")
                .setLabel("Back")
                .setStyle(ButtonStyle.Secondary),
        );

        return await interaction.editReply({
            embeds: [embed],
            components: [buttonsRow],
        });
    },

    // NEW: Launches the Player Attributes Popup
    async showPlayerMapModal(interaction, supabase) {
        const { data: config } = await supabase
            .from("league_configs")
            .select("column_mapping")
            .eq("guild_id", interaction.guild.id)
            .single();

        const mapping = config?.column_mapping || {};
        const modal = new ModalBuilder()
            .setCustomId("modal_map_players")
            .setTitle("Map Player Sheet Columns");

        // 1. Inside showPlayerMapModal fields array swap:
        const fields = [
            { id: "map_name", label: "Player Name Column (e.g. A)", val: mapping.name },
            { id: "map_team", label: "Team Name Column (e.g. B)", val: mapping.team },
            { id: "map_pos", label: "Player Position Column (e.g. C)", val: mapping.pos },
            { id: "map_years_left", label: "Years Left Column (e.g. F)", val: mapping.years_left },
            { id: "map_notes", label: "Player Notes Column (e.g. K)", val: mapping.notes }
        ];

        const rows = fields.map((f) =>
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId(f.id)
                    .setLabel(f.label)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder("Enter column letter...")
                    .setValue(f.val ? String(f.val) : "")
                    .setRequired(true),
            ),
        );

        modal.addComponents(rows);
        await interaction.showModal(modal);
    },

    // NEW: Launches the Team Finance/Limits Popup
    async showTeamMapModal(interaction, supabase) {
        const { data: config } = await supabase
            .from("league_configs")
            .select("column_mapping")
            .eq("guild_id", interaction.guild.id)
            .single();

        const mapping = config?.column_mapping || {};
        const modal = new ModalBuilder()
            .setCustomId("modal_map_teams")
            .setTitle("Map Team Sheet Cells");

        const fields = [
            { id: "map_aav", label: "Player AAV Column (e.g. D)", val: mapping.aav, req: true },
            { id: "map_cap_hit", label: "Player Cap Hit Column (e.g. E)", val: mapping.cap_hit, req: true },
            { id: "map_team_cap", label: "Team Cap Space Cell (e.g. H2)", val: mapping.team_cap, req: true },
            { id: "map_team_ext", label: "Team Extensions Cell (e.g. H3)", val: mapping.team_ext, req: false },
            { id: "map_trade_limit", label: "Team Trade Limit Cell (e.g. H4)", val: mapping.trade_limit, req: false },
        ];

        const rows = fields.map((f) =>
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId(f.id)
                    .setLabel(f.label)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder("Enter coordinate (e.g., H2)")
                    .setValue(f.val ? String(f.val) : "")
                    .setRequired(f.req),
            ),
        );

        modal.addComponents(rows);
        await interaction.showModal(modal);
    },

    // NEW: Processes both modal submissions, cleans the input letters, and updates DB
    // NEW/REVISED: Processes both modal submissions, cleans inputs, and saves to the jsonb column
    async handleMappingSubmit(interaction, supabase, type) {
        // Acknowledge the modal immediately, telling Discord we are updating the background message
        await interaction.deferUpdate();

        try { // <--- FIXED: Added missing opening try block
            const { data: config } = await supabase
                .from("league_configs")
                .select("column_mapping")
                .eq("guild_id", interaction.guild.id)
                .single();

            // Ensure we preserve anything already inside the JSON object
            const currentMapping = config?.column_mapping || {};

            if (type === "players") {
                // Using ?. optional chaining protects against empty field submissions crashing the bot
                currentMapping.name = interaction.fields.getTextInputValue("map_name")?.trim().toUpperCase() || currentMapping.name;
                currentMapping.team = interaction.fields.getTextInputValue("map_team")?.trim().toUpperCase() || currentMapping.team;
                currentMapping.pos = interaction.fields.getTextInputValue("map_pos")?.trim().toUpperCase() || currentMapping.pos;
                currentMapping.years_left = interaction.fields.getTextInputValue("map_years_left")?.trim().toUpperCase() || currentMapping.years_left;
                currentMapping.notes = interaction.fields.getTextInputValue("map_notes")?.trim().toUpperCase() || currentMapping.notes;
            } else if (type === "teams") {
                currentMapping.aav = interaction.fields.getTextInputValue("map_aav")?.trim().toUpperCase() || currentMapping.aav;
                currentMapping.cap_hit = interaction.fields.getTextInputValue("map_cap_hit")?.trim().toUpperCase() || currentMapping.cap_hit;
                currentMapping.team_cap = interaction.fields.getTextInputValue("map_team_cap")?.trim().toUpperCase() || currentMapping.team_cap;

                const extVal = interaction.fields.getTextInputValue("map_team_ext")?.trim().toUpperCase();
                currentMapping.team_ext = extVal || currentMapping.team_ext || null;

                const tradeVal = interaction.fields.getTextInputValue("map_trade_limit")?.trim().toUpperCase();
                currentMapping.trade_limit = tradeVal || currentMapping.trade_limit || null;
            }

            // Upsert targeting the guild_id primary key, passing the updated JSON object
            const { error: dbError } = await supabase.from("league_configs").upsert({
                guild_id: interaction.guild.id,
                column_mapping: currentMapping,
            });

            if (dbError) throw dbError;

            // REFRESH ENGINE: Edits the original dashboard message directly with updated values
            return await this.sendColumnMappingMenu(interaction, supabase);

        } catch (err) {
            console.error("🚨 CRASH IN MODAL SUBMIT HANDLER:", err);

            // Because it failed, we send a hidden failure message so the admin knows things broke
            return await interaction.followUp({
                content: "❌ An internal database or code layout logic error occurred while saving.",
                flags: [64]
            });
        }
    },

    async handleSheetsSubmit(interaction, supabase) {
        const sheetId = interaction.fields.getTextInputValue("in_sheet_id");
        const pTab = interaction.fields.getTextInputValue("in_tab_players");
        const lTab =
            interaction.fields.getTextInputValue("in_tab_logs") || null;

        await interaction.deferReply();

        try {
            // 2. Setup Service Account Auth (METHOD 1)
            // This replaces the old oauth2Client code
            const serviceAccountAuth = new JWT({
                email: process.env.GOOGLE_EMAIL,
                key: process.env.GOOGLE_KEY.replace(/\\n/g, "\n"),
                scopes: ["https://www.googleapis.com/auth/spreadsheets"],
            });

            // 3. Connection Test
            const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
            await doc.loadInfo();

            // Check for Player Tab
            if (!doc.sheetsByTitle[pTab]) {
                return await interaction.editReply({
                    content: `❌ **Tab Mismatch Error:** I found the sheet, but there's no tab named **"${pTab}"**. (Note: Tab names are case-sensitive!)`,
                });
            }

            // 4. Save to Supabase
            const { error } = await supabase.from("league_configs").upsert({
                guild_id: interaction.guild.id,
                sheet_id: sheetId,
                tab_players: pTab,
                tab_logs: lTab,
            });

            if (error) throw error;

            return await interaction.editReply(
                "✅ **Verified & Saved!** Your Service Account successfully connected to the sheet.",
            );
        } catch (err) {
            console.error("SHEET VERIFY ERROR:", err.message);
            return await interaction.editReply(
                `❌ **Access Denied:** I couldn't connect to that Sheet ID.\n\n` +
                    `**Troubleshooting:**\n` +
                    `1. Double check the ID string is correct.\n` +
                    `2. Ensure you shared the sheet with \`${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}\` as an **Editor**.`,
            );
        }
    },

    async sendSleeperMenu(interaction, supabase) {
        const { data: config } = await supabase
            .from("league_configs")
            .select("sleeper_id, sleeper_name")
            .eq("guild_id", interaction.guild.id)
            .single();

        const embed = new EmbedBuilder()
            .setTitle("🏆 Sleeper and Miscellanious Settings")
            .setDescription(
                "Manage the link between this server and your Sleeper League.",
            )
            .addFields(
                {
                    name: "League Name",
                    value: config?.sleeper_name || "*Not Verified*",
                    inline: true,
                },
                {
                    name: "League ID",
                    value: `\`${config?.sleeper_id || "Not Set"}\``,
                    inline: true,
                },
            )
            .setColor(0x00acee);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("setup_sleeper_btn")
                .setLabel("Edit ID")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId("nav_main")
                .setLabel("Back")
                .setStyle(ButtonStyle.Secondary),
        );

        return await interaction.update({ embeds: [embed], components: [row] });
    },
    async sendRolesDashboard(interaction, supabase) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();

        const { data: config } = await supabase
            .from("league_configs")
            .select("sleeper_team_roles")
            .eq("guild_id", interaction.guild.id)
            .single();

        const currentRoles = config?.sleeper_team_roles || {};
        const totalTeams = Object.keys(currentRoles).length;
        const assignedCount = Object.values(currentRoles).filter(t => t.roleId).length;

        const embed = new EmbedBuilder()
            .setTitle("🎭 Roster Role Configuration")
            .setDescription("Choose how you want to manage your franchise-to-server role assignments.")
            .setColor(0x00acee)
            .addFields(
                { name: "Current Status", value: totalTeams > 0 
                    ? `📊 **${assignedCount} / ${totalTeams}** teams have assigned Discord roles.`
                    : "⚪ No role configurations saved yet. Run an Auto Sync to begin!" }
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("setup_sync_team_roles")
                .setLabel("🚀 Auto Sync Roles")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId("nav_manual_roles")
                .setLabel("🔧 Manual Mapping")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId("nav_main")
                .setLabel("Back")
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
    },

    async handleConfirmSaveRoles(interaction, supabase) {
        const guildId = interaction.guild.id;
        const payload = global.pendingDashboardRoles?.[guildId];

        if (!payload) {
            return await interaction.reply({ content: "❌ Sync session expired. Please hit sync roles again.", ephemeral: true });
        }

        await interaction.deferUpdate();

        try {
            // 1. Fetch the full current configuration to prevent breaking table constraints
            const { data: config } = await supabase
                .from("league_configs")
                .select("*")
                .eq("guild_id", guildId)
                .single();

            // 2. Build a complete update payload preserving existing settings
            const updatedConfig = {
                ...(config || {}),
                guild_id: guildId,
                sleeper_team_roles: payload // Committing our merged user mappings
            };

            const { error } = await supabase
                .from("league_configs")
                .upsert(updatedConfig);

            if (error) throw error;

            // Clear cached data memory allocation
            delete global.pendingDashboardRoles[guildId];

            // Route safely back to the validated Sleeper menu dashboard
            return await this.sendRolesDashboard(interaction, supabase);

        } catch (saveError) {
            console.error("🚨 DATABASE COMMIT ERROR:", saveError);
            return await interaction.followUp({ content: `❌ Error writing update sequence to database storage: ${saveError.message}`, ephemeral: true });
        }
    },

    async sendManualRoleMappingMenu(interaction, supabase) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();

        // 1. Parse active page offset
        let page = 0;
        if (interaction.customId && interaction.customId.includes("page_")) {
            page = parseInt(interaction.customId.split("page_")[1]) || 0;
        }

        // 2. Grab local configuration state
        const { data: config } = await supabase
            .from("league_configs")
            .select("sleeper_id, sleeper_team_roles")
            .eq("guild_id", interaction.guild.id)
            .single();

        if (!config?.sleeper_id) {
            return await interaction.followUp({ content: "❌ Please configure a valid **League ID** first under Sleeper Settings.", ephemeral: true });
        }

        let currentRoles = config?.sleeper_team_roles || {};

        // 🔄 SELF-HEALING HOOK: If database map is empty, pull raw records live from Sleeper API
        if (Object.keys(currentRoles).length === 0) {
            try {
                const [usersRes, rostersRes] = await Promise.all([
                    fetch(`https://api.sleeper.app/v1/league/${config.sleeper_id}/users`),
                    fetch(`https://api.sleeper.app/v1/league/${config.sleeper_id}/rosters`)
                ]);
                const sleeperUsers = await usersRes.json();
                const sleeperRosters = await rostersRes.json();

                if (sleeperUsers && sleeperRosters) {
                    const primaryOwnerIds = new Set(sleeperRosters.map(r => r.owner_id).filter(Boolean));
                    const primaryUsers = sleeperUsers.filter(u => primaryOwnerIds.has(u.user_id));

                    primaryUsers.forEach(user => {
                        const username = user.display_name || "Unknown Manager";
                        const officialTeamName = user.metadata?.team_name || `${username}'s Team`;
                        currentRoles[user.user_id] = { teamName: officialTeamName, roleId: null, roleName: null };
                    });
                }
            } catch (apiErr) {
                console.error("🚨 Background API Fetch failed:", apiErr);
            }
        }

        // 3. Build formatting stacks for the Select Menu and the Overview Embed
        const selectMenuOptions = [];
        const layoutOverviewLines = [];

        for (const [userId, data] of Object.entries(currentRoles)) {
            // Option definition for dropdown engine
            selectMenuOptions.push({
                label: data.teamName.substring(0, 25),
                description: data.roleId ? `Linked: @${data.roleName}` : "No Discord identity linked.",
                value: userId
            });

            // String definition for the admin summary layout embed
            if (data.roleId) {
                layoutOverviewLines.push(`🟢 **${data.teamName}** ➔ <@&${data.roleId}>`);
            } else {
                layoutOverviewLines.push(`⚪ **${data.teamName}** ➔ *(No Role)*`);
            }
        }

        if (selectMenuOptions.length === 0) {
            return await interaction.followUp({ content: "⚠️ No franchise data could be compiled. Verify your League ID.", ephemeral: true });
        }

        // 4. Calculate Paging Constraints
        const maxPerPage = 20; // Lowered slightly to leave space for the list text lines
        const totalPages = Math.ceil(selectMenuOptions.length / maxPerPage);
        const startOffset = page * maxPerPage;

        const pageOptions = selectMenuOptions.slice(startOffset, startOffset + maxPerPage);
        const pageDisplayLines = layoutOverviewLines.slice(startOffset, startOffset + maxPerPage);

        // 5. Construct Admin Visibility Layout Dashboard
        const embed = new EmbedBuilder()
            .setTitle("🛠️ Manual Team Role Overrides & Map Summary")
            .setDescription(
                `Select a franchise spot from the dropdown below to forcefully adjust or create its role binding.\n\n` +
                `📊 **Current Server Mapping Summary (Page ${page + 1}/${totalPages}):**\n` +
                `--------------------------------------------------\n` +
                pageDisplayLines.join("\n")
            )
            .setColor(0x9b59b6)
            .setFooter({ text: `Franchise Total: ${selectMenuOptions.length} | Page View Bounds: [${startOffset + 1} - ${Math.min(startOffset + maxPerPage, selectMenuOptions.length)}]` });

        const menuRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId("setup_select_manual_team")
                .setPlaceholder(`Choose a team to change configuration bounds...`)
                .addOptions(pageOptions) 
        );

        const navRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`nav_manual_roles_page_${page - 1}`)
                .setLabel("◀️ Prev")
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`nav_manual_roles_page_${page + 1}`)
                .setLabel("Next ▶️")
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page >= totalPages - 1),
            new ButtonBuilder()
                .setCustomId("nav_roles_dashboard")
                .setLabel("Back")
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ embeds: [embed], components: [menuRow, navRow] });
    },

    async syncSleeperTeamRoles(interaction, supabase) {
        const { data: config } = await supabase
            .from("league_configs")
            .select("sleeper_id")
            .eq("guild_id", interaction.guild.id)
            .single();

        if (!config?.sleeper_id) {
            return await interaction.reply({ content: "❌ Please configure a valid **League ID** first.", ephemeral: true });
        }

        if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();

        // Track active page placement via the button trigger if present
        let page = 0;
        if (interaction.customId && interaction.customId.includes("page_")) {
            page = parseInt(interaction.customId.split("page_")[1]) || 0;
        }

        try {
            // Fetch both endpoints simultaneously to isolate primary owners
            const [usersRes, rostersRes] = await Promise.all([
                fetch(`https://api.sleeper.app/v1/league/${config.sleeper_id}/users`),
                fetch(`https://api.sleeper.app/v1/league/${config.sleeper_id}/rosters`)
            ]);

            const sleeperUsers = await usersRes.json();
            const sleeperRosters = await rostersRes.json();

            if (!sleeperUsers || !sleeperRosters) {
                return await interaction.followUp({ content: "❌ Failed to grab active league records from Sleeper.", ephemeral: true });
            }

            // Build unique set of primary owners
            const primaryOwnerIds = new Set(sleeperRosters.map(roster => roster.owner_id).filter(Boolean));
            const primaryUsers = sleeperUsers.filter(user => primaryOwnerIds.has(user.user_id));
            const serverRoles = await interaction.guild.roles.fetch();

            const matchedTeams = [];
            const unmatchedTeams = [];
            const finalMappingPayload = {};
            const cleanStr = (str) => String(str).toLowerCase().replace(/[^a-z0-9]/g, '').trim();

            primaryUsers.forEach(user => {
                const username = user.display_name || "Unknown Manager";
                const officialTeamName = user.metadata?.team_name || `${username}'s Team`;

                const cleanTeamKey = cleanStr(officialTeamName);
                const cleanUserKey = cleanStr(username);

                const matchingRole = serverRoles.find(role => {
                    const cleanRoleName = cleanStr(role.name);
                    return cleanRoleName === cleanTeamKey || cleanRoleName === cleanUserKey;
                });

                if (matchingRole) {
                    finalMappingPayload[user.user_id] = { teamName: officialTeamName, roleId: matchingRole.id, roleName: matchingRole.name };
                    matchedTeams.push(`🟢 **${officialTeamName}** ➔ <@&${matchingRole.id}>`);
                } else {
                    finalMappingPayload[user.user_id] = { teamName: officialTeamName, roleId: null, roleName: null };
                    unmatchedTeams.push(`⚪ **${officialTeamName}** ➔ *(Unmatched)*`);
                }
            });

            // Cache the full data internally for database commit functions
            global.pendingDashboardRoles = global.pendingDashboardRoles || {};
            global.pendingDashboardRoles[interaction.guild.id] = finalMappingPayload;

            // Combine arrays forcing active synced matches directly to the top of the stack!
            const combinedAuditLines = [...matchedTeams, ...unmatchedTeams];

            // Cleanly slice entries into 12 items per page to guarantee it fits mobile layouts perfectly
            const itemsPerPage = 12;
            const totalPages = Math.ceil(combinedAuditLines.length / itemsPerPage);
            const startOffset = page * itemsPerPage;
            const displayLines = combinedAuditLines.slice(startOffset, startOffset + itemsPerPage);

            const auditEmbed = new EmbedBuilder()
                .setTitle("🏈 Roster Role Synchronization Audit")
                .setDescription(
                    `Pulled **${primaryUsers.length}** primary franchises (Co-owners ignored).\n` +
                    `🟢 Auto-matched accounts are grouped at the top.\n\n` +
                    `📖 **Page ${page + 1} of ${totalPages}**\n` +
                    `--------------------------------------\n` +
                    displayLines.join('\n')
                )
                .setColor(0xf39c12)
                .addFields(
                    { name: "🔗 Auto-Matched", value: `**${matchedTeams.length}** Roles`, inline: true },
                    { name: "❌ Unmatched", value: `**${unmatchedTeams.length}** Teams`, inline: true }
                )
                .setFooter({ text: `Total Tracked Records: ${combinedAuditLines.length}` });

            const confirmationButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`setup_sync_team_roles_page_${page - 1}`)
                    .setLabel("◀️ Prev")
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    .setCustomId(`setup_sync_team_roles_page_${page + 1}`)
                    .setLabel("Next ▶️")
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page >= totalPages - 1),
                new ButtonBuilder()
                    .setCustomId("setup_confirm_save_roles")
                    .setLabel("Save Team Roles")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId("nav_roles_dashboard")
                    .setLabel("Discard")
                    .setStyle(ButtonStyle.Danger)
            );

            await interaction.editReply({ embeds: [auditEmbed], components: [confirmationButtons] });

        } catch (err) {
            console.error(err);
            return await interaction.followUp({ content: "❌ Network error connecting to Sleeper.", ephemeral: true });
        }
    },

    async  sendDiscordConfig(interaction, supabase) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();

        // Pull setup parameters live from Supabase (Added vault_password to selection)
        const { data: config } = await supabase
            .from("league_configs")
            .select("admin_role_id, trade_channel_id, trade_role_id, vault_password")
            .eq("guild_id", interaction.guild.id)
            .single();

        const embed = new EmbedBuilder()
            .setTitle("⚙️ Discord Interface Configuration")
            .setDescription("Manage server infrastructure rules, routing targets, and administrative role hierarchies.")
            .setColor(0x34495e)
            .addFields(
                { 
                    name: "🛡️ Admin/Commish Role", 
                    value: config?.admin_role_id ? `<@&${config.admin_role_id}>` : "`None Assigned (Defaults to Server Admin)`", 
                    inline: false 
                },
                { 
                    name: "📢 Trade Alerts Channel", 
                    value: config?.trade_channel_id ? `<#${config.trade_channel_id}>` : "❌ *Not Configured*", 
                    inline: true 
                },
                { 
                    name: "🔔 Trade Notification Ping", 
                    value: config?.trade_role_id ? `<@&${config.trade_role_id}>` : "⚠️ *No Role Ping Assigned*", 
                    inline: true 
                },
                { // ✨ Added this visual status anchor field block
                    name: "🔒 Admin Vault Status",
                    value: config?.vault_password ? "🟢 Password Configured" : "🔴 Password Not Set",
                    inline: false
                }
            )
            .setFooter({ text: "Changes save automatically upon selection changes." });

        const discordMenuRows = [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("cfg_sub_admin").setLabel("🔑 Admin Config").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId("cfg_sub_trade").setLabel("📤 Trade Config").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId("cfg_sub_appeals").setLabel("⚖️ Appeals Config").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId("nav_main").setLabel("↩️ Main Dashboard").setStyle(ButtonStyle.Danger)
            )
        ];

        await interaction.editReply({
            embeds: [embed],
            components: discordMenuRows
        });
    },

    // 🆕 ADMIN SELECTION SUB-MENU (UPDATED TO INCLUDE LOGS CHANNEL)
    async sendAdminConfigMenu(interaction, supabase) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();

        // Added log_channel_id to the database query selection string
        const { data: config } = await supabase
            .from("league_configs")
            .select("admin_role_id, vault_password, log_channel_id, audit_ping_role_id")
            .eq("guild_id", interaction.guild.id)
            .single();

        const isPasswordSet = config?.vault_password ? "🔒 Configured & Secure" : "❌ Not Set";
        const logChannelDisplay = config?.log_channel_id ? `<#${config.log_channel_id}>` : "❌ *Not Configured*";
        const pingRoleDisplay = config?.audit_ping_role_id ? `<@&${config.audit_ping_role_id}>` : "❌ *Not Configured*";

        const embed = new EmbedBuilder()
            .setTitle("🔑 Commissionership Role & System Configuration")
            .setDescription("Define administrative authorization overrides, set up your secure vault bypass passphrase, and route default system transaction logs.")
            .setColor(0x3498db)
            .addFields(
                { name: "🔑 Vault Password Status", value: `\`${isPasswordSet}\``, inline: true },
                { name: "📁 System Logs Channel", value: logChannelDisplay, inline: true },
                { name: "🔔 Salary Alert Ping Role", value: pingRoleDisplay, inline: false }
            );

        // Component Row 1: Role Selection
        const adminRoleRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId("setup_select_admin_role")
                .setPlaceholder(config?.admin_role_id ? "Update Admin/Commish Role restriction..." : "Select an Admin/Commish Role...")
        );


        const pingRoleRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId("setup_select_audit_ping_role") // 👈 Make sure to handle this CustomId in your interaction handler!
                .setPlaceholder(config?.audit_ping_role_id ? "Change Salary Alert Ping Role..." : "Select Salary Alert Ping Role...")
        );
        // Component Row 2: NEW! Channel dropdown moved here
        const logChannelRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId("setup_log_channel")
                .setPlaceholder(config?.log_channel_id ? "Change System Logs Channel..." : "Select System Logs Channel...")
                .setChannelTypes(ChannelType.GuildText)
        );

        // Component Row 3: Action Buttons
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("setup_vault_config_btn")
                .setLabel("Set Vault Password")
                .setEmoji("🔑")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId("nav_discord")
                .setLabel("↩️ Back to Main Config")
                .setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({ 
            embeds: [embed], 
            components: [adminRoleRow, pingRoleRow, logChannelRow, backRow] 
        });
    },

    // 🆕 TRADE CONFIGURATION SUB-MENU
    async sendTradeConfigMenu(interaction, supabase) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
        const { data: config } = await supabase.from("league_configs").select("trade_channel_id, trade_role_id").eq("guild_id", interaction.guild.id).single();

        const embed = new EmbedBuilder()
            .setTitle("📤 Trade Market Notification Routing")
            .setDescription("Configure where market activities post and which group pings upon listing actions.")
            .setColor(0x2ecc71);

        const tradeChannelRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder().setCustomId("setup_trade_channel").setPlaceholder("Select Trade Alerts Log Channel...").setChannelTypes(ChannelType.GuildText)
        );

        const tradeRoleRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId("setup_trade_role").setPlaceholder("Select Trade Alert Ping Role...")
        );

        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("nav_discord").setLabel("↩️ Back to Main Config").setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({ embeds: [embed], components: [tradeChannelRow, tradeRoleRow, backRow] });
    },

    // 🆕 APPEALS CONFIGURATION SUB-MENU
    // ⚙️ APPEALS CONFIGURATION SUB-MENU (UPDATED)
    async sendAppealsConfigMenu(interaction, supabase) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();

        // 🛠️ Fetch the newly created table parameters
        const { data: config } = await supabase
            .from("league_configs")
            .select("appeals_channel_id, appeal_votes_required")
            .eq("guild_id", interaction.guild.id)
            .single();

        const votesRequired = config?.appeal_votes_required ?? "3 (Default)";
        const channelDisplay = config?.appeals_channel_id ? `<#${config.appeals_channel_id}>` : "❌ *Not Configured*";

        const embed = new EmbedBuilder()
            .setTitle("⚖️ System Appeals & Verification Panels")
            .setDescription("Configure user interaction routing paths for panel suspension adjustments and case voting rules.")
            .setColor(0x95a5a6)
            .addFields(
                { name: "📊 Votes Needed to Progress", value: `\`${votesRequired} votes\``, inline: true },
                { name: "📁 Appeals Log Channel", value: channelDisplay, inline: true }
            );

        // Component 1: Button to open the Modal for number of votes
        const actionButtonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("setup_appeals_votes_btn")
                .setLabel("🔢 Set Required Votes")
                .setStyle(ButtonStyle.Primary)
        );

        // Component 2: Channel dropdown selection menu
        const channelSelectRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId("setup_appeals_channel")
                .setPlaceholder("Select Appeals Log Channel...")
                .setChannelTypes(ChannelType.GuildText)
        );

        // Component 3: Navigation Back Button
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("nav_discord").setLabel("↩️ Back to Main Config").setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({ 
            embeds: [embed], 
            components: [actionButtonRow, channelSelectRow, backRow] 
        });
    },

    async showSheetsModal(interaction, supabase) {
        // Added supabase here
        // Fetch existing config from Supabase
        const { data: config } = await supabase
            .from("league_configs")
            .select("sheet_id, tab_players, tab_logs")
            .eq("guild_id", interaction.guild.id)
            .single();

        const modal = new ModalBuilder()
            .setCustomId("modal_setup_sheets")
            .setTitle("Google Sheets Configuration");

        const sheetIdInput = new TextInputBuilder()
            .setCustomId("in_sheet_id")
            .setLabel("Google Sheet ID")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("Enter your long Sheet ID string...")
            .setValue(config?.sheet_id || "") // PRE-FILLS THE ID
            .setRequired(true);

        const playersTabInput = new TextInputBuilder()
            .setCustomId("in_tab_players")
            .setLabel("Players Tab Name")
            .setPlaceholder("e.g., MasterPlayerList")
            .setStyle(TextInputStyle.Short)
            .setValue(config?.tab_players || "PlayerList") // PRE-FILLS TAB NAME
            .setRequired(true);

        const logsTabInput = new TextInputBuilder()
            .setCustomId("in_tab_logs")
            .setLabel("Transactions Tab Name (Optional)")
            .setPlaceholder("e.g., Transaction Log")
            .setStyle(TextInputStyle.Short)
            .setValue(config?.tab_logs || "")
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(sheetIdInput),
            new ActionRowBuilder().addComponents(playersTabInput),
            new ActionRowBuilder().addComponents(logsTabInput),
        );

        await interaction.showModal(modal);
    },

    async showSleeperModal(interaction, supabase) {
        const { data: config } = await supabase
            .from("league_configs")
            .select("sleeper_id")
            .eq("guild_id", interaction.guild.id)
            .single();

        const modal = new ModalBuilder()
            .setCustomId("modal_setup_sleeper")
            .setTitle("Sleeper and Miscellanious Settings");

        const sleeperIdInput = new TextInputBuilder()
            .setCustomId("in_sleeper_id")
            .setLabel("Sleeper League ID")
            .setPlaceholder("Enter your 18-digit Sleeper ID")
            .setStyle(TextInputStyle.Short)
            // 2. Pre-fill the value here!
            .setValue(config?.sleeper_id || "")
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(sleeperIdInput),
        );

        await interaction.showModal(modal);
    },

    async handleChannelSelect(interaction, supabase) {
        if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();

        const channelId = interaction.values[0];

        try {
            const { error } = await supabase.from("league_configs").upsert(
                {
                    guild_id: interaction.guild.id,
                    log_channel_id: channelId,
                },
                { onConflict: "guild_id" },
            );

            if (error) {
                console.error("🚨 DB ERROR SAVING CHANNEL:", error);
                return interaction.followUp({
                    content: `❌ Database Error: ${error.message}`,
                    ephemeral: true
                });
            }

            // SUCCESS REFRESH: Routes directly back to Admin view to show changes instantly
            return await this.sendAdminConfigMenu(interaction, supabase);

        } catch (err) {
            console.error("🚨 CRASH IN CHANNEL SELECT:", err);
            return interaction.followUp({
                content: "❌ Internal logic error.",
                ephemeral: true
            });
        }
    },

    async handleSleeperSubmit(interaction, supabase) {
        const sleeperId = interaction.fields.getTextInputValue("in_sleeper_id");

        try {
            // 1. Fetch league name from Sleeper
            const response = await fetch(
                `https://api.sleeper.app/v1/league/${sleeperId}`,
            );
            const leagueData = await response.json();

            if (!leagueData || !leagueData.name) {
                return interaction.reply({
                    content:
                        "❌ Invalid Sleeper ID. Please check the number and try again.",
                });
            }

            const leagueName = leagueData.name;

            // 2. Save to Supabase
            const { error } = await supabase.from("league_configs").upsert(
                {
                    guild_id: interaction.guild.id,
                    sleeper_id: sleeperId,
                    sleeper_name: leagueName, // Make sure this column exists in your DB!
                },
                { onConflict: "guild_id" },
            );

            if (error) {
                console.error("🚨 Supabase Error:", error);
                return interaction.reply({
                    content: `❌ Database Error: ${error.message}`,
                });
            }

            // 3. Success! Return to dashboard
            return await this.sendSleeperMenu(interaction, supabase);
        } catch (err) {
            // THIS WAS THE MISSING PIECE CAUSING THE CRASH
            console.error("🚨 Sleeper API/Submit Error:", err);
            return interaction.reply({
                content: "❌ Failed to connect to Sleeper API or save data.",
            });
        }
    },
    // 6. TOGGLE AUDIT MODE
    async toggleAudit(interaction, supabase) {
        try {
            // 1. Fetch the FULL existing config
            const { data: config, error: fetchError } = await supabase
                .from("league_configs")
                .select("*")
                .eq("guild_id", interaction.guild.id)
                .single();

            // 2. SAFETY CHECK: If no sheet is linked, they shouldn't be toggling audits yet
            if (!config || !config.sheet_id) {
                return interaction.reply({
                    content:
                        "⚠️ **Setup Required:** Please link your Google Sheet using the button above before enabling Audit Mode.",
                });
            }

            const newStatus = !config.audit_enabled;

            // 3. Update database - Include the existing sheet_id to satisfy the constraint
            const { error: upsertError } = await supabase
                .from("league_configs")
                .upsert({
                    guild_id: interaction.guild.id,
                    sheet_id: config.sheet_id, // Pass back the existing ID
                    audit_enabled: newStatus,
                });

            if (upsertError) throw upsertError;

            // 4. Update the dashboard
            return await this.sendDashboard(interaction, supabase, true);
        } catch (err) {
            console.error("❌ Toggle Error:", err);
            return interaction.reply({
                content: `❌ Toggle failed: ${err.message}`,
            });
        }
    },
};
