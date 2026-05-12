const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('salary')
        .setDescription('Check player salary and performance')
        .addStringOption(option => 
            option.setName('player').setDescription('The name of the player').setRequired(true)),

    async execute(interaction, getSheetData, getPlayerStats) {
        console.log("DEBUG: Salary command started"); // Checkpoint 1
        await interaction.deferReply();
      const input = interaction.options.getString("player").toLowerCase();
        console.log("DEBUG: Fetching sheet data..."); // Checkpoint 2
            const { players, logs, idMap } = await getSheetData();
            console.log(`DEBUG: Found ${players.length} players in cache.`); // Checkpoint 3
            const matches = players.filter((r) =>
                r._rawData[1]?.toLowerCase().includes(input),
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
                const pName = playerRow._rawData[1];
                const pPos = playerRow._rawData[2];
                const capHit = playerRow._rawData[6] || "N/A";

                // 1. Find Sleeper ID from idMap
                const idRow = idMap.find(
                    (row) =>
                        row._rawData[1]?.toLowerCase() === pName.toLowerCase(),
                );
                const sleeperId = idRow ? idRow._rawData[0] : null;

                // 2. Fetch Stats if we have an ID
                const stats = sleeperId
                    ? await getPlayerStats(sleeperId)
                    : null;
                const displayYear = stats?.displayYear || "2025";
                let statsField = `No live stats available for ${displayYear}.`;

                if (stats) {
                    let s = [];

                    // Offensive Stats
                    if (stats.pass_yd)
                        s.push(
                            `• **Pass:** ${stats.pass_yd} Yds, ${stats.pass_td || 0} TD`,
                        );
                    if (stats.rush_yd)
                        s.push(
                            `• **Rush:** ${stats.rush_yd} Yds, ${stats.rush_td || 0} TD`,
                        );

                    // Updated Receiving Line with TDs
                    if (stats.rec || stats.rec_yd || stats.rec_td) {
                        s.push(
                            `• **Rec:** ${stats.rec || 0} Rec, ${stats.rec_yd || 0} Yds, ${stats.rec_td || 0} TD`,
                        );
                    }

                    // 🎯 THE FIX: Only show Defensive Stats for Defensive Players
                    const defensivePositions = [
                        "DE",
                        "DT",
                        "DL",
                        "LB",
                        "CB",
                        "S",
                        "DB",
                        "IDP",
                    ];
                    const isDefensivePlayer = defensivePositions.includes(
                        pPos.toUpperCase(),
                    );

                    if (isDefensivePlayer) {
                        const tkl =
                            stats.tkl ||
                            (stats.idp_tkl || 0) + (stats.idp_tkl_ast || 0);
                        const sack = stats.sack || stats.idp_sack || 0;
                        const int = stats.int || stats.idp_int || 0;

                        if (tkl > 0) s.push(`• **Tackles:** ${tkl} Total`);
                        if (sack > 0) s.push(`• **Sacks:** ${sack.toFixed(1)}`);
                        if (int > 0) s.push(`• **INTs:** ${int}`);
                    }

                    // Custom League Score
                    if (stats.leagueScore)
                        s.push(`\n🏆 **League Score: ${stats.leagueScore}**`);

                    if (s.length > 0) statsField = s.join("\n");
                }

                // 3. Build the Embed (Your Preferred Format)
                const embed = new EmbedBuilder()
                .setTitle(`🏈 ${pName} (${pPos})`)
                .setColor(0x3498db)
                .addFields(
                    // --- LINE 1 (3 Fields) ---
                    {
                        name: "💰 Yearly Salary",
                        value: playerRow._rawData[4] || "$0.00",
                        inline: true,
                    },
                    {
                        name: "⏳ Years Left",
                        value: playerRow._rawData[3] || "0",
                        inline: true,
                    },
                    {
                        name: "📋 Team",
                        value: playerRow._rawData[0] || "FA",
                        inline: true,
                    },
                    // --- LINE 2 (1 Field) ---
                    {
                        name: "💸 Cap Hit",
                        value: capHit || "N/A",
                        inline: false, // Setting this to false forces it to its own line
                    },
                    // --- LINE 3 (Performance) ---
                    {
                        name: `📈 ${displayYear} Performance`,
                        value: statsField,
                        inline: false,
                    },
                );

                // 🎯 NEW: Dynamic Structure Field
                // Only adds the field if there is something OTHER than "Standard" or empty
                const structureVal = playerRow._rawData[10];
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

                // Add history button if applicable
                const components = [];
                const hasHistory = logs.some(
                    (l) => l._rawData[0]?.toLowerCase() === pName.toLowerCase(),
                );
                if (hasHistory) {
                    components.push(
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`view_ext_${pName}`)
                                .setLabel("View Extension")
                                .setStyle(ButtonStyle.Secondary),
                        ),
                    );
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
                                .setLabel(m._rawData[1])
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
        }
}; 
