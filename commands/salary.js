const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('salary')
        .setDescription('Check player salary and performance')
        .addStringOption(option => 
            option.setName('player').setDescription('The name of the player').setRequired(true)),

    async execute(interaction, getSheetData, getPlayerStats) {
        //await interaction.deferReply();
      const input = interaction.options.getString("player").toLowerCase().trim();
        const { players, logs, idMap } = await getSheetData();
        const matches = players.filter((r) =>
                r._rawData[1]?.toLowerCase().includes(input)
            );
        if (matches.length === 0) {
        return await interaction.editReply(`❌ Player **${input}** not found.`);
    }

            const sendSalaryResponse = async (targetInteraction, playerRow, isUpdate = false) => {
            const pName = playerRow._rawData[1];
            const pPos = playerRow._rawData[2];
            const capHit = playerRow._rawData[6] || "N/A";
        
            // 1. Find Sleeper ID
            const sleeperId = idMap.get(pName.toLowerCase().trim());
        
            // 2. The Fix: Define stats as null so the bot knows it exists but is empty
            const stats = null; 
            const displayYear = "2025";
            let statsField = "Live stats are currently disabled.";
        
            // 3. Build the Embed
            const embed = new EmbedBuilder()
                .setTitle(`🏈 ${pName} (${pPos})`)
                .setColor(0x3498db)
                .addFields(
                    { name: "💰 Yearly Salary", value: playerRow._rawData[4] || "$0.00", inline: true },
                    { name: "⏳ Years Left", value: playerRow._rawData[3] || "0", inline: true },
                    { name: "📋 Team", value: playerRow._rawData[0] || "FA", inline: true },
                    { name: "💸 Cap Hit", value: capHit, inline: false }
                    // Note: I removed the Performance field here so it stays hidden
                );
        
            // Keep the headshot logic since sleeperId still exists
            if (sleeperId) {
                embed.setThumbnail(`https://sleepercdn.com/content/nfl/players/${sleeperId}.jpg`);
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
