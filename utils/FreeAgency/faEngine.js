const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    StringSelectMenuBuilder
} = require("discord.js");
const { recordBidInSheet, fetchTeamBids, fetchTotalBidsCount, removeBidFromSheet } = require("./googleSheet.js");
/**
 * Render the main FA Hub view inside the Franchise Portal
 */

function parseSalaryInput(input) {
    if (!input && input !== 0) return NaN;
    let cleaned = input.toString().toUpperCase().replace(/[\$,]/g, '').trim();

    if (cleaned.endsWith('M')) return parseFloat(cleaned.replace('M', '')) * 1_000_000;
    if (cleaned.endsWith('K')) return parseFloat(cleaned.replace('K', '')) * 1_000;

    let num = parseFloat(cleaned);
    if (isNaN(num)) return NaN;

    // Smart fix: If user types a number under 1000 (e.g. 45 or 2.5), assume Millions
    if (num > 0 && num < 1000) {
        return num * 1_000_000;
    }

    return num;
}

// 2. Formats salary specifically for Google Sheets display (e.g., 45000000 -> "45M")
function formatSalaryForSheet(num) {
    if (isNaN(num) || num === 0) return "0";
    if (num >= 1_000_000) {
        return `${(num / 1_000_000).toFixed(2).replace(/\.00$/, "").replace(/(\.[1-9])0$/, "$1")}M`;
    }
    if (num >= 1_000) {
        return `${(num / 1_000).toFixed(2).replace(/\.00$/, "").replace(/(\.[1-9])0$/, "$1")}K`;
    }
    return `${num}`;
}

async function showFAHub(interaction, supabase) {
    await interaction.deferReply({ flags: [64] }); // Ephemeral reply

    // 1. Fetch FA settings from database
    const { data: config } = await supabase
        .from("league_configs")
        .select("fa_enabled, fa_sheet_id, fa_sheet_tab, max_bids_per_team")
        .eq("guild_id", interaction.guild.id)
        .maybeSingle();

    // 2. Check if FA is enabled by admins
    if (!config?.fa_enabled) {
        const disabledEmbed = new EmbedBuilder()
            .setTitle("🏈 Free Agency Hub — Closed")
            .setColor(0xe74c3c)
            .setDescription("Free Agency is currently **disabled** by league management. Check back once bidding officially opens!");

        return await interaction.editReply({ embeds: [disabledEmbed] });
    }

    // 3. FA is Enabled — Show Redesigned Hub UI (Item #4)
    const totalSubmittedBids = await fetchTotalBidsCount(config.fa_sheet_id, config.fa_sheet_tab);
    const maxLeagueBids = config?.max_bids_per_team;

    const hubEmbed = new EmbedBuilder()
        .setTitle("🏈 Free Agency Workspace")
        .setDescription("Welcome to the **Free Agency Hub**! Submit or manage your contract offers below.")
        .setColor(0x2ecc71)
        .addFields(
            { 
                name: "📌 Bidding Rules:", 
                value: "• All submitted bids are logged directly to the league sheet.\n" +
                       "• Make sure your offers align with your team's cap space.\n" +
                       "• Use **Submit New Bid** to add a new offer.\n" +
                       "• Use **Update / Remove Bid** to modify or withdraw active offers." 
            },
            { name: "Status", value: "🟢 **Bidding Open**", inline: true },
            { name: "Active Sheet Tab", value: `\`${config.fa_sheet_tab}\``, inline: true },
            { name: "Submitted Offers", value: `📊 **${totalSubmittedBids} / ${maxLeagueBids}**`, inline: true }
        )
        .setFooter({ text: "Franchise Free Agency Engine" });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("fa_open_bid_modal")
            .setLabel("Submit New Bid")
            .setStyle(ButtonStyle.Success)
            .setEmoji("➕"),

        new ButtonBuilder()
            .setCustomId("fa_view_my_bids")
            .setLabel("View / Remove Bid")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("⚙️")
    );

    return await interaction.editReply({ embeds: [hubEmbed], components: [row] });
}

/**
 * Show the modal when GM clicks "Submit / Update Bid"
 */
async function showBidModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId("modal_submit_fa_bid")
        .setTitle("Submit Free Agency Bid");

    const playerInput = new TextInputBuilder()
        .setCustomId("fa_player_name")
        .setLabel("Player Name")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. Patrick Mahomes")
        .setRequired(true);

    const aavInput = new TextInputBuilder()
        .setCustomId("fa_bid_aav")
        .setLabel("Annual Salary (AAV in $)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. 15M or 15000000")
        .setRequired(true);

    const yearsInput = new TextInputBuilder()
        .setCustomId("fa_bid_years")
        .setLabel("Contract Length (Years)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. 3")
        .setRequired(true);

    const bonusesInput = new TextInputBuilder()
        .setCustomId("fa_bid_bonuses")
        .setLabel("Bonuses & Guarantees (Optional)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. $5M GTD / $2M Signing / $1M Incentives")
        .setRequired(false);

    const notesInput = new TextInputBuilder()
        .setCustomId("fa_bid_notes")
        .setLabel("Notes & Message (Optional)")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("e.g. Starting role guaranteed.")
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder().addComponents(playerInput),
        new ActionRowBuilder().addComponents(aavInput),
        new ActionRowBuilder().addComponents(yearsInput),
        new ActionRowBuilder().addComponents(bonusesInput),
        new ActionRowBuilder().addComponents(notesInput)
    );

    return await interaction.showModal(modal);
}
async function handleBidSubmission(interaction, supabase) {
    const guildId = interaction.guild?.id;
    const userId = interaction.user.id;
    const username = interaction.user.tag;
    await interaction.deferReply(); 

    const rawPlayerName = interaction.fields.getTextInputValue("fa_player_name")?.trim();
    const rawAAV = interaction.fields.getTextInputValue("fa_bid_aav");
    const rawYears = interaction.fields.getTextInputValue("fa_bid_years");
    const rawBonuses = interaction.fields.getTextInputValue("fa_bid_bonuses")?.trim() || "N/A";
    const rawNotes = interaction.fields.getTextInputValue("fa_bid_notes")?.trim() || "None";

    // 1. Validation & Parsing
    const parsedAAV = parseSalaryInput(rawAAV);
    const parsedYears = parseInt(rawYears, 10);

    if (isNaN(parsedAAV) || parsedAAV <= 0) {
        return await interaction.editReply({ 
            content: "❌ **Invalid Salary:** Please enter a valid number for AAV (e.g., `45`, `15M`, or `15.5M`)." 
        });
    }

    if (isNaN(parsedYears) || parsedYears <= 0 || parsedYears > 7) {
        return await interaction.editReply({ 
            content: "❌ **Invalid Contract Length:** Years must be a positive number (between 1 and 7)." 
        });
    }

    const totalContractValue = parsedAAV * parsedYears;

    // 2. Fetch Config & User Data

    const { data: config, error: configError } = await supabase
        .from("league_configs")
        .select("fa_sheet_id, fa_sheet_tab, log_channel_id, fa_enabled, sleeper_team_roles, max_bids_per_team")
        .eq("guild_id", guildId)
        .maybeSingle();
    

    if (!config || !config.fa_enabled || !config.fa_sheet_id || !config.fa_sheet_tab) {
        console.error(`[FA CONFIG ERROR] Incomplete config for Guild ${guildId}:`, config);
        return await interaction.editReply({
            content: "❌ **Free Agency Not Configured:** Free agency bidding is either disabled or the Google Sheet hasn't been set up yet."
        });
    }

    let teamName = null;

    if (config?.sleeper_team_roles) {
        // Get array of all Role IDs assigned to this user in Discord
        const userRoleIds = interaction.member?.roles?.cache?.map(r => r.id) || [];

        for (const [key, details] of Object.entries(config.sleeper_team_roles)) {
            // Check if user has the outer key OR explicit roleId as a role in Discord
            if (userRoleIds.includes(key) || userRoleIds.includes(details.roleId)) {
                teamName = details.teamName || details.roleName;
                break;
            }
        }
    }

    if (!teamName) {
        teamName = interaction.user.username;
    }
    const sheetAAV = formatSalaryForSheet(parsedAAV);
    const sheetTotal = formatSalaryForSheet(totalContractValue);

    console.log(`[FA BID READY] Team: "${teamName}" | Sheet ID: ${config.fa_sheet_id.substring(0, 8)}... | Tab: "${config.fa_sheet_tab}"`);

    // 3. Sync Bid to Google Sheet
    try {
        console.log(`[FA SHEET SYNC] Writing bid for "${rawPlayerName}" to Google Sheets...`);

        const result = await recordBidInSheet(config.fa_sheet_id, config.fa_sheet_tab, {
            playerName: rawPlayerName,
                teamName: teamName,
                aav: sheetAAV,
                years: parsedYears,
                totalValue: sheetTotal,
                bonuses: rawBonuses,
                notes: rawNotes
        });

        const maxBids = config.max_bids_per_team;
        const currentCount = result.teamBidCount;

        console.log(`[FA SHEET SUCCESS] Action: ${result.action.toUpperCase()} | Row: ${result.row || 'Appended'}`);

        const formattedAAV = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(parsedAAV);
        const formattedTotal = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalContractValue);
        const statusAction = result.action === 'updated' ? '🔄 Bid Updated' : '✅ New Bid Submitted';

        const confirmationEmbed = new EmbedBuilder()
            .setTitle(`${statusAction}!`)
            .setColor(0x2ecc71)
            .setDescription(`**${teamName}** submitted an offer for **${rawPlayerName}**!`)
                .addFields(
                    { name: "Team", value: teamName, inline: true },
                    { name: "Player", value: rawPlayerName, inline: true },
                    { name: "Active Bids", value: `📊 **${currentCount} / ${maxBids}**`, inline: true },
                    { name: "Length", value: `${parsedYears} Year(s)`, inline: true },
                    { name: "AAV (Per Year)", value: formattedAAV, inline: true },
                    { name: "Total Contract Value", value: `**${formattedTotal}**`, inline: true },
                    { name: "Bonuses & Guarantees", value: rawBonuses, inline: false },
                    { name: "Notes / Message", value: rawNotes, inline: false }
                )
            .setFooter({ text: "Franchise Free Agency Engine" })
            .setTimestamp();

        // Optional Log Channel Dispatch
        if (config.log_channel_id) {
            try {
                const logChannel = await interaction.guild.channels.fetch(config.log_channel_id);
                if (logChannel) {
                    await logChannel.send({ embeds: [confirmationEmbed] });
                }
            } catch (logErr) {
            }
        }

        await interaction.editReply({ embeds: [confirmationEmbed] });

    } catch (err) {

        return await interaction.editReply({
            content: `❌ **Sheet Error:** Unable to write bid to Google Sheet. Details: \`${err.message}\``
        });
    }
}

/**
 * Show list of active bids submitted by the clicking GM
 */
async function showMyBids(interaction, supabase) {
    await interaction.deferReply({ flags: [64] });

    // 1. Fetch Config INCLUDING sleeper_team_roles
    const { data: config } = await supabase
        .from("league_configs")
        .select("fa_sheet_id, fa_sheet_tab, sleeper_team_roles")
        .eq("guild_id", interaction.guild.id)
        .maybeSingle();

    if (!config?.fa_sheet_id || !config?.fa_sheet_tab) {
        return await interaction.editReply({ content: "❌ Free Agency sheet configuration missing." });
    }

    let teamName = null;

    // 2. Resolve Team Name from Discord Roles
    if (config?.sleeper_team_roles) {
        const userRoleIds = interaction.member?.roles?.cache?.map(r => r.id) || [];
        for (const [key, roleData] of Object.entries(config.sleeper_team_roles)) {
            if (userRoleIds.includes(key) || userRoleIds.includes(roleData.roleId)) {
                teamName = roleData.teamName || roleData.roleName;
                break;
            }
        }
    }

    // Fallback if no team role matches
    if (!teamName) {
        teamName = interaction.user.username;
    }

    // 3. Fetch Bids for the matched Team Name
    try {
        const bids = await fetchTeamBids(config.fa_sheet_id, config.fa_sheet_tab, teamName);

        if (!bids || bids.length === 0) {
            return await interaction.editReply({ content: `📋 **${teamName}** currently has no active free agency bids.` });
        }

        const embed = new EmbedBuilder()
            .setTitle(`📋 Active Bids — ${teamName}`)
            .setColor(0x3498db);

        // Inside showMyBids in freeAgency.js:
        bids.forEach(b => {
            const formattedTotal = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(b.totalValue);
            const formattedAAV = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(b.aav);

            embed.addFields({
                name: `🏈 ${b.playerName}`,
                value: `**AAV:** ${formattedAAV} | **Years:** ${b.years} | **Total:** ${formattedTotal}\n` +
                       `**Guaranteed/Bonuses:** ${b.bonuses}\n` +
                       `**Notes:** ${b.notes}\n` +
                       `*Logged: ${b.timestamp}*`,
                inline: false
            });
        });

        // Add Select Menu for Withdrawing
        const selectOptions = bids.map(b => ({
            label: b.playerName,
            description: `Withdraw bid (${formatSalaryForSheet(b.aav)}/yr)`,
            value: `withdraw_${b.playerName}`
        }));

        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId("fa_withdraw_select")
                .setPlaceholder("Select a bid to withdraw/remove...")
                .addOptions(selectOptions)
        );

        return await interaction.editReply({ embeds: [embed], components: [selectRow] });
    } catch (err) {
        return await interaction.editReply({ content: `❌ Error fetching bids: ${err.message}` });
    }
}

async function handleWithdrawBid(interaction, supabase) {
    await interaction.deferReply({ flags: [64] });

    const selectedPlayer = interaction.values[0].replace("withdraw_", "");

    // 1. Fetch Config (including log_channel_id & team roles)
    const { data: config } = await supabase
        .from("league_configs")
        .select("fa_sheet_id, fa_sheet_tab, log_channel_id, sleeper_team_roles")
        .eq("guild_id", interaction.guild.id)
        .maybeSingle();

    if (!config?.fa_sheet_id || !config?.fa_sheet_tab) {
        return await interaction.editReply({ content: "❌ Free Agency sheet configuration missing." });
    }

    // 2. Resolve Team Name from Roles
    let teamName = interaction.user.username;
    if (config?.sleeper_team_roles) {
        const userRoleIds = interaction.member?.roles?.cache?.map(r => r.id) || [];
        for (const [key, roleData] of Object.entries(config.sleeper_team_roles)) {
            if (userRoleIds.includes(key) || userRoleIds.includes(roleData.roleId)) {
                teamName = roleData.teamName || roleData.roleName;
                break;
            }
        }
    }

    // 3. Delete Row from Google Sheets
    const result = await removeBidFromSheet(config.fa_sheet_id, config.fa_sheet_tab, teamName, selectedPlayer);

    if (!result.success) {
        return await interaction.editReply({ 
            content: `❌ Could not find an active bid for **${selectedPlayer}** on the sheet.` 
        });
    }

    // A. Ephemeral Confirmation to the GM
    await interaction.editReply({ 
        content: `✅ Bid for **${selectedPlayer}** has been successfully withdrawn!` 
    });

    // Build Public Audit Embed
    const logEmbed = new EmbedBuilder()
        .setTitle("🚫 Free Agency Bid Withdrawn")
        .setColor(0xe74c3c)
        .setDescription(`**${teamName}** has withdrawn their offer for **${selectedPlayer}**.`)
        .addFields(
            { name: "Team", value: teamName, inline: true },
            { name: "Player", value: selectedPlayer, inline: true }
        )
        .setFooter({ text: `Action performed by @${interaction.user.username}` })
        .setTimestamp();

    // B. Post to Dedicated Log Channel (if configured)
    if (config.log_channel_id) {
        try {
            const logChannel = await interaction.guild.channels.fetch(config.log_channel_id);
            if (logChannel) {
                await logChannel.send({ embeds: [logEmbed] });
            }
        } catch (err) {
            console.error("[FA LOG ERROR] Failed to send to log channel:", err);
        }
    }

    // C. Post Notice to Current Channel (if different from log channel)
    if (interaction.channelId !== config.log_channel_id) {
        try {
            await interaction.channel.send({ embeds: [logEmbed] });
        } catch (err) {
            console.error("[FA CHANNEL LOG ERROR]:", err);
        }
    }
}

// Export named functions cleanly
module.exports = {
    showFAHub,
    showBidModal,
    handleBidSubmission,
    showMyBids,
    handleWithdrawBid
};