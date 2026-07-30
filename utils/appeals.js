const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");

async function showAppealModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId("appealModal")
        .setTitle("Official League Appeal");

    const reasonInput = new TextInputBuilder()
        .setCustomId("appealReason")
        .setLabel("What are you appealing and why?")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder(
            "e.g., The trade between Team A and Team B was unfairly vetoed...",
        )
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    return await interaction.showModal(modal);
}

async function handleAppealSubmit(interaction, supabase) {
    const reason = interaction.fields.getTextInputValue("appealReason");

    // 📊 Fetch target paths and custom requirements directly from the database
    let appealsChannelId = null;
    let votesRequired = 3; // Default starting parameter fallback if column row is empty

    try {
        const { data: config } = await supabase
            .from("league_configs")
            .select("appeals_channel_id, appeal_votes_required")
            .eq("guild_id", interaction.guild.id)
            .single();

        appealsChannelId = config?.appeals_channel_id;
        if (
            config?.appeal_votes_required !== undefined &&
            config?.appeal_votes_required !== null
        ) {
            votesRequired = config.appeal_votes_required;
        }
    } catch (dbErr) {
        console.error(
            "❌ Error loading system configurations in handleAppealSubmit:",
            dbErr,
        );
    }

    // Block interaction if the channel configuration has not been set up yet
    if (!appealsChannelId) {
        return await interaction.reply({
            content:
                "❌ **Configuration Error:** The Appeals channel has not been set up yet. Please ask a league admin to configure it in `/setup`.",
            ephemeral: true,
        });
    }

    const appealChannel = await interaction.client.channels
        .fetch(appealsChannelId)
        .catch(() => null);
    if (!appealChannel) {
        return await interaction.reply({
            content:
                "❌ **Configuration Error:** The configured appeals log channel could not be found or read by the bot.",
            ephemeral: true,
        });
    }

    const appealEmbed = new EmbedBuilder()
        .setTitle("⚖️ New Appeal Submitted")
        .setAuthor({
            name: interaction.user.tag,
            iconURL: interaction.user.displayAvatarURL(),
        })
        .setDescription(
            `**Appeal Reason:**\n${reason}\n\n**Submitted by:** <@${interaction.user.id}>`,
        )
        .setColor(0xf1c40f)
        .addFields({
            name: "Status",
            value: `⏳ Waiting for Seconds (0/${votesRequired})`,
        })
        .setFooter({ text: `Submitter ID: ${interaction.user.id}` })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("second_appeal_0")
            .setLabel("Second this Appeal")
            .setStyle(ButtonStyle.Primary),
    );

    await appealChannel.send({
        content: "🔔 **New Appeal Alert**",
        embeds: [appealEmbed],
        components: [row],
    });

    return await interaction.reply({
        content: `✅ Your appeal has been posted to <#${appealsChannelId}>. It needs \`${votesRequired}\` seconds to move forward.`,
        ephemeral: true,
    });
}

async function handleAppealButton(interaction, supabase) {
    const messageEmbed = interaction.message.embeds[0];
    if (!messageEmbed) return;

    const embed = EmbedBuilder.from(messageEmbed);

    // 📊 Load rule parameters from database context
    let votesRequired = 3;
    let logChannelId = null;
    let adminRoleId = null;

    try {
        const { data: config } = await supabase
            .from("league_configs")
            .select("appeal_votes_required, log_channel_id, admin_role_id")
            .eq("guild_id", interaction.guild.id)
            .single();

        if (
            config?.appeal_votes_required !== undefined &&
            config?.appeal_votes_required !== null
        ) {
            votesRequired = config.appeal_votes_required;
        }
        logChannelId = config?.log_channel_id;
        adminRoleId = config?.admin_role_id;
    } catch (dbErr) {
        console.error(
            "❌ Error loading system voting scale constraints:",
            dbErr,
        );
    }

    // Get count from the button ID (current count + 1)
    const currentCount = parseInt(interaction.customId.split("_")[2], 10) || 0;
    const newCount = currentCount + 1;

    const footerText = embed.data.footer?.text || "";
    const submitterId = footerText.replace("Submitter ID: ", "");

    // 1. Block original author from seconding
    if (interaction.user.id === submitterId) {
        return await interaction.reply({
            content: "❌ You cannot second your own appeal!",
            ephemeral: true,
        });
    }

    let currentDesc = embed.data.description || "";

    // 2. Anti-Spam Check
    const voterName = interaction.user.globalName || interaction.user.username;
    if (currentDesc.includes(`• ${voterName}`)) {
        return await interaction.reply({
            content: "❌ You already seconded this!",
            ephemeral: true,
        });
    }

    // 3. Add the user to the "Seconded by" list
    if (!currentDesc.includes("**Seconded by:**")) {
        currentDesc += `\n\n**Seconded by:**\n• ${voterName}`;
    } else {
        currentDesc += `\n• ${voterName}`;
    }
    embed.setDescription(currentDesc);

    // 4. Update View States or Finalize Benchmarks
    if (newCount < votesRequired) {
        embed.setFields({
            name: "Status",
            value: `⏳ Waiting for Seconds (${newCount}/${votesRequired})`,
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`second_appeal_${newCount}`)
                .setLabel(`Second (${newCount}/${votesRequired})`)
                .setStyle(ButtonStyle.Primary),
        );

        return await interaction.update({ embeds: [embed], components: [row] });
    } else {
        // SUCCESS: Target benchmark count fulfilled!
        embed.setColor(0x2ecc71).setFields({
            name: "Status",
            value: "✅ Seconded! Awaiting Committee Poll.",
        });

        await interaction.update({ embeds: [embed], components: [] });

        // Route notification to dynamic log channel table property if available
        if (logChannelId) {
            const logChannel = await interaction.client.channels
                .fetch(logChannelId)
                .catch(() => null);
            if (logChannel) {
                const roleMention = adminRoleId
                    ? `<@&${adminRoleId}>`
                    : "@League Admin";
                await logChannel.send({
                    content: `🚨 **APPEAL SECONDED** 🚨\n${roleMention} - Appeal has reached its requirement benchmark of \`${votesRequired}\` seconds.`,
                    embeds: [embed],
                });
            }
        }
    }
}

module.exports = {
    showAppealModal,
    handleAppealSubmit,
    handleAppealButton,
};
