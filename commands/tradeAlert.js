const {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
} = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("trade-alert")
        .setDescription("Post a trade block or buying alert")
        .addStringOption((o) =>
            o
                .setName("action") // This creates the dropdown
                .setDescription("Are you trading away or looking for players?")
                .setRequired(true)
                .addChoices(
                    {
                        name: "📤 Trade Away (On the Block)",
                        value: "TRADING AWAY",
                    },
                    {
                        name: "📥 Trade For (Looking For)",
                        value: "LOOKING FOR",
                    },
                ),
        ),

    async execute(interaction) {
        const actionType = interaction.options.getString("action");

        // This MUST happen immediately (within 3 seconds)
        const modal = new ModalBuilder()
            .setCustomId(`trade_modal_${interaction.id}`)
            .setTitle(
                actionType === "TRADING AWAY"
                    ? "Post to Trade Block"
                    : "Post Buying Alert",
            );

        const assetsInput = new TextInputBuilder()
            .setCustomId("trade_assets")
            .setLabel(
                actionType === "TRADING AWAY"
                    ? "Players/Picks on the Block"
                    : "Players/Picks You Want",
            )
            .setPlaceholder("List names and draft years...")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const notesInput = new TextInputBuilder()
            .setCustomId("trade_notes")
            .setLabel("Additional Notes")
            .setPlaceholder("Extra details (cap, specific needs, etc.)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(assetsInput),
            new ActionRowBuilder().addComponents(notesInput),
        );

        await interaction.showModal(modal);

        // Collector to handle the submission
        try {
            const submission = await interaction.awaitModalSubmit({
                filter: (i) => i.customId === `trade_modal_${interaction.id}`,
                time: 300000,
            });

            await submission.deferReply({ ephemeral: true });

            const assets = submission.fields.getTextInputValue("trade_assets");
            const notes =
                submission.fields.getTextInputValue("trade_notes") ||
                "No extra notes.";
            const logChannelId = "1485437733429182604";
            const roleId = "1479107336617332787";

            const logChannel =
                await interaction.client.channels.fetch(logChannelId);

            const alertEmbed = new EmbedBuilder()
                .setTitle(`📢 ${actionType}: ${interaction.user.username}`)
                .setColor(actionType === "TRADING AWAY" ? 0xe74c3c : 0x3498db)
                .setAuthor({
                    name: interaction.user.tag,
                    iconURL: interaction.user.displayAvatarURL(),
                })
                .addFields(
                    { name: "🏈 Players/Picks", value: assets },
                    { name: "📝 Details", value: notes },
                )
                .setTimestamp()
                .setFooter({ text: "DM this user to negotiate!" });

            await logChannel.send({
                content: `🔔 <@&${roleId}> **- New Trade Alert!**`,
                embeds: [alertEmbed],
            });

            await submission.editReply("✅ Your trade alert has been posted!");
        } catch (err) {
            console.error(err);
        }
    },
};
