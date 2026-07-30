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
                .setName("action")
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

    async execute(interaction, supabase, config, getSheetData, getPlayerStats, getOwnerIdMap) {
        // 🛠️ Grab the pre-existing supabase instance from the Discord client context
        //const supabase = interaction.client.supabase; 

        if (!supabase) {
            console.error("❌ Supabase client is missing on interaction.client");
            return;
        }

        const actionType = interaction.options.getString("action");

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

        try {
            const submission = await interaction.awaitModalSubmit({
                filter: (i) => i.customId === `trade_modal_${interaction.id}`,
                time: 300000,
            });

            await submission.deferReply({ ephemeral: true });

            // Fetch dynamic channels and roles using the shared DB client
            const { data: config, error } = await supabase
                .from("league_configs")
                .select("trade_channel_id, trade_role_id")
                .eq("guild_id", interaction.guild.id)
                .single();

            if (error || !config) {
                console.error("❌ Database Lookup Error for Trade Config:", error?.message);
                return await submission.editReply(
                    "❌ **Configuration Missing.** This server hasn't set up its trade channels or roles via the configuration manager yet."
                );
            }

            const tradeChannelId = config.trade_channel_id;
            const tradeRoleId = config.trade_role_id;

            if (!tradeChannelId) {
                return await submission.editReply(
                    "❌ **Configuration Missing.** No trade log channel assigned in the server configuration."
                );
            }

            const targetChannel = await interaction.client.channels.fetch(tradeChannelId).catch(() => null);
            if (!targetChannel) {
                return await submission.editReply(
                    "❌ **Channel Not Found.** The configured trade channel could not be found or read by the bot."
                );
            }

            const assets = submission.fields.getTextInputValue("trade_assets");
            const notes = submission.fields.getTextInputValue("trade_notes") || "No extra notes.";

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

            const pingContent = tradeRoleId 
                ? `🔔 <@&${tradeRoleId}> **- New Trade Alert!**` 
                : `🔔 **New Trade Alert!**`;

            await targetChannel.send({
                content: pingContent,
                embeds: [alertEmbed],
            });

            await submission.editReply("✅ Your trade alert has been successfully posted!");
        } catch (err) {
            console.error("❌ Trade Alert Execution Error:", err);
        }
    },
};