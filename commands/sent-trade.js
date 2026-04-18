const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("sent-trade")
        .setDescription("Alert a team that you sent them a trade offer")
        .addStringOption((o) =>
            o
                .setName("team")
                .setDescription("Target team name")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("notes")
                .setDescription("Optional: Details about the trade"),
        ),

    async execute(interaction, getSheetData, getPlayerStats, getOwnerIdMap) {
        // Keeping it ephemeral so only the sender sees the confirmation
        await interaction.deferReply({ ephemeral: true });

        try {
            const channelId = "1489845470321836032";
            const logChannel =
                await interaction.client.channels.fetch(channelId);

            if (!logChannel) {
                return await interaction.editReply(
                    "❌ Error: Could not find the trade log channel.",
                );
            }

            const teamInput = interaction.options.getString("team");
            const notes =
                interaction.options.getString("notes") || "No notes provided.";

            // --- OWNER LOOKUP LOGIC ---
            let ownerPing = "";
            let teamDisplayName = teamInput;

            try {
                const rows = await getOwnerIdMap();
                const ownerRow = rows.find(
                    (r) =>
                        r._rawData[0] &&
                        r._rawData[0]
                            .toLowerCase()
                            .includes(teamInput.toLowerCase()),
                );

                if (ownerRow) {
                    teamDisplayName = ownerRow._rawData[0]; // Proper name from sheet
                    const rawIds = ownerRow._rawData[1]; // Column B (Owner IDs)

                    if (rawIds) {
                        // 1. Split by comma if multiple IDs exist
                        // 2. Trim whitespace
                        // 3. Format as Role Mentions <@&ID>
                        ownerPing = rawIds.split(',')
                            .map(id => `<@${id.trim()}>`)
                            .join(' ');
                    }
                }
            } catch (sheetError) {
                console.error("Sheet Lookup Error:", sheetError);
            }

            // --- CREATE THE EMBED ---
            const logEmbed = new EmbedBuilder()
                .setTitle("🚨 New Trade Offer Sent")
                .setColor(0xffa500) // Orange
                .addFields(
                    {
                        name: "From",
                        value: `${interaction.user}`,
                        inline: true,
                    },
                    {
                        name: "To Team",
                        value: `**${teamDisplayName}**`,
                        inline: true,
                    },
                    { name: "Notes", value: notes },
                )
                .setTimestamp()
                .setFooter({ text: "Franchise Pro Trade Alerts" });

            // --- SEND TO CHANNEL ---
            // If we found an owner, we include the ping in the message content
            await logChannel.send({
                content: ownerPing
                    ? `🔔 ${ownerPing} - You have a new trade offer!`
                    : `🔔 **Trade sent to ${teamInput}** (Owner ID not found)`,
                embeds: [logEmbed],
            });

            // --- FINAL RESPONSE ---
            await interaction.editReply(
                ownerPing
                    ? `✅ Alert sent! **${teamDisplayName}** (${ownerPing}) has been notified.`
                    : `✅ Alert sent for **${teamInput}**, but I couldn't find that team in the ID sheet to ping them.`,
            );
        } catch (error) {
            console.error("Sent-Trade Error:", error);

            if (error.code === 50001) {
                return await interaction.editReply(
                    "❌ Bot Error: I don't have permission to access the trade-log channel.",
                );
            }

            await interaction.editReply(
                "❌ Something went wrong while processing the trade alert.",
            );
        }
    },
};
