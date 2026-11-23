// utils/discordNotifier.js
const { EmbedBuilder } = require('discord.js');

async function sendBidStatusEmbed(discordClient, channelId, offerData, actionType, commissionerName = "Commissioner") {
    console.log("  🤖 [BOT NOTIFIER] sendBidStatusEmbed invoked.");
    console.log("  🤖 [BOT NOTIFIER] Action:", actionType, "| Target Channel:", channelId);

    if (!discordClient) {
        console.error("  ❌ [BOT NOTIFIER] discordClient parameter is null/undefined.");
        return false;
    }
    if (!channelId) {
        console.error("  ❌ [BOT NOTIFIER] channelId parameter is null/undefined.");
        return false;
    }

    try {
        console.log(`  🤖 [BOT NOTIFIER] Fetching Discord channel ${channelId}...`);
        const channel = await discordClient.channels.fetch(String(channelId).trim());

        if (!channel) {
            console.error(`  ❌ [BOT NOTIFIER] Channel ID ${channelId} fetched but returned null.`);
            return false;
        }

        console.log(`  🤖 [BOT NOTIFIER] Channel found: #${channel.name} (${channel.guild?.name})`);

        const normalizedAction = String(actionType).toUpperCase();
        const signedConfig = {
            title: "⚡ CONTRACT SIGNED & APPROVED",
            color: 0x10B981,
            description: `**${offerData.to_player}** has officially signed with **${offerData.from_team}**!`
        };

        const actionConfigs = {
            ACCEPTED: signedConfig,
            SIGNED: signedConfig,
            DECLINED: {
                title: "❌ OFFER DECLINED",
                color: 0xEF4444,
                description: `Contract offer for **${offerData.to_player}** from **${offerData.from_team}** was declined.`
            },
            EXPIRED: {
                title: "⏰ BID EXPIRED",
                color: 0xF59E0B,
                description: `The pending offer for **${offerData.to_player}** from **${offerData.from_team}** has expired.`
            }
        };

        const config = actionConfigs[normalizedAction] || signedConfig;
        const aavFormatted = `$${(Number(offerData.aav) || 0).toLocaleString()}`;
        const totalValFormatted = `$${((Number(offerData.aav) || 0) * (Number(offerData.years) || 1)).toLocaleString()}`;

        const embed = new EmbedBuilder()
            .setTitle(config.title)
            .setDescription(config.description)
            .setColor(config.color)
            .addFields(
                { name: "Target Player", value: offerData.to_player || "N/A", inline: true },
                { name: "Franchise", value: offerData.from_team || "N/A", inline: true },
                { name: "AAV / Duration", value: `${aavFormatted} / yr (${offerData.years} yrs)`, inline: true },
                { name: "Total Value", value: totalValFormatted, inline: true },
                { name: "Processed By", value: commissionerName, inline: true }
            )
            .setFooter({ text: "Front Office Portal • Free Agency Sync" })
            .setTimestamp();

        console.log("  🤖 [BOT NOTIFIER] Sending embed payload to channel...");
        await channel.send({ embeds: [embed] });
        console.log(`  ✅ [BOT NOTIFIER] Embed sent successfully!`);
        return true;

    } catch (err) {
        console.error("  ❌ [BOT NOTIFIER] Exception while fetching channel or sending message:", err);
        return false;
    }
}

async function sendDirectTeamAlert(discordClient, channelId, offerData, customMessage, commissionerName = "Commissioner") {
    if (!discordClient || !channelId) return false;

    try {
        const channel = await discordClient.channels.fetch(String(channelId).trim());
        if (!channel) return false;

        const embed = new EmbedBuilder()
            .setTitle(`💬 MESSAGE FROM COMMISSIONER`)
            .setDescription(`**Target Player:** ${offerData.to_player || "N/A"}\n**Franchise:** ${offerData.from_team || "N/A"}\n\n**Message:**\n> ${customMessage}`)
            .setColor(0x06B6D4)
            .setFooter({ text: "Front Office Portal" })
            .setTimestamp();

        const userMention = offerData.user_id ? `<@${offerData.user_id}>` : `**${offerData.from_team}**`;
        await channel.send({ content: `Attention ${userMention}:`, embeds: [embed] });
        return true;
    } catch (err) {
        console.error("Error sending team alert embed:", err);
        return false;
    }
}

module.exports = { sendBidStatusEmbed, sendDirectTeamAlert };