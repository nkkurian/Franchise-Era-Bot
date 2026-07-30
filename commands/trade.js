const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { normalizePlayerName } = require("../utils/sleeperLibrary");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("trade")
        .setDescription("Analyze trade impact")
        .addStringOption((o) =>
            o.setName("teama").setDescription("First team").setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("teama_players")
                .setDescription("Players from first team")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o.setName("teamb").setDescription("Second team").setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("teamb_players")
                .setDescription("Players from second team")
                .setRequired(true),
        ),

        async execute(interaction, supabase, config, getSheetData, getPlayerStats, getOwnerIdMap) {
            await interaction.deferReply();
            try {
                // Pass the dynamic guild ID so it fetches the correct spreadsheet
                const { players, doc } = await getSheetData(interaction.guild.id);

                const tA = interaction.options.getString("teama");
                const pA_input = interaction.options
                    .getString("teama_players")
                    .split(",")
                    .map((p) => p.trim().toLowerCase());
                const tB = interaction.options.getString("teamb");
                const pB_input = interaction.options
                    .getString("teamb_players")
                    .split(",")
                    .map((p) => p.trim().toLowerCase());

                // Extract the user's custom Supabase layout mappings
                const mapping = config?.column_mapping || config?.settings || config;

                const getSideData = async (teamName, playersIn) => {
                    const sh = doc.sheetsByIndex.find((s) =>
                        s.title.toLowerCase().includes(teamName.toLowerCase()),
                    );

                    let cap = 0;
                    if (sh) {
                        // Pull the dynamic coordinate, defaulting to J5 if unconfigured
                        const capCellA1 = mapping?.cap_space_cell || "J5";
                        await sh.loadCells(capCellA1);

                        cap = parseFloat(
                            (sh.getCellByA1(capCellA1).formattedValue || "0")
                            .replace(/[$,]/g, "")
                        ) || 0;
                    }

                    let totalCapSent = 0;
                    let playerDetails = [];
                    playersIn.forEach((rawInputName) => {
                        const normalizedInput = normalizePlayerName(rawInputName);
                        if (!normalizedInput) return;

                        // Find the player using our clean, normalized lookup keys
                        const r = players.find((row) => {
                            if (!row) return false;
                            const checkName = row.name || row.playerName || row.rowRef?.get(mapping?.id_player_col || "Player Name");
                            return typeof checkName === 'string' && normalizePlayerName(checkName).includes(normalizedInput);
                        });

                        if (r) {
                            const pName = r.name || r.playerName || r.rowRef?.get(mapping?.id_player_col || "Player Name");
                            const rawSalary = r.salary || r.aav || r.capHit || r.rowRef?.get(mapping?.salary_col || "Salary") || "0";
                            const rawNotes = r.notes || r.structure || r.rowRef?.get(mapping?.notes_col || "Structure") || "";

                            // Safe mathematical string parsing for M-shorthand notation entries
                            let hit = 0;
                            const cleanSalaryStr = String(rawSalary).toLowerCase().replace(/[$, ]/g, '');

                            if (typeof rawSalary === 'number') {
                                hit = rawSalary;
                            } else if (cleanSalaryStr.includes('m')) {
                                hit = (parseFloat(cleanSalaryStr.replace('m', '')) || 0) * 1000000;
                            } else {
                                hit = parseFloat(cleanSalaryStr) || 0;
                            }

                            totalCapSent += hit;
                    

                            // Build contract notes sub-text if a structure column exists and has content
                            let structureText = rawNotes
                                ? `\n    ┗ 📜 *${String(rawNotes).slice(0, 50)}...*`
                                : "";

                            playerDetails.push(
                                `• ${pName}: **$${hit.toLocaleString()}**${structureText}`,
                            );
                        } else {
                            playerDetails.push(`• ${pn}: *Not Found*`);
                        }
                    });
                return {
                    title: sh ? sh.title : teamName,
                    cap,
                    totalCapSent,
                    playerDetails,
                };
            };

            const [sA, sB] = await Promise.all([
                getSideData(tA, pA_input),
                getSideData(tB, pB_input),
            ]);

            const tradeEmbed = new EmbedBuilder()
                .setTitle("🤝 Detailed Trade Analysis")
                .setColor(0xe67e22)
                .addFields(
                    {
                        name: `📤 From ${sA.title}`,
                        value: sA.playerDetails.join("\n") || "None",
                        inline: false,
                    },
                    {
                        name: `📥 From ${sB.title}`,
                        value: sB.playerDetails.join("\n") || "None",
                        inline: false,
                    },
                    {
                        name: `📊 ${sA.title} Projected Cap Space`,
                        value: `**$${(sA.cap + sA.totalCapSent - sB.totalCapSent).toLocaleString()}**`,
                        inline: true,
                    },
                    {
                        name: `📊 ${sB.title} Projected Cap Space`,
                        value: `**$${(sB.cap + sB.totalCapSent - sA.totalCapSent).toLocaleString()}**`,
                        inline: true,
                    },
                );

            return await interaction.editReply({ embeds: [tradeEmbed] });
        } catch (err) {
            console.error(err);
            if (!interaction.replied)
                await interaction.editReply("⚠️ Bot Error.");
        }
    },
};
