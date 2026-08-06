const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js");
const { supabase } = require("../utils/supabaseClient");

function getLastOfferSender(historyText) {
    if (!historyText) return "GM"; // Default initial state

    const lines = historyText.split("\n");

    // Look backward through lines for actual offers/counters (ignore plain chat messages)
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];

        // Match Agent Counter
        if (line.includes("[Agent Counter]")) {
            return "AGENT";
        }
        // Match GM Offer or GM Counter
        if (line.includes("[GM Initial Offer]") || line.includes("[GM Counter]")) {
            return "GM";
        }
    }

    return "GM"; // Fallback default
}

// Formats history entries with large header numbers and regular indented notes
function formatHistoryEntry(type, userTag, years, aav, bonus, note) {
    const isGm = type.toLowerCase().includes("gm");
    const icon = isGm ? "👔" : "🤝";

    const formattedAav = formatCurrency(aav);
    const bonusText = bonus ? ` + **${formatCurrency(bonus)}** Bonus` : "";
    const noteText = (note && note !== "*No custom notes provided.*" && note !== "No custom notes provided.") 
        ? `\n> 💬 *"${note}"*` 
        : "";

    // Bold large line replacement that renders perfectly inside Embed Fields!
    return `${icon} **[${type}]** — *${userTag}*\n📄 **${years} Yrs @ ${formattedAav}/yr**${bonusText}${noteText}`;
}

function formatCurrency(val) {
    if (!val) return "0";

    // If it's already in short notation like "2.1M" or "500k", just return it cleaned up
    if (typeof val === "string" && /[0-9.]+[kMbB]/i.test(val)) {
        return val.replace(/[`$]/g, "").trim();
    }

    // Convert raw numeric strings (e.g., "2100000" or "2,100,000")
    let num = parseFloat(val.toString().replace(/[^0-9.]/g, ""));
    if (isNaN(num)) return val;

    if (num >= 1_000_000) {
        return `${(num / 1_000_000).toFixed(2).replace(/\.00$/, "").replace(/(\.[1-9])0$/, "$1")}M`;
    } else if (num >= 1_000) {
        return `${(num / 1_000).toFixed(2).replace(/\.00$/, "").replace(/(\.[1-9])0$/, "$1")}k`;
    }

    return `${num}`;
}

function buildGmActionRow(actionType, params, historyText = "") {
    const { safePlayerName, safeTeamName, assignedAgentId, agentChannelId } = params;

    if (actionType === "CLOSED") return [];

    const acceptBtn = new ButtonBuilder()
        .setCustomId(`gm_accept_${safePlayerName}_${safeTeamName}_${assignedAgentId}_${agentChannelId}`)
        .setLabel("👍 Accept Offer")
        .setStyle(ButtonStyle.Success);

    const counterBtn = new ButtonBuilder()
        .setCustomId(`gm_counter_${safePlayerName}_${safeTeamName}_${assignedAgentId}_${agentChannelId}`)
        .setLabel("✍️ Counter Back")
        .setStyle(ButtonStyle.Secondary);

    const messageBtn = new ButtonBuilder()
        .setCustomId(`gm_message_${safePlayerName}_${safeTeamName}_${assignedAgentId}_${agentChannelId}`)
        .setLabel("💬 Message Agent")
        .setStyle(ButtonStyle.Primary);

    const withdrawBtn = new ButtonBuilder()
        .setCustomId(`gm_decline_${safePlayerName}_${safeTeamName}_${assignedAgentId}_${agentChannelId}`)
        .setLabel("👎 Withdraw Offer")
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder();
    const lastSender = getLastOfferSender(historyText);

    // Only include Accept if AGENT made the last actual financial move
    if (lastSender === "AGENT") {
        row.addComponents(acceptBtn);
    }

    // Counter, Message, and Withdraw are always available during open negotiations
    row.addComponents(counterBtn, messageBtn, withdrawBtn);

    return [row];
}

function buildAgentActionRow(params, historyText = "") {
    const { safePlayerName, safeTeamName, gmChannelId, masterMessageId } = params;

    const row = new ActionRowBuilder();
    const lastSender = getLastOfferSender(historyText);

    // Only include Approve if GM made the last actual offer/counter
    if (lastSender === "GM") {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`agent_approve_${safePlayerName}_${safeTeamName}_${masterMessageId}_${gmChannelId}`)
                .setLabel("👍 Approve")
                .setStyle(ButtonStyle.Success)
        );
    }

    // Counter, Message, and Reject remain available for the Agent
    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`agent_counter_${safePlayerName}_${safeTeamName}_${masterMessageId}_${gmChannelId}`)
            .setLabel("✍️ Counter Back")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`agent_message_${safePlayerName}_${safeTeamName}_${masterMessageId}_${gmChannelId}`)
            .setLabel("💬 Message GM")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`agent_reject_${safePlayerName}_${safeTeamName}_${masterMessageId}_${gmChannelId}`)
            .setLabel("👎 Reject")
            .setStyle(ButtonStyle.Danger)
    );

    return [row];
}

// Add this helper function inside login.js
async function handleFreeAgencyHub(interaction) {
    const devEmbed = new EmbedBuilder()
        .setTitle("🏈 Free Agency Hub — Under Development")
        .setDescription(
            "The **Free Agency Hub** is currently under construction for the upcoming off-season!\n\n" +
            "**Planned Features:**\n" +
            "• 🏷️ Submit blind bids on open Free Agents\n" +
            "• 📊 Real-time cap space tracking for pending offers\n" +
            "• ⏱️ Live auction & contract length counters\n\n" +
            "*Check back soon or please ping NK for an update!*"
        )
        .setColor(0xF1C40F)
        .setFooter({ text: "Franchise Front Office • Module Locked" })
        .setTimestamp();

    return await interaction.reply({
        embeds: [devEmbed],
        ephemeral: true
    });
}

module.exports = {
    
    data: new SlashCommandBuilder()
        .setName("login")
        .setDescription("Securely authenticate and launch your Front Office Command Portal."),
    

    // 🟢 FIXED: Added 'currentConfig' in the 3rd slot so getSheetData maps to the 4th slot properly
    async execute(interaction, supabase, currentConfig, getSheetData) {
        await interaction.reply({ content: "⏳ Authenticated session initializing... Loading Front Office Portal...", ephemeral: false });

        const guildId = interaction.guildId;
        const memberRoles = interaction.member.roles.cache.map(role => role.id);

        try {
            // Since index.js already fetches the config payload as 'currentConfig',
            // we can reuse it immediately or fall back to checking Supabase if it's missing!
            const config = currentConfig || (await supabase
                .from("league_configs")
                .select("sleeper_team_roles, column_mapping")
                .eq("guild_id", guildId)
                .single()).data;

            if (!config || !config.sleeper_team_roles) {
                return await interaction.editReply("🚨 **Database Error:** Link metrics could not be fetched for this server.");
            }

            let matchedTeamName = null;

            for (const [topLevelKey, details] of Object.entries(config.sleeper_team_roles)) {
                const mainKey = String(topLevelKey).trim();
                const nestedRoleId = details.roleId ? String(details.roleId).trim() : null;

                if (memberRoles.includes(mainKey) || (nestedRoleId && memberRoles.includes(nestedRoleId))) {
                    matchedTeamName = details.teamName;
                    break;
                }
            }

            if (!matchedTeamName) {
                return await interaction.editReply("❌ **Access Denied:** Your server roles do not map to an authorized franchise.");
            }

            // 🟢 FIXED: This will now evaluate correctly as a valid function call!
            const { doc } = await getSheetData(guildId);
            let capSpace = "$Unknown";
            let extensionsLeft = "Unknown";

            const mapping = config.column_mapping || {};
            const capCell = mapping.team_cap;   
            const extCell = mapping.team_ext;   

            if (doc) {
                const sheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(matchedTeamName.toLowerCase()));
                if (sheet) {
                    await sheet.loadCells([capCell, extCell]);
                    capSpace = sheet.getCellByA1(capCell).formattedValue || "$0.00";
                    extensionsLeft = sheet.getCellByA1(extCell).value ?? "0";
                }
            }

            // Construct Portal Hub Embed
            const portalEmbed = new EmbedBuilder()
                .setTitle(`💼 FRANCHISE PORTAL: ${matchedTeamName.toUpperCase()}`)
                .setDescription("Welcome to your private front-office workspace. Select an operation below to securely manage your franchise finances without revealing your strategies to rivals.")
                .setColor(0x2b2d31) 
                .addFields(
                    { name: "💰 Cap Space Balance", value: `**${capSpace}**`, inline: true },
                    { name: "⏳ Extensions Left", value: `**${extensionsLeft}**`, inline: true }
                )
                .setFooter({ text: "Authenticated Session • Vault Secure" })
                .setTimestamp();

            // Component Row 1: Action Buttons
            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`portal_restructure_${matchedTeamName}`)
                    .setLabel("🧮 Restructure Calc")
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`portal_extension_${matchedTeamName}`)
                    .setLabel("⏳ Request Extension")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                .setCustomId(`portal_fa_${matchedTeamName}`)
                .setLabel("Free Agency Hub") // Clean label text
                .setEmoji("🏈")             // Separate emoji method
                .setStyle(ButtonStyle.Secondary)
            );

            // Component Row 2: Utility Dropdown
            const toolRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`portal_secrets_${matchedTeamName}`)
                    .setLabel("🔍 Bot Commands(Use Secretly)")
                    .setStyle(ButtonStyle.Primary) // Primary (Blurple) or Premium (Secondary/Success) as you prefer
            );

            await interaction.editReply({
                embeds: [portalEmbed],
                components: [actionRow, toolRow]
            });

        } catch (err) {
            console.error("❌ Portal launch initialization error:", err);
            await interaction.editReply("💥 An error occurred while opening your front office portal.");
        }
    },
    // 🟢 ADD THIS: Intercepts the button click to display the form pop-up
    async handleSecretsButton(interaction) {
        const secretMenuRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId("portal_secret_menu_choice")
                .setPlaceholder("⚡ Choose a command to run privately...")
                .addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel("📊 View Team Finances (/team)")
                        .setDescription("Search a team's contract lengths and cap hits privately.")
                        .setValue("team")
                        .setEmoji("📋"),
                    new StringSelectMenuOptionBuilder()
                        .setLabel("💸 Calculate Salary (/salary)")
                        .setDescription("Run salary evaluations privately.")
                        .setValue("salary")
                        .setEmoji("💰")
                )
        );

        return await interaction.reply({
            content: "🕵️ **Anything you run will be out of sight for everyone else.",
            components: [secretMenuRow],
            flags: [64] // Ephemeral: true
        });
    },

    async handleSecretMenuChoice(interaction) {
        const chosenCmd = interaction.values[0]; // 'team' or 'salary'

        const modal = new ModalBuilder()
            .setCustomId(`portal_secret_modal_${chosenCmd}`)
            .setTitle(`🕵️ Private /${chosenCmd} Query`);

        const targetInput = new TextInputBuilder()
            .setCustomId("secret_cmd_target")
            .setLabel(chosenCmd === "salary" ? "Enter Player Name" : "Enter Team Name")
            .setPlaceholder(chosenCmd === "salary" ? "e.g., Patrick Mahomes" : "e.g., Dallas Cowboys")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(targetInput));
        return await interaction.showModal(modal);
    },

    // 🟢 ADD THIS: Process the submitted search input privately
    async handleSecretModalSubmit(interaction, supabase, currentConfig, getSheetData, getPlayerStats, getOwnerIdMap) {
        try {
            // Extracts 'team' or 'salary' from 'portal_secret_modal_team'
            const cmdType = interaction.customId.replace("portal_secret_modal_", "");
            const cmdTarget = interaction.fields.getTextInputValue("secret_cmd_target").trim();

            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ flags: [64] }); // Ephemeral
            }

            interaction.options = {
                getString: (name) => cmdTarget, 
                getUser: (name) => null,
                getMember: (name) => null,
                getInteger: (name) => null,
                getBoolean: (name) => null
            };

            if (cmdType === "salary") {
                const salaryCommand = interaction.client.commands.get("salary");
                if (!salaryCommand) return await interaction.editReply("❌ Module error: `/salary` command file not found.");
                return await salaryCommand.execute(interaction, supabase, currentConfig, getSheetData, getPlayerStats, getOwnerIdMap);
            }

            if (cmdType === "team") {
                const teamCommand = interaction.client.commands.get("team");
                if (!teamCommand) return await interaction.editReply("❌ Module error: `/team` command file not found.");
                return await teamCommand.execute(interaction, supabase, currentConfig, getSheetData, getPlayerStats, getOwnerIdMap);
            }

        } catch (modalErr) {
            console.error("❌ Fatal crash in secret modal executor:", modalErr);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: "💥 An error occurred processing your secret query.", flags: [64] });
            } else {
                await interaction.editReply("💥 An error occurred processing your secret query.");
            }
        }
    },

    async handleRestructureButton(interaction) {
        const modal = new ModalBuilder()
            .setCustomId("portal_restructure_modal")
            .setTitle("🧮 Restructure Cap Calculator");

        const playerNameInput = new TextInputBuilder()
            .setCustomId("restructure_player_name")
            .setLabel("Player Name")
            .setPlaceholder("e.g., Patrick Mahomes")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const convertAmountInput = new TextInputBuilder()
            .setCustomId("restructure_amount")
            .setLabel("Amount to Convert into Bonus")
            .setPlaceholder("e.g., 10000000 (Or type 'MAX')")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(playerNameInput),
            new ActionRowBuilder().addComponents(convertAmountInput)
        );

        return await interaction.showModal(modal);
    },

    async handleRestructureModalSubmit(interaction, supabase, currentConfig, getSheetData) {
        try {
            await interaction.deferReply(); // Keep it private

            const targetName = interaction.fields.getTextInputValue("restructure_player_name").toLowerCase().trim();
            const rawAmount = interaction.fields.getTextInputValue("restructure_amount").toUpperCase().trim();

            const guildId = interaction.guildId;
            const { players } = await getSheetData(guildId);

            // Find player in the dataset
            const player = players.find(p => p && (p.name || p.playerName || p.rowRef?.get("Player Name"))?.toLowerCase().includes(targetName));

            if (!player) {
                return await interaction.editReply(`❌ Player **${interaction.fields.getTextInputValue("restructure_player_name")}** not found in roster data.`);
            }

            // Extract contract specifics (Adjust keys to match your column layout mapping)
            const currentSalaryStr = player.salary || player.aav || player.rowRef?.get("Salary");
            const currentSalary = parseFloat(String(currentSalaryStr).replace(/[$,]/g, ""));

            const yearsLeft = parseInt(player.yearsLeft || player.rowRef?.get("Years Left"));

            if (currentSalary <= 0) {
                return await interaction.editReply(`❌ Could not calculate restructure: Player base salary is registered as $0.`);
            }

            // Calculate conversion pool
            // 🟢 UPDATED: Parse amount as Millions by default
            let convertAmount = 0;
            if (rawAmount === "MAX") {
                convertAmount = (currentSalary - 1210000); // Leaves veteran minimum if MAX
            } else {
                const parsedNum = parseFloat(rawAmount.replace(/[$,M]/g, ""));
                // If they typed a small number like 20 or 5.5, treat it as Millions. 
                // If they typed 20000000, keep it raw.
                convertAmount = parsedNum < 1000 ? parsedNum * 1000000 : parsedNum;
            }

            if (isNaN(convertAmount) || convertAmount <= 0 || convertAmount >= currentSalary) {
                return await interaction.editReply(`❌ Invalid amount. Must be a positive number less than their current salary of **${currentSalaryStr}**.`);
            }

            // Restructure Math calculations
            const bonusProration = convertAmount / yearsLeft;
            const currentYearCapSavings = convertAmount - bonusProration;
            const newBaseSalary = currentSalary - convertAmount;
            const newCapHit = newBaseSalary + (bonusProration); // simplified for current year comparison

            const calcEmbed = new EmbedBuilder()
                .setTitle(`🧮 Restructure Projection: ${player.name || "Player"}`)
                .setColor(0x2ecc71)
                .setDescription(`Projections converting **$${convertAmount.toLocaleString()}** of base salary into a signing bonus prorated over **${yearsLeft} years**.`)
                .addFields(
                    { name: "📉 Current Cap Hit", value: `\`$${currentSalary.toLocaleString()}\``, inline: true },
                    { name: "📈 Projected New Cap Hit", value: `\`$${newCapHit.toLocaleString()}\``, inline: true },
                    { name: "💰 Immediate Cap Savings", value: `**+$${currentYearCapSavings.toLocaleString()}**`, inline: false },
                    { name: "📋 Contract Outlook", value: `• **New Base Salary:** $${newBaseSalary.toLocaleString()}\n• **Added Yearly Proration:** +$${bonusProration.toLocaleString()}/yr` }
                )
                .setFooter({ text: "Click button to submit to the Commisioners" });

            const submitRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`portal_confirm_restructure_${player.name.replace(/\s+/g, '_')}_${convertAmount}`)
                    .setLabel("💼 Submit to Commissioner Office")
                    .setStyle(ButtonStyle.Success)
            );

            return await interaction.editReply({ 
                embeds: [calcEmbed], 
                components: [submitRow] // 🟢 Pass the button here
            });

        } catch (err) {
            console.error("❌ Restructure calculation error:", err);
            return await interaction.editReply("💥 An error occurred while computing the restructure math.");
        }
    },

    async handleConfirmRestructure(interaction, supabase, currentConfig, getSheetData) {
    try {
        await interaction.deferReply({ flags: [64] }); // Keep it private

        // Extract variables from the custom ID
        const parts = interaction.customId.split("_");
        const convertAmount = parseFloat(parts.pop()) || 0;
        const playerName = parts.slice(3).join(" ").replace(/_/g, " "); 

        const guildId = interaction.guildId;
        const config = currentConfig || (await supabase
            .from("league_configs")
            .select("log_channel_id, sleeper_team_roles")
            .eq("guild_id", guildId)
            .single()).data;

        const logChannelId = config?.log_channel_id; 
        if (!logChannelId) return await interaction.editReply("🚨 **Configuration Error:** No logging channel set.");

        const logChannel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
        if (!logChannel) return await interaction.editReply("🚨 **Channel Error:** Cannot access logging channel.");

        // 🟢 FIXED: Calling the passed-in getSheetData argument directly
        const { players } = await getSheetData(guildId);
        const player = players.find(p => p && (p.name || p.playerName || p.rowRef?.get("Player Name"))?.toLowerCase() === playerName.toLowerCase());

        if (!player) return await interaction.editReply("🚨 **Data Sync Error:** Player contract record could not be re-verified.");

            // Math execution for the explicit log blueprint
            const currentSalaryStr = player.salary || player.aav || player.rowRef?.get("Salary");
            const currentSalary = parseFloat(String(currentSalaryStr).replace(/[$,]/g, ""));
            const yearsLeft = parseInt(player.yearsLeft || player.rowRef?.get("Years Left"));

            const bonusProration = convertAmount / yearsLeft;
            const currentYearCapSavings = convertAmount - bonusProration;
            const newBaseSalary = currentSalary - convertAmount;
            const newCapHit = newBaseSalary + bonusProration;

            let subTeam = "Unknown Franchise";
            const memberRoles = interaction.member.roles.cache.map(r => r.id);
            for (const [key, details] of Object.entries(config.sleeper_team_roles || {})) {
                if (memberRoles.includes(key) || (details.roleId && memberRoles.includes(details.roleId))) {
                    subTeam = details.teamName;
                    break;
                }
            }

            // 🟢 NEW & IMPROVED: Complete structural administrative blueprint embed
            const commishLogEmbed = new EmbedBuilder()
                .setTitle(`💼 APPROVED TRANSACTION: Restructure Request`)
                .setColor(0xe67e22)
                .setDescription(`The **${subTeam.toUpperCase()}** have processed an official contract restructure via the Front Office Sandbox.`)
                .addFields(
                    { name: "🏈 Player Name", value: `**${player.name || playerName}**`, inline: true },
                    { name: "⏳ Contract Length", value: `\`${yearsLeft} Years Remaining\``, inline: true },
                    { name: "💰 Total Converted Amount", value: `\`$${convertAmount.toLocaleString()}\``, inline: false },

                    // Side-by-side financial blueprints
                    { name: "📉 BASE SALARY ADJUSTMENT", value: `• **Current Base:** $${currentSalary.toLocaleString()}`, inline: true },
                    { name: "📊 CAP HIT LOOKOUT", value: `• **Current Cap Hit:** $${currentSalary.toLocaleString()}\n• 🔥 **New Cap Hit:** $${newCapHit.toLocaleString()}`, inline: true },

                    // Clear action instructions
                    
                    { name: "Cap Savings", value: `Clears **$${currentYearCapSavings.toLocaleString()}** in immediate cap space.` },
                    { name: "👤 Requested By", value: `${interaction.user}` }
                )
                .setTimestamp()
                .setFooter({ text: "Action Required • Update Master Spreadsheet Ledger" });

            await logChannel.send({ embeds: [commishLogEmbed] });

            await interaction.editReply({ 
                content: `✅ **Transaction Logged!** The ledger blueprint has been transmitted to the Commish office.`,
                components: [] 
            });

        } catch (err) {
            console.error("❌ Error sending restructure transaction to log channel:", err);
            return await interaction.editReply("💥 An error occurred while routing this deal to the commissioner channel.");
        }
    },

    

    async handleExtensionButton(interaction) {
        const modal = new ModalBuilder()
            .setCustomId("portal_extension_modal")
            .setTitle("⏳ Request Player Extension");

        const playerNameInput = new TextInputBuilder()
            .setCustomId("ext_player_name")
            .setLabel("Player Name")
            .setPlaceholder("e.g., Lamar Jackson")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const yearsInput = new TextInputBuilder()
            .setCustomId("ext_years")
            .setLabel("Number of Years")
            .setPlaceholder("e.g., 3")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const aavInput = new TextInputBuilder()
            .setCustomId("ext_aav")
            .setLabel("Contract AAV ($)")
            .setPlaceholder("e.g., 25000000 or 25M")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const bonusInput = new TextInputBuilder()
            .setCustomId("ext_bonus")
            .setLabel("Bonus")
            .setPlaceholder("e.g., 1.5M for 2000 yds")
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        const messageInput = new TextInputBuilder()
            .setCustomId("ext_message")
            .setLabel("Message to Agent")
            .setPlaceholder("e.g., Man, you are a superstar. We want to lock you down.")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false); // Optional field

        modal.addComponents(
            new ActionRowBuilder().addComponents(playerNameInput),
            new ActionRowBuilder().addComponents(yearsInput),
            new ActionRowBuilder().addComponents(aavInput),
            new ActionRowBuilder().addComponents(bonusInput),
            new ActionRowBuilder().addComponents(messageInput)
        );

        return await interaction.showModal(modal);
    },

    async handleExtensionModalSubmit(interaction, supabase, currentConfig, getSheetData) {
        try {
            await interaction.deferReply();

            // Clean financial inputs into raw numbers (e.g., 25M -> 25000000)
            const parseFinancialValue = (str) => {
                const parsedNum = parseFloat(str.replace(/[$,m_k\s]/g, ""));
                if (isNaN(parsedNum)) return 0;
                if (str.includes("m")) return parsedNum * 1000000;
                if (str.includes("k")) return parsedNum * 1000;
                return parsedNum < 1000 ? parsedNum * 1000000 : parsedNum;
            };

            // Extract values from form input fields
            const targetName = interaction.fields.getTextInputValue("ext_player_name").trim();
            const rawYears = interaction.fields.getTextInputValue("ext_years").trim();
            const rawAav = interaction.fields.getTextInputValue("ext_aav").toLowerCase().trim();
            const rawBonus = interaction.fields.getTextInputValue("ext_bonus") || "0";
            const displayBonus = rawBonus ? rawBonus : "0";     
            const noteMessage = interaction.fields.getTextInputValue("ext_message").trim() || "*No custom notes provided.*";

            const guildId = interaction.guildId;

            // Fetch configuration for logging channel and team name mappings
            const config = currentConfig || (await supabase
                .from("league_configs")
                .select("log_channel_id, sleeper_team_roles")
                .eq("guild_id", guildId)
                .single()).data;

            const logChannelId = config?.log_channel_id;
            if (!logChannelId) return await interaction.editReply("🚨 **Configuration Error:** No logging channel set.");

            const logChannel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
            if (!logChannel) return await interaction.editReply("🚨 **Channel Error:** Cannot access logging channel.");

            

            const numYears = parseInt(rawYears) || 0;
            const finalAav = parseFinancialValue(rawAav);
            const finalBonus = parseFinancialValue(rawBonus);

            if (numYears <= 0) return await interaction.editReply("❌ **Validation Error:** Please enter a valid number of years.");
            if (finalAav <= 0) return await interaction.editReply("❌ **Validation Error:** Contract AAV must be greater than $0.");

            // Resolve the team name based on user roles
            let subTeam = "Unknown Franchise";
            const memberRoles = interaction.member.roles.cache.map(r => r.id);
            for (const [key, details] of Object.entries(config?.sleeper_team_roles || {})) {
                if (memberRoles.includes(key) || (details.roleId && memberRoles.includes(details.roleId))) {
                    subTeam = details.teamName;
                    break;
                }
            }

            // Total valuation calculations
            const totalContractValue = finalAav * numYears;

            const initialGmEntry = formatHistoryEntry(
                "GM Initial Offer", 
                interaction.user.username, 
                numYears, 
                finalAav, 
                displayBonus, 
                noteMessage
            );

            // Construct the log embed
            const extensionLogEmbed = new EmbedBuilder()
                .setTitle(`⏳ NEW TRANSACTION: Extension Request`)
                .setColor(0x2ecc71)
                .setDescription(`The **${subTeam.toUpperCase()}** have submitted a contract extension request.`)
                .addFields(
                    { name: "🏈 Player Target", value: `**${targetName}**`, inline: true },
                    { name: "⏳ Added Length", value: `\`${numYears} Years\``, inline: true },
                    { name: "💰 Annual AAV", value: `\`$${finalAav.toLocaleString()}\``, inline: true },
                    { name: "💵 Total New Value", value: `\`$${totalContractValue.toLocaleString()}\``, inline: true },
                    { name: "🔒 Bonus", value: `\`${formatCurrency(displayBonus)}\``, inline: true },
                    { name: "📊 Status", value: "🔴 **UNASSIGNED** (No Agent)", inline: true },
                    { name: "📜 Negotiation History", value: initialGmEntry, inline: false },
                    { name: "👤 Submitted By", value: `${interaction.user} (Front Office Representative)` }
                )
                .setTimestamp()
                .setFooter({ text: "Agent Assignment Queue" });

            const safePlayerName = targetName.replace(/\s+/g, "-");
            const safeTeamName = subTeam.replace(/\s+/g, "-");

            const tempGmMsg = await interaction.editReply({
                content: "⏳ **Processing submission...**",
                fetchReply: true
            });

            // 2. Build Agent Assign Button with GM Channel ID AND GM Message ID
            const assignButton = new ButtonBuilder()
                .setCustomId(`portal_assign_agent_${safePlayerName}_${safeTeamName}_${interaction.channelId}_${tempGmMsg.id}`)
                .setLabel("🙋 Represent Player (Self-Assign)")
                .setStyle(ButtonStyle.Primary);

            const logRow = new ActionRowBuilder().addComponents(assignButton);

            // 3. Send to Agent Queue Channel FIRST (This defines agentLogMsg!)
            const agentLogMsg = await logChannel.send({ 
                embeds: [extensionLogEmbed],
                components: [logRow]
            });

            // 4. NOW build buttonParams with defined agentLogMsg.id
            const buttonParams = {
                safePlayerName,
                safeTeamName,
                assignedAgentId: "unassigned",
                agentChannelId: logChannelId,
                agentMessageId: agentLogMsg.id,
                gmChannelId: interaction.channelId,
                masterMessageId: tempGmMsg.id
            };
            const gmActionRow = buildGmActionRow("OFFER", buttonParams, initialGmEntry);

            // 5. Update GM message with final content and action buttons
            await interaction.editReply({
                content: "✅ **Offer submitted successfully!** The Player's Agent has been notified.",
                embeds: [extensionLogEmbed],
                components: gmActionRow
            });

        } catch (err) {
            console.error("❌ Extension submission error:", err);
            return await interaction.editReply("💥 An error occurred while processing your extension request.");
        }
    },
    // 🙋 Handle Agent Self-Assignment Button Click
    async handleAgentAssignment(interaction) {
        try {
            const parts = interaction.customId.split("_");
            // Custom ID: ["portal", "assign", "agent", safePlayerName, safeTeamName, originChannelId, originMessageId]
            const safePlayerName = parts[3];
            const safeTeamName = parts[4];
            const rawOriginChannelId = parts[5];

            // Ensure channel ID is valid and not "undefined" string
            const originChannelId = (rawOriginChannelId && rawOriginChannelId !== "undefined") ? rawOriginChannelId : interaction.channelId;
            const originMessageId = parts[6];

            const agent = interaction.user;

            // 1. Grab current embed
            const oldEmbed = interaction.message.embeds[0];
            if (!oldEmbed) return;

            // Grab existing history string for turn checking
            const historyText = oldEmbed.fields.find(f => f.name.includes("Negotiation History"))?.value || "";

            // 2. Build yellow "Under Negotiation" embed
            const updatedEmbed = EmbedBuilder.from(oldEmbed)
                .setColor(0xf1c40f)
                .spliceFields(5, 1, { 
                    name: "📊 Status", 
                    value: `🟡 **UNDER NEGOTIATION**\n**Agent:** ${agent}`, 
                    inline: true 
                });

            // 3. Build Agent Action Buttons passing originChannelId safely
            const agentComponents = buildAgentActionRow({
                safePlayerName,
                safeTeamName,
                gmChannelId: originChannelId,
                masterMessageId: originMessageId
            }, historyText);

            // Update Agent Queue Channel
            await interaction.update({
                embeds: [updatedEmbed],
                components: agentComponents
            });

            // 4. Update GM's message in their original channel if available
            if (originChannelId && originMessageId && originMessageId !== "undefined") {
                const originChannel = await interaction.guild.channels.fetch(originChannelId).catch(() => null);

                if (originChannel) {
                    const gmMessage = await originChannel.messages.fetch(originMessageId).catch(() => null);

                    if (gmMessage) {
                        const gmComponents = buildGmActionRow("OFFER", {
                            safePlayerName,
                            safeTeamName,
                            assignedAgentId: agent.id,
                            agentChannelId: interaction.channelId
                        }, historyText);

                        await gmMessage.edit({
                            embeds: [updatedEmbed],
                            components: gmComponents
                        }).catch(() => null);
                    }
                }
            }

        } catch (err) {
            console.error("❌ Agent assignment error:", err);
        }
    },

// 💼 Route the Agent Action Button Click to the Right Modal
async handleAgentAction(interaction) {
    try {
        const parts = interaction.customId.split("_");
        const action = parts[1]; // "approve", "counter", "message", or "reject"

        const originChannelId = parts[5] || interaction.channelId;

        const safePlayerName = parts[2];
        const safeTeamName = parts[3];

        const playerName = safePlayerName ? safePlayerName.replace(/-/g, " ") : "Player";
        const gmMasterMessageId = parts[4]

        // --- Case A: APPROVAL MODAL ---
        if (action === "approve") {
            const modal = new ModalBuilder()
                .setCustomId(`agent_submit_approve_${safePlayerName}_${safeTeamName}_${gmMasterMessageId}_${originChannelId}`)
                .setTitle(`👍 Approve Extension: ${playerName}`);

            const notesInput = new TextInputBuilder()
                .setCustomId("approve_notes")
                .setLabel("Agent Approval Note")
                .setPlaceholder("e.g., Offer meets market value. Approved on behalf of player.")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(notesInput));
            return await interaction.showModal(modal);
        }

        // --- Case B: COUNTER OFFER MODAL ---
        if (action === "counter") {
            const oldEmbed = interaction.message?.embeds[0];
            let currentYears = "3";
            let currentAav = "12M";
            let currentBonus = "1.2M";

            if (oldEmbed && oldEmbed.fields) {
                const yearsField = oldEmbed.fields.find(f => f.name.includes("Added Length"));
                const aavField = oldEmbed.fields.find(f => f.name.includes("Annual AAV"));
                const bonusField = oldEmbed.fields.find(f => f.name.includes("Bonus"));

                if (yearsField) {
                    currentYears = yearsField.value.replace(/[^0-9]/g, "").trim();
                }

                if (aavField) {
                    // Strips backticks, extra $, spaces, and formats to standard currency
                    const cleanAav = aavField.value.replace(/[`$]/g, "").trim();
                    currentAav = formatCurrency(cleanAav).replace(/\$/g, ""); // Returns "2.1M"
                }

                if (bonusField) {
                    // Strips backticks and extra $ so it doesn't leak into the modal input
                    const cleanBonus = bonusField.value.replace(/[`$]/g, "").trim();
                    currentBonus = cleanBonus; 
                }
            }

            const modal = new ModalBuilder()
                .setCustomId(`agent_submit_counter_${safePlayerName}_${safeTeamName}_${gmMasterMessageId}_${originChannelId}`)
                .setTitle(`✍️ Counter Offer: ${playerName}`);

            const counterAavInput = new TextInputBuilder()
                .setCustomId("counter_aav")
                .setLabel("Counter Annual AAV ($)")
                .setValue(formatCurrency(currentAav))
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const counterYearsInput = new TextInputBuilder()
                .setCustomId("counter_years")
                .setLabel("Counter Years")
                .setValue(currentYears)
                .setStyle(TextInputStyle.Short)
                .setRequired(true); 

            const counterBonusInput = new TextInputBuilder()
                .setCustomId("counter_bonus")
                .setLabel("Counter Guaranteed Bonus ($)")
                .setValue(formatCurrency(currentBonus))
                .setStyle(TextInputStyle.Short)
                .setRequired(false);

            const counterNotesInput = new TextInputBuilder()
                .setCustomId("counter_notes")
                .setLabel("Agent Negotiation Counter Note")
                .setPlaceholder("e.g., My client demands a higher AAV to commit his prime years.")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(counterAavInput),
                new ActionRowBuilder().addComponents(counterYearsInput),
                new ActionRowBuilder().addComponents(counterBonusInput),
                new ActionRowBuilder().addComponents(counterNotesInput)
            );

            return await interaction.showModal(modal);
        }

        // --- Case C: MESSAGE GM MODAL ---
        if (action === "message") {
            const modal = new ModalBuilder()
                .setCustomId(`agent_submit_message_${safePlayerName}_${safeTeamName}_${gmMasterMessageId}_${originChannelId}`)
                .setTitle(`Message GM regarding ${playerName}`);

            const messageInput = new TextInputBuilder()
                .setCustomId("agent_message_text")
                .setLabel("Your Message")
                .setPlaceholder("e.g., Can we meet in the middle at $21.5M AAV?")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(messageInput));
            return await interaction.showModal(modal);
        }

        // --- Case D: REJECTION MODAL ---
        if (action === "reject") {
            const modal = new ModalBuilder()
                .setCustomId(`agent_submit_reject_${safePlayerName}_${safeTeamName}_${gmMasterMessageId}_${originChannelId}`)
                .setTitle(`👎 Reject Extension: ${playerName}`);

            const rejectNotesInput = new TextInputBuilder()
                .setCustomId("reject_notes")
                .setLabel("Reason for Rejection")
                .setPlaceholder("e.g., Offer is below player's valuation. Entering free agency.")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(rejectNotesInput));
            return await interaction.showModal(modal);
        }

    } catch (err) {
        console.error("❌ Agent action processing error:", err);
        return await interaction.reply({
            content: "💥 An error occurred while opening the action console.",
            ephemeral: true
        });
    }
    },
    // Handle Agent Modal Submissions
    async handleAgentModalSubmit(interaction) {
        try {
            await interaction.deferUpdate(); 
            const parts = interaction.customId.split("_");
            // Custom ID Structure: ["agent", "submit", action, safePlayerName, safeTeamName, originChannelId]
            const action = parts[2]; 
            const safePlayerName = parts[3];
            const safeTeamName = parts[4];
            const masterMessageId = parts[parts.length - 2];
            const originChannelId = parts[parts.length - 1];

            const playerName = safePlayerName ? safePlayerName.replace(/_/g, " ") : "Player";
            if (!masterMessageId) return console.error("❌ Could not find interaction message ID");

            let originChannel = null;
            if (originChannelId && originChannelId !== "undefined") {
                originChannel = await interaction.guild.channels.fetch(originChannelId).catch(() => null);
            }

            const oldEmbed = interaction.message.embeds[0];
            if (!oldEmbed) return;

            const submittedByField = oldEmbed.fields?.find(f => f.name && (f.name.includes("Submitted By") || f.name.includes("Status")));

            // Extract raw numbers from either message content or the embed field
            const contentMention = interaction.message.content?.match(/\d+/)?.[0];
            const embedMention = submittedByField?.value?.match(/\d+/)?.[0];

            // Fallback safely to a user mention string
            const gmId = contentMention || embedMention;
            const gmPing = gmId ? `<@${gmId}>` : `<@${interaction.user.id}>`;

            const updatedEmbed = EmbedBuilder.from(oldEmbed);

            // --- 1. HANDLE APPROVAL ---
            if (action === "approve") {
                const rawNote = interaction.fields.getTextInputValue("approve_notes");
                const note = rawNote && rawNote.trim() !== "" ? rawNote : "No notes provided.";

                updatedEmbed
                    .setColor(0x2ecc71) 
                    .spliceFields(5, 1, { 
                        name: "📊 Status", 
                        value: `✅ **APPROVED BY AGENT**\n**Agent:** ${interaction.user}`, 
                        inline: true 
                    })
                    .addFields({ name: "💬 Agent Handshake Note", value: `>>> ${note}`, inline: false });

                await interaction.editReply({
                    embeds: [updatedEmbed],
                    components: [] 
                });

                if (originChannel) {
                    await originChannel.send({
                        content: `🎉 ${gmPing}, **Contract Approved!**\nThe player agent (${interaction.user}) has **approved** the contract extension request for **${playerName}**!\n\n> **Agent Handshake Note:**\n> *"${note}"*`
                    }).catch(() => null);
                }
            }

        // --- 2. HANDLE AGENT COUNTER ---
            if (action === "counter") {
                const newAav = interaction.fields.getTextInputValue("counter_aav")?.trim();
                const newYears = interaction.fields.getTextInputValue("counter_years")?.trim();
                const newBonus = interaction.fields.getTextInputValue("counter_bonus")?.trim();
                const note = interaction.fields.getTextInputValue("counter_notes");

                const currentYears = oldEmbed.fields?.find(f => f.name.includes("Added Length"))?.value;
                const currentAav = oldEmbed.fields?.find(f => f.name.includes("Annual AAV"))?.value;
                const currentBonus = oldEmbed.fields?.find(f => f.name.includes("Bonus"))?.value;

                const displayYears = ((newYears && newYears !== "") ? newYears : currentYears).replace(/[^0-9]/g, "").trim()
                const displayAav = (newAav && newAav !== "") ? newAav : currentAav;
                const displayBonus = (newBonus && newBonus !== "") ? newBonus : currentBonus;

                // Grab previous history field
                const existingHistoryField = oldEmbed.fields.find(f => f.name.includes("Negotiation History") || f.name.includes("Notes"));
                const previousHistory = existingHistoryField ? existingHistoryField.value : "";

                // Generate formatted counter entry with large font numbers
                const agentEntry = formatHistoryEntry("Agent Counter", interaction.user.username, displayYears, displayAav, displayBonus, note);
                const updatedLedger = previousHistory ? `${previousHistory}\n\n${agentEntry}` : agentEntry;

                const historyText = updatedLedger;

                const updatedAgentEmbed = EmbedBuilder.from(oldEmbed)
                    .setTitle(`📤 Counter Offer Submitted: ${playerName}`)
                    .setColor(0xe67e22)
                    .setFields(
                        { name: "⏳ Added Length", value: `${displayYears} Years`, inline: true },
                        { name: "💰 Annual AAV", value: formatCurrency(displayAav), inline: true },
                        { name: "🔒 Bonus", value: formatCurrency(displayBonus), inline: true },
                        { name: "📜 Negotiation History", value: updatedLedger, inline: false }
                    );

            const buttonParams = {
                safePlayerName,
                safeTeamName,
                assignedAgentId: interaction.user.id,
                gmChannelId: originChannelId,
                masterMessageId,
                gmId
            };

            // 1. Update the Agent channel message
            await interaction.editReply({
                embeds: [updatedAgentEmbed],
                components: buildAgentActionRow(buttonParams, historyText)
            }).catch(() => null);

            // 2. Dispatch updated counter card to the GM channel
                if (originChannel) {
                    const gmComponents = buildGmActionRow("COUNTER", buttonParams, historyText);

                    // 1. Fetch the existing master card message in the GM channel
                    const masterMsg = await originChannel.messages.fetch(masterMessageId).catch(() => null);

                    if (masterMsg) {
                        // Edit the single active card with the updated counter embed and buttons
                        await masterMsg.edit({
                            embeds: [updatedAgentEmbed],
                            components: gmComponents
                        }).catch(err => console.error("❌ Failed to edit GM master embed:", err));

                        // Send a lightweight ping notification with a direct jump link to the updated card
                        await originChannel.send({
                            content: `🔔 ${gmPing}, **Counter offer received from Agent regarding ${playerName}!**\n👉 [View Updated Card](${masterMsg.url})`
                        }).catch(() => null);
                    } else {
                        // Fallback: If master message fetch fails, dispatch a new message
                        await originChannel.send({
                            content: `🔔 ${gmPing}, **Counter offer received from Agent regarding ${playerName}!**`,
                            embeds: [updatedAgentEmbed],
                            components: gmComponents
                        }).catch(err => console.error("❌ Failed to dispatch card to GM channel:", err));
                    }
                }
        }

            // --- 3. HANDLE REJECTION ---
            if (action === "reject") {
                const reason = interaction.fields.getTextInputValue("reject_notes");

                updatedEmbed
                    .setColor(0xe74c3c)
                    .spliceFields(5, 1, { 
                        name: "📊 Status", 
                        value: `❌ **REJECTED BY AGENT**\n**Agent:** ${interaction.user}`, 
                        inline: true 
                    })
                    .addFields({ name: "🛑 Rejection Note", value: `>>> ${reason}`, inline: false });

                await interaction.editReply({
                    embeds: [updatedEmbed],
                    components: [] 
                });

                if (originChannel) {
                    await originChannel.send({
                        content: `❌${gmPing}, **Contract Extension Rejected!**\nThe contract extension request for **${playerName}** was rejected by their agent (${interaction.user}).\n\n> **Reason for Rejection:**\n> *"${reason}"*`
                    }).catch(() => null);
                }
            }

        // --- 4. AGENT MESSAGES GM ---
        if (action === "message") {
            const messageText = interaction.fields.getTextInputValue("agent_message_text");

            const lengthField = oldEmbed?.fields?.find(f => f.name.includes("Added Length"))?.value;
            const aavField = oldEmbed?.fields?.find(f => f.name.includes("Annual AAV"))?.value;
            const bonusField = oldEmbed?.fields?.find(f => f.name.includes("Bonus"))?.value;

            const existingLedgerField = oldEmbed?.fields?.find(f => f.name.includes("Negotiation History") || f.name.includes("Notes"));
            const previousHistory = existingLedgerField ? existingLedgerField.value.replace(/^>>>\s*/, "") : "";

            const newEntry = `**[Agent - ${interaction.user.username}]:** ${messageText}`;
            const updatedLedger = previousHistory ? `${previousHistory}\n${newEntry}` : newEntry;

            
            const historyText = updatedLedger;

            const updatedAgentEmbed = EmbedBuilder.from(oldEmbed)
                .setFields(
                    { name: "⏳ Added Length", value: lengthField, inline: true },
                    { name: "💰 Annual AAV", value: aavField, inline: true },
                    { name: "🔒 Guaranteed Bonus", value: bonusField, inline: true },
                    { name: "📜 Negotiation History", value: `>>> ${updatedLedger}`, inline: false }
                );

            const buttonParams = {
                safePlayerName,
                safeTeamName,
                assignedAgentId: interaction.user.id,
                gmChannelId: originChannelId,
                masterMessageId,
                gmId
            };

            await interaction.editReply({
                embeds: [updatedAgentEmbed],
                components: buildAgentActionRow(buttonParams, historyText)
            }).catch(() => null);

            if (originChannel) {
                const gmSummaryEmbed = new EmbedBuilder()
                    .setTitle(`💬 New Message from Agent regarding ${playerName}`)
                    .setColor(0x3498db)
                    .setDescription(`The player agent (${interaction.user}) has sent an update regarding pending negotiations.`)
                    .addFields(
                        { name: "⏳ Added Length", value: lengthField, inline: true },
                        { name: "💰 Annual AAV", value: aavField, inline: true },
                        { name: "🔒 Bonus", value: bonusField, inline: true },
                        { name: "📜 Negotiation History", value: `>>> ${updatedLedger}`, inline: false }
                    )
                    .setTimestamp();

                const gmComponents = buildGmActionRow("COUNTER", buttonParams, historyText);

            const masterMsg = await originChannel.messages.fetch(masterMessageId).catch(() => null);

                if (masterMsg) {
                    // Edit the single active card directly
                    await masterMsg.edit({
                        embeds: [gmSummaryEmbed],
                        components: gmComponents
                    }).catch(err => console.error("❌ Failed to edit GM master embed:", err));

                    // Send a lightweight ping notification with a direct jump link
                    await originChannel.send({
                        content: `🔔 ${gmPing}, **New message received from Agent regarding ${playerName}!**\n👉 [View Updated Card](${masterMsg.url})`
                    }).catch(() => null);
                } else {
                    // Fallback: Dispatch a new message if the master message wasn't found
                    await originChannel.send({
                        content: `🔔 ${gmPing}, **New message received from Agent regarding ${playerName}!**`,
                        embeds: [gmSummaryEmbed],
                        components: gmComponents
                    }).catch(err => console.error("❌ Failed to dispatch card to GM channel:", err));
                }
            }
        }
        } catch (err) {
            console.error("❌ Error running handleAgentModalSubmit:", err);
        }
    },
    async handleGmAction(interaction) {
        try {
            const parts = interaction.customId.split("_");
            
            const action = parts[1];
            const safePlayerName = parts[2];
            const safeTeamName = parts[3];
            const assignedAgentId = parts[4];
            const agentChannelId = parts[5];

            const playerName = safePlayerName.replace(/-/g, " ");

            
            const oldEmbed = interaction.message?.embeds[0];
            if (!oldEmbed) return;

            
            const submittedByField = oldEmbed.fields.find(f => f.name && f.name.includes("Submitted By"));

            
            const contentMention = interaction.message.content.match(/\d+/)?.[0]; 
            const originalManagerId = contentMention || (submittedByField ? submittedByField.value.replace(/[^0-9]/g, "") : null);

            if (originalManagerId && interaction.user.id !== originalManagerId) {
                return await interaction.reply({
                    content: "❌ **Access Denied:** Only the GM who submitted this extension can negotiate this contract.",
                    ephemeral: true
                });
            }

            // --- GM ACTION A: ACCEPT COUNTER ---
            if (action === "accept") {
                const modal = new ModalBuilder()
                    .setCustomId(`gm_submit_accept_${safePlayerName}_${safeTeamName}_${assignedAgentId}_${interaction.message.id}`)
                    .setTitle(`👍 Accept & Sign: ${playerName}`);

                const noteInput = new TextInputBuilder()
                    .setCustomId("gm_accept_notes")
                    .setLabel("Handshake Message to Player")
                    .setPlaceholder("e.g., Welcome to the family! Let's win a championship.")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(noteInput));
                return await interaction.showModal(modal);
            }

            // --- GM ACTION B: COUNTER BACK ---
            if (action === "counter") {
                const currentYears = (oldEmbed.fields?.find(f => f.name && f.name.toLowerCase().includes("length"))?.value || "0").toString();
                const currentAav   = (oldEmbed.fields?.find(f => f.name && f.name.toLowerCase().includes("aav"))?.value || "$0").toString();
                const currentBonus = (oldEmbed.fields?.find(f => f.name && f.name.toLowerCase().includes("bonus"))?.value || "$0").toString();
                
                const modal = new ModalBuilder()
                    .setCustomId(`gm_submit_counter_${safePlayerName}_${safeTeamName}_${assignedAgentId}_${interaction.message.id}`)
                    .setTitle(`✍️ Counter Back: ${playerName}`);

                const counterAavInput = new TextInputBuilder()
                    .setCustomId("gm_counter_aav")
                    .setLabel("Counter Annual AAV ($)")
                    .setValue(currentAav)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const counterYearsInput = new TextInputBuilder()
                    .setCustomId("gm_counter_years")
                    .setLabel("Counter Years")
                    .setValue(currentYears)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const counterBonusInput = new TextInputBuilder()
                    .setCustomId("gm_counter_bonus")
                    .setLabel("Counter Guaranteed Bonus ($)")
                    .setValue(currentBonus)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false);

                const counterNotesInput = new TextInputBuilder()
                    .setCustomId("gm_counter_notes")
                    .setLabel("Message explaining your counter")
                    .setPlaceholder("e.g., Bumping the AAV slightly, but keeping the guaranteed terms...")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(counterAavInput),
                    new ActionRowBuilder().addComponents(counterYearsInput),
                    new ActionRowBuilder().addComponents(counterBonusInput),
                    new ActionRowBuilder().addComponents(counterNotesInput)
                );

                return await interaction.showModal(modal);
            }

            // --- GM ACTION C: MESSAGE AGENT ---
            if (action === "message") {
                const modal = new ModalBuilder()
                    .setCustomId(`gm_submit_message_${safePlayerName}_${safeTeamName}_${assignedAgentId}_${agentChannelId}`)
                    .setTitle(`💬 Message Agent: ${playerName}`);

                const messageInput = new TextInputBuilder()
                    .setCustomId("gm_message_text")
                    .setLabel("Message to Player Agent")
                    .setPlaceholder("e.g., Can we meet in the middle at $21.5M AAV?")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(messageInput));
                return await interaction.showModal(modal);
            }

            // --- GM ACTION D: DECLINE / PULL ---
            if (action === "decline") {
                const modal = new ModalBuilder()
                    .setCustomId(`gm_submit_decline_${safePlayerName}_${safeTeamName}_${assignedAgentId}_${agentChannelId}`)
                    .setTitle(`👎 Pull Extension: ${playerName}`);

                const declineNotesInput = new TextInputBuilder()
                    .setCustomId("gm_decline_notes")
                    .setLabel("Reason for Ending Negotiations")
                    .setPlaceholder("e.g., This doesn't make sense. We're moving on.")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(declineNotesInput));
                return await interaction.showModal(modal);
            }

        } catch (err) {
            console.error("❌ GM action processing error:", err);
        }
    },
    // Handle GM Modal Submissions
    async handleGmModalSubmit(interaction) {
        try {
            await interaction.deferUpdate();

            const parts = interaction.customId.split("_");
            const action = parts[2];
            const safePlayerName = parts[3];
            const safeTeamName = parts[4];
            const assignedAgentId = parts.length >= 6 ? parts[5] : "unassigned";
            const playerName = safePlayerName ? safePlayerName.replace(/_/g, " ") : "Player";

            // --- SUPABASE CHANNEL LOOKUP ---
            // Fetch the configured Agent Log Channel ID from your database settings/league config table
            const { data: config } = await supabase
                .from("league_configs")
                .select("log_channel_id")
                .eq("guild_id", interaction.guildId)
                .single();

            const agentLogChannelId = config?.log_channel_id;

            const agentChannel = agentLogChannelId
                ? await interaction.guild.channels.fetch(agentLogChannelId).catch(() => null)
                : null;

            // Parameters object for our centralized button builder
            const buttonParams = {
                safePlayerName,
                safeTeamName,
                assignedAgentId,
                agentChannelId: agentLogChannelId || "undefined",
                gmChannelId: interaction.channelId
            };

            
            const gmEmbed = interaction.message.embeds[0];
            if (!gmEmbed) return;
            const updatedGmEmbed = EmbedBuilder.from(gmEmbed);

            // --- A. GM ACCEPTS COUNTER ---
            if (action === "accept") {
                const note = interaction.fields.getTextInputValue("gm_accept_notes") || "No notes provided.";

                const historyField = gmEmbed.fields?.find(f => f.name.includes("Negotiation History") || f.name.includes("Notes"));
                const previousHistory = historyField ? historyField.value.replace(/^>>>\s*/, "") : "";
                const gmEntry = `**[GM Accepted - ${interaction.user.username}]:** Handshake note: "${note}"`;
                const updatedLedger = previousHistory ? `${previousHistory}\n${gmEntry}` : gmEntry;
                const historyText = updatedLedger;

                updatedGmEmbed
                    .setColor(0x2ecc71)
                    .setTitle(`✅ Deal Closed & Signed: ${playerName}`)
                    .setFields(
                        ...gmEmbed.fields.filter(f => !f.name.includes("Negotiation History")),
                        { name: "📜 Negotiation History", value: `>>> ${updatedLedger}`, inline: false }
                    );

                // 1. Update GM Team Chat with confirmation notice + no buttons
                await interaction.editReply({
                    content: "🎉 **Deal Closed & Signed!** Official confirmation sent to the Agent Log Channel.",
                    embeds: [updatedGmEmbed],
                    components: buildGmActionRow("CLOSED", buttonParams, historyText)
                });

                // 2. Dispatch to Agent Log Channel (fetched from Supabase)
                if (agentChannel) {
                    await agentChannel.send({
                        content: `🎉 ${assignedAgentId ? `<@${assignedAgentId}>` : "Agent"}, the contract for **${playerName}** has been **ACCEPTED & SIGNED** by the GM!`,
                        embeds: [updatedGmEmbed],
                        components: []
                    }).catch(err => console.error("❌ Failed to send accept to Agent Log Channel:", err));
                }
            }

            // --- HANDLE GM COUNTER TO AGENT ---
            if (action === "counter") {
                const newAav = interaction.fields.getTextInputValue("gm_counter_aav");
                const newYears = interaction.fields.getTextInputValue("gm_counter_years");
                const newBonus = interaction.fields.getTextInputValue("gm_counter_bonus");
                const note = interaction.fields.getTextInputValue("gm_counter_notes");

                const currentYears = gmEmbed.fields?.find(f => f.name && f.name.toLowerCase().includes("length"))?.value || "0";
                const currentAav   = gmEmbed.fields?.find(f => f.name && f.name.toLowerCase().includes("aav"))?.value || "$0";
                const currentBonus = gmEmbed.fields?.find(f => f.name && f.name.toLowerCase().includes("bonus"))?.value || "$0";

                const displayYears = newYears ? newYears.replace(/Years?/gi, "").trim() : currentYears.replace(/Years?/gi, "").trim();
                const displayAav = newAav || currentAav;
                const displayBonus = newBonus || currentBonus;

                // Grab existing negotiation history from current embed
                const existingHistoryField = gmEmbed.fields?.find(f => f.name.toLowerCase().includes("history") || f.name.toLowerCase().includes("notes"));
                const previousHistory = existingHistoryField ? existingHistoryField.value : "";

                const gmEntry = formatHistoryEntry(
                    "GM Counter", 
                    interaction.user.username, 
                    displayYears, 
                    displayAav, 
                    displayBonus, 
                    note
                );

                const updatedLedger = previousHistory ? `${previousHistory}\n\n${gmEntry}` : gmEntry;
                const historyText = updatedLedger;

                const updatedGmEmbed = EmbedBuilder.from(gmEmbed)
                .setTitle(`📥 Counter Offer Sent to Agent: ${playerName}`)
                .setColor(0x3498db)
                .setFields(
                    { name: "⏳ Added Length", value: `${displayYears} Years`, inline: true },
                    { name: "💰 Annual AAV", value: formatCurrency(displayAav), inline: true },
                    { name: "🔒 Guaranteed Bonus", value: formatCurrency(displayBonus), inline: true },
                    { name: "📜 Negotiation History", value: updatedLedger, inline: false }
                );

                // 1. Update the GM Channel message
                await interaction.editReply({
                    content: "📤 **Counter offer sent to Agent!**",
                    embeds: [updatedGmEmbed],
                    components: buildGmActionRow("COUNTER", buttonParams, historyText)
                });

                // 2. Dispatch update to Agent Queue/Log Channel
                if (agentChannel) {
                    await agentChannel.send({
                        content: `🔔 ${assignedAgentId && assignedAgentId !== "unassigned" ? `<@${assignedAgentId}>` : "Agent Queue"}, **GM sent a counter offer regarding ${playerName}!**`,
                        embeds: [updatedGmEmbed],
                        components: buildAgentActionRow(buttonParams, historyText)
                    }).catch(err => console.error("❌ Failed sending GM counter to Agent channel:", err));
                }
            }

            // --- GM SUBMITS MESSAGE TO AGENT ---
            if (action === "message") {
                const messageText = interaction.fields.getTextInputValue("gm_message_text");

                // Extract current negotiation history
                const historyField = gmEmbed.fields?.find(f => f.name.includes("Negotiation History") || f.name.includes("Notes"));
                const previousHistory = historyField ? historyField.value.replace(/^>>>\s*/, "") : "";
                const gmEntry = `**[GM Message - ${interaction.user.username}]:** "${messageText}"`;
                const updatedLedger = previousHistory ? `${previousHistory}\n${gmEntry}` : gmEntry;
                const historyText = updatedLedger;

                // 1. Clone embed and ONLY update the Negotiation History field (preserves Status, AAV, etc.)
                const updatedGmEmbed = EmbedBuilder.from(gmEmbed);
                const historyFieldIndex = gmEmbed.fields?.findIndex(f => f.name.includes("Negotiation History") || f.name.includes("Notes"));

                if (historyFieldIndex !== -1 && historyFieldIndex !== undefined) {
                    updatedGmEmbed.spliceFields(historyFieldIndex, 1, {
                        name: "📜 Negotiation History",
                        value: `>>> ${updatedLedger}`,
                        inline: false
                    });
                }

                // 2. Update GM Team Chat

                const isUnassigned = !assignedAgentId || assignedAgentId === "unassigned" || assignedAgentId === "undefined";

                // If unassigned, keep "OFFER" buttons (Message / Withdraw).
                // If assigned to an agent, give the GM "COUNTER" buttons (Accept / Counter / Message / Withdraw).
                const gmStage = isUnassigned ? "OFFER" : "COUNTER";

                // 2. Update GM Team Chat dynamically based on the negotiation stage
                await interaction.editReply({
                    content: "💬 **Message posted.** Updated history sent to Agent channel.",
                    embeds: [updatedGmEmbed],
                    components: buildGmActionRow(gmStage, buttonParams, historyText)
                });

                // 3. Send a NEW message to the Agent Queue Channel
                if (agentChannel) {
                    const isUnassigned = !assignedAgentId || assignedAgentId === "unassigned" || assignedAgentId === "undefined";

                    let agentComponents;

                    if (isUnassigned) {
                        // Unassigned: Keep the Self-Assign button with original origin IDs
                        const assignBtn = new ButtonBuilder()
                            .setCustomId(`portal_assign_agent_${safePlayerName}_${safeTeamName}_${interaction.channelId}_${interaction.message.id}`)
                            .setLabel("🙋 Represent Player (Self-Assign)")
                            .setStyle(ButtonStyle.Primary);

                        agentComponents = [new ActionRowBuilder().addComponents(assignBtn)];
                    } else {
                        // Assigned: Provide standard response buttons
                        agentComponents = buildAgentActionRow(buttonParams, historyText);
                    }

                    // Send brand new update message to agent channel
                    await agentChannel.send({
                        content: `💬 ${!isUnassigned ? `<@${assignedAgentId}>` : "Agent Queue"}, new update from GM regarding **${playerName}**!`,
                        embeds: [updatedGmEmbed],
                        components: agentComponents
                    }).catch(err => console.error("❌ Failed to dispatch message to Agent channel:", err));
                }
            }

            // --- D. GM DECLINES / PULLS OFFER ---
            if (action === "decline") {
                const reason = interaction.fields.getTextInputValue("gm_decline_notes") || "No reason specified.";

                const historyField = gmEmbed.fields?.find(f => f.name.includes("Negotiation History") || f.name.includes("Notes"));
                const previousHistory = historyField ? historyField.value.replace(/^>>>\s*/, "") : "";
                const gmEntry = `**[GM Withdrew - ${interaction.user.username}]:** "${reason}"`;
                const updatedLedger = previousHistory ? `${previousHistory}\n${gmEntry}` : gmEntry;
                const historyText = updatedLedger;

                updatedGmEmbed
                    .setColor(0xe74c3c)
                    .setTitle(`❌ Negotiations Ended: ${playerName}`)
                    .setFields(
                        ...gmEmbed.fields.filter(f => !f.name.includes("Negotiation History")),
                        { name: "📜 Negotiation History", value: `>>> ${updatedLedger}`, inline: false }
                    );

                // 1. Update GM Team Chat with withdrawal notice + no buttons
                await interaction.editReply({
                    content: "🛑 **Offer Withdrawn.** Negotiations have been terminated.",
                    embeds: [updatedGmEmbed],
                    components: buildGmActionRow("CLOSED", buttonParams, historyText)
                });

                // 2. Dispatch to Agent Log Channel
                if (agentChannel) {
                    await agentChannel.send({
                        content: `⚠️ ${assignedAgentId ? `<@${assignedAgentId}>` : "Agent"}, the GM has **withdrawn** negotiations for **${playerName}**.`,
                        embeds: [updatedGmEmbed],
                        components: []
                    }).catch(err => console.error("❌ Failed to send decline to Agent Log Channel:", err));
                }
            }

        } catch (err) {
            console.error("❌ Error processing GM modal submission:", err);
        }
    },
    handleFreeAgencyHub
};