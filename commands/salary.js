const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
} = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("salary")
        .setDescription("Check player salary and performance")
        .addStringOption((option) =>
            option
                .setName("player")
                .setDescription("The name of the player")
                .setRequired(true),
        ),

    async execute(interaction, supabase, config, getSheetData, getPlayerStats) {
        await interaction.deferReply();
        try {
        const input = interaction.options.getString("player").toLowerCase();

        // Removed idMap since our background cache renders it obsolete!
        const { players, logs } = await getSheetData(interaction.guild.id);

        const matches = players.filter(
           (r) => r && typeof r.name === 'string' && r.name.trim().toLowerCase().includes(input.trim())
        );

        if (matches.length === 0)
            return await interaction.editReply(
                `❌ Player **${input}** not found.`,
            );
    
                const sendSalaryResponse = async (
                    targetInteraction,
                    playerRow,
                    isUpdate = false,
                ) => {
                    const pName = playerRow.name;
                    const teamAffiliation = playerRow.team || "FA";

                    // 🔄 Pull dynamic league header configuration keys from Supabase
                    const salaryKey = config?.column_mapping?.salary || "Salary";
                    const capHitKey = config?.column_mapping?.cap_hit || "Cap Hit";
                    const yearsKey = config?.column_mapping?.years || "Years Left";
                    // Extract values safely using the dynamic mapping keys, with old cache keys as fallbacks
                    const rawSalary = playerRow[salaryKey] || playerRow.aav || 0;
                    const rawCapHit = playerRow[capHitKey] || playerRow.capHit || 0;
                    const yearsLeft = playerRow[yearsKey] || playerRow.yearsLeft || "0";

                    const playerNotes = playerRow.notes || "";

                    // Format currency strings cleanly
                    const yearlySalary = `$${(rawSalary / 1000000).toFixed(2)}M`;
                    const capHit = `$${(rawCapHit / 1000000).toFixed(2)}M`;

                    const normalizedTargetName = pName
                        .toLowerCase()
                        .replace(/\b(jr|sr|iii|ii|iv|v|vth)\b/gi, '')
                        .replace(/[^a-z0-9]/gi, '')
                        .trim();
                    
                    // Instant O(1) key fetch using search_key from Sleeperlibrary
                    const bestMatchPlayer = global.sleeperCache?.get(normalizedTargetName) || null;
                    const sleeperId = bestMatchPlayer ? (bestMatchPlayer.id || bestMatchPlayer.sleeper_id) : null;
                    
                    const pPos = bestMatchPlayer?.position || playerRow.position || "FA";

                    // DEBUG LOG: If this triggers, your name normalization didn't find a match at all
                    if (!sleeperId) {
                        console.log(`❌ [DEBUG] No Sleeper cache match found for normalized name: "${normalizedTargetName}"`);
                    }

                    // 2. Fetch Stats if we have an ID
                    const sleeperLeagueId = config?.sleeper_id;
                    const stats = sleeperId ? await getPlayerStats(sleeperId, sleeperLeagueId) : null;
                    const displayYear = stats?.displayYear;
                    let statsField = `No live stats available for ${displayYear}.`;

                    if (stats) {
                        let s = [];

                        // 🏈 Offensive & Kicker Performance Rows
                        if (stats.pass_yd) s.push(`• **Pass:** ${stats.pass_yd} Yds, ${stats.pass_td || 0} TD`);
                        if (stats.rush_yd) s.push(`• **Rush:** ${stats.rush_yd} Yds, ${stats.rush_td || 0} TD`);
                        if (stats.rec || stats.rec_yd || stats.rec_td) {
                            s.push(`• **Rec:** ${stats.rec || 0} Rec, ${stats.rec_yd || 0} Yds, ${stats.rec_td || 0} TD`);
                        }
                        // 🦶 Kicker Statistics Parsing
                        if (stats.fgm || stats.xpm) {
                            s.push(`• **FG:** ${stats.fgm || 0}/${stats.fga || 0} Made, Long: ${stats.fg_long || 0} Yds`);
                            s.push(`• **XP:** ${stats.xpm || 0}/${stats.xpa || 0} Made`);
                        }

                        // 🎯 IDP / Defensive Positions Array Matching
                        const defensivePositions = [
                            "DE", "DT", "DL", "NT", 
                            "LB", "ILB", "OLB", "MLB", 
                            "CB", "S", "FS", "SS", "DB", 
                            "IDP", "EDGE"
                        ];
                        const isDefensivePlayer = defensivePositions.includes(pPos.toUpperCase());

                        if (isDefensivePlayer) {
                            // 1. Total Tackles (Solo + Assisted)
                            const solo = stats.idp_tkl_solo || stats.tkl_solo || 0;
                            const ast = stats.idp_tkl_ast || stats.tkl_ast || 0;
                            const totalTkl = stats.tkl || stats.idp_tkl || (solo + ast);

                            // 2. Defensive Metrics
                            const sack = stats.sack || stats.idp_sack || 0;
                            const inter = stats.int || stats.idp_int || 0;
                            const ff = stats.ff || stats.idp_ff || 0;
                            const fr = stats.fr || stats.idp_fr || 0; // Forced Recoveries
                            const pd = stats.pd || stats.idp_pass_def || stats.idp_pd || 0; // Pass Deflections
                            const tfl = stats.tfl || stats.idp_tkl_loss || 0; // Tackles for Loss

                            if (totalTkl > 0) s.push(`• **Tackles:** ${totalTkl} (${solo} Solo, ${ast} Ast)`);
                            if (tfl > 0) s.push(`• **Tackles for Loss:** ${tfl}`);
                            if (sack > 0) s.push(`• **Sacks:** ${sack.toFixed(1)}`);
                            if (inter > 0) s.push(`• **INTs:** ${inter}`);
                            if (pd > 0) s.push(`• **Passes Defended:** ${pd}`);
                            if (ff > 0 || fr > 0) s.push(`• **Fumbles:** ${ff} FF, ${fr} FR`);
                        }

                        // Custom League Score
                        if (stats.leagueScore)
                            s.push(`\n🏆 **League Score: ${stats.leagueScore}**`);

                        if (s.length > 0) statsField = s.join("\n");
                    }

                    // Identify GM's Team from Roles
                    let userTeamName = null;
                    if (interaction.member && config?.sleeper_team_roles) {
                        const memberRoles = interaction.member.roles.cache.map(r => r.id);
                        for (const [roleId, details] of Object.entries(config.sleeper_team_roles)) {
                            if (memberRoles.includes(roleId) || (details?.roleId && memberRoles.includes(details.roleId))) {
                                userTeamName = details.teamName;
                                break;
                            }
                        }
                    }
                    //Check if player is already on GM's team
                    const isAlreadyOnTeam = userTeamName && teamAffiliation.toLowerCase().trim() === userTeamName.toLowerCase().trim();
                    
                // 3. Build the Embed (Your Preferred Format)
                    const embed = new EmbedBuilder()
                    .setTitle(`🏈 ${pName} (${pPos})`)
                    .setColor(0x3498db)
                    .addFields(
                        {
                            name: "📋 Team",
                            value: teamAffiliation,
                            inline: true,
                        },
                        {
                            name: "💰 Yearly Salary",
                            value: yearlySalary,
                            inline: true,
                        },
                        {
                            name: "💸 Cap Hit",
                            value: capHit,
                            inline: true, 
                        },
                        {
                            name: "⏳ Years Left",
                            value: String(yearsLeft),
                            inline: true,
                        },

                        // --- LINE 3 (Performance Metrics - Drops Down Below) ---
                        {
                            name: `📈 ${displayYear} Performance`,
                            value: statsField,
                            inline: false, 
                        },
                    );
                    // --- LINE 4 (Optional Player Spreadsheet Notes Block) ---
                    if (playerNotes && String(playerNotes).trim() !== "") {
                        embed.addFields({
                            name: "📝 Player Notes",
                            value: String(playerNotes),
                            inline: false
                        });
                    }
    
                // 🎯 NEW: Dynamic Structure Field
                // Only adds the field if there is something OTHER than "Standard" or empty
                const structureColumnName = config?.column_mapping?.structure || "Structure";
                const structureVal = playerRow.rowRef && typeof playerRow.rowRef.get === 'function' 
                    ? playerRow.rowRef.get(structureColumnName) 
                    : null;
    
                if (
                    structureVal &&
                    structureVal.toLowerCase() !== "standard" &&
                    structureVal.trim() !== ""
                ) {
                    embed.addFields({
                        name: "📜 Structure",
                        value: structureVal,
                        inline: false,
                    });
                }
    
                // 4. Add Headshot
                if (sleeperId) {
                    embed.setThumbnail(
                        `https://sleepercdn.com/content/nfl/players/${sleeperId}.jpg`,
                    );
                }
    
                    const components = [];
                    const buttonRow = new ActionRowBuilder(); 

                    // 1. Add "View Extension" button if history exists
                    const hasHistory = logs.some((l) => {
                        if (!l) return false;
                        const logName = l.name || l.playerName || l._rawData?.[0];
                        return logName?.toLowerCase() === pName.toLowerCase();
                    });

                    if (hasHistory) {
                        buttonRow.addComponents(
                            new ButtonBuilder()
                                .setCustomId(`view_ext_${pName}`)
                                .setLabel("View Extension")
                                .setStyle(ButtonStyle.Secondary)
                        );
                    }

                    // 2. Add "Simulate Cap Impact" button
                    const safePlayerName = pName.replace(/\s+/g, "_");
                    buttonRow.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`portal_sim_impact_${safePlayerName}_${rawCapHit}`)
                            .setLabel("📊 Simulate Cap Impact")
                            .setStyle(ButtonStyle.Primary)
                    );

                    if (buttonRow.components.length > 0) {
                        components.push(buttonRow);
                    }
    
                const payload = {
                    content: null,
                    embeds: [embed],
                    components: components,
                };
                return isUpdate
                    ? await targetInteraction.update(payload)
                    : await targetInteraction.editReply(payload);
            };
    
            // Handle single or multiple matches
            if (matches.length === 1) {
                return await sendSalaryResponse(interaction, matches[0]);
            } else {
                const selectionRow = new ActionRowBuilder().addComponents(
                    matches
                        .slice(0, 5)
                        .map((m, i) =>
                            new ButtonBuilder()
                                .setCustomId(`select_player_${i}`)
                                .setLabel(m.name)
                                .setStyle(ButtonStyle.Primary),
                        ),
                );
                const response = await interaction.editReply({
                    content: "Multiple found, please select:",
                    components: [selectionRow],
                });
                const collector = response.createMessageComponentCollector({
                    componentType: ComponentType.Button,
                    time: 30000,
                });
                collector.on("collect", async (i) => {
            const idx = parseInt(i.customId.split("_")[2]);
            await sendSalaryResponse(i, matches[idx], true);
            collector.stop();
            });
        }
    } catch (err) {
        console.error("❌ Error running /salary command:", err);
        await interaction.editReply("💥 An error occurred while fetching salary details.").catch(() => {});
    }
    },
    async handleSimulateImpact(interaction, supabase, config, getSheetData) {
            try {
                await interaction.deferReply({ flags: [64] }); 
                if (!config && supabase) {
                    const { data } = await supabase
                        .from("league_configs") 
                        .select("*")
                        .eq("guild_id", interaction.guild.id)
                        .maybeSingle();
                    config = data;
                }

                // Parse customId: "portal_sim_impact_Patrick_Mahomes_10000000"
                const parts = interaction.customId.split("_");
                const playerCapHit = parseFloat(parts.pop()) || 0;
                const playerName = parts.slice(3).join(" ").replace(/_/g, " ");

                // 1. Identify GM's Team from Roles
                let userTeamName = null;
                if (interaction.member && config?.sleeper_team_roles) {
                    const memberRoles = interaction.member.roles.cache.map(r => r.id);
                    for (const [roleId, details] of Object.entries(config.sleeper_team_roles)) {
                        if (memberRoles.includes(roleId) || (details?.roleId && memberRoles.includes(details.roleId))) {
                            userTeamName = details.teamName;
                            break;
                        }
                    }
                }

                if (!userTeamName) {
                    return await interaction.editReply("❌ Could not verify your team assignment based on your Discord roles.");
                }

                // 2. Fetch sheet data
                const { players, teams } = await getSheetData(interaction.guild.id);

                // Find player row to check current team affiliation
                const targetPlayer = players?.find(p => p.name?.toLowerCase() === playerName.toLowerCase());
                const playerTeam = targetPlayer?.team || targetPlayer?.franchise || "Free Agent";

                // 3. CHECK: Is the player already on their team?
                const isAlreadyOnTeam = playerTeam.toLowerCase().trim() === userTeamName.toLowerCase().trim();

                if (isAlreadyOnTeam) {
                    const rosterEmbed = new EmbedBuilder()
                        .setTitle(`💼 Roster Status: ${playerName}`)
                        .setColor(0x3498db)
                        .setDescription(`🟢 **${playerName}** is already on your roster (**${userTeamName}**).`);

                    return await interaction.editReply({ embeds: [rosterEmbed] });
                }

                // 4. Outside Player -> Perform Financial Impact Simulation
                let currentCapSpaceRaw = "$0.00";

                try {
                    // A. Fetch Google Spreadsheet document context
                    const { doc } = await getSheetData(interaction.guild.id);

                    // B. Find the specific team tab (e.g. "Urumqi Uncs")
                    const teamSheet = doc.sheetsByIndex.find((s) =>
                        s.title.toLowerCase().includes(userTeamName.toLowerCase())
                    );

                    if (teamSheet) {
                        // C. Pull the mapped cap cell (or fallback to F2)
                        const capCellA1 = (config?.column_mapping?.team_cap_space_cell || "F2").trim().toUpperCase();

                        // D. Load the cell and read its formatted value
                        await teamSheet.loadCells(capCellA1);
                        currentCapSpaceRaw = teamSheet.getCellByA1(capCellA1).formattedValue || "$0.00";
                    }
                } catch (err) {
                    console.error("⚠️ Failed to load cap space cell in simulation:", err);
                }

                // E. Parse currency formatted string (e.g. "$8,895,947.00") into a clean number
                const currentCapSpace = parseFloat(String(currentCapSpaceRaw).replace(/[$,]/g, "")) || 0;

                const projectedCapSpace = currentCapSpace - playerCapHit;
                const canAfford = projectedCapSpace >= 0;

                const simEmbed = new EmbedBuilder()
                    .setTitle(`📊 Cap Impact Simulation: ${playerName}`)
                    .setColor(canAfford ? 0x2ecc71 : 0xe74c3c)
                    .setDescription(`Financial simulation for adding **${playerName}** to **${userTeamName}**:`)
                    .addFields(
                        { name: "💰 Current Cap Space", value: `\`$${(currentCapSpace / 1000000).toFixed(2)}M\``, inline: true },
                        { name: "💸 Acquisition Cap Hit", value: `\`-$${(playerCapHit / 1000000).toFixed(2)}M\``, inline: true },
                        { 
                            name: "📈 Projected Remaining Cap Space", 
                            value: `${canAfford ? '🟢' : '🔴'} **$${(projectedCapSpace / 1000000).toFixed(2)}M**`, 
                            inline: false 
                        }
                    )
                    .setFooter({ text: canAfford ? "✅ Transaction is financially viable." : "⚠️ Warning: Pushes team over the cap!" });

                return await interaction.editReply({ embeds: [simEmbed] });

            } catch (err) {
                console.error("❌ Error running cap impact simulation:", err);
                return await interaction.editReply("💥 An error occurred while calculating cap impact.");
            }
        }
};
