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

        // Add 'config' to your arguments here
        async execute(interaction, supabase, config, getSheetData, getPlayerStats) {
        // Keeping it ephemeral so only the sender sees the confirmation
                await interaction.deferReply({ ephemeral: true });

                try {
                    if (!supabase) {
                        return await interaction.editReply(
                            "❌ **System Error.** Database client is uninitialized in this context."
                        );
                    }

                    // 🛠️ FIX: Restored the query to pull down dbConfig from Supabase
                    const { data: dbConfig, error } = await supabase
                        .from("league_configs")
                        .select("trade_channel_id")
                        .eq("guild_id", interaction.guild.id)
                        .single();

                    // Handle scenario where configuration doesn't exist yet
                    if (error || !dbConfig || !dbConfig.trade_channel_id) {
                        console.error("❌ Database Lookup Error for Sent-Trade Config:", error?.message);
                        return await interaction.editReply(
                            "❌ **Configuration Missing.** This server hasn't set up its trade alerts log channel yet via the configuration manager."
                        );
                    }

                    const tradeChannelId = dbConfig.trade_channel_id;
                    const logChannel = await interaction.client.channels.fetch(tradeChannelId).catch(() => null);
    
                if (!logChannel) {
                    return await interaction.editReply(
                        "❌ Error: Could not find the trade log channel.",
                    );
                }
    
                const teamInput = interaction.options.getString("team");
                const notes =
                    interaction.options.getString("notes") || "No notes provided.";
    
                // --- DYNAMIC DATABASE ROLE LOOKUP LOGIC ---
                let ownerPing = "";
                let teamDisplayName = teamInput;
    
                if (config?.sleeper_team_roles) {
                    // Loop through the database roles config to find the team name match
                    for (const [userId, data] of Object.entries(config.sleeper_team_roles)) {
                        if (data.teamName && data.teamName.toLowerCase().includes(teamInput.toLowerCase())) {
                            teamDisplayName = data.teamName; // Set formal casing name
    
                            // If they have a synced Discord role mapped to this team, use it to ping!
                            if (data.roleId) {
                                ownerPing = `<@&${data.roleId}>`; // 👈 Role ping syntax (<@&ID>)
                            }
                            break;
                        }
                    }
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
                        ? `✅ Alert sent! **${teamDisplayName}** has been notified.`
                        : `✅ Alert sent for **${teamInput}**, but I couldn't find a configured Discord role matching that team to ping. Please let an admin know.`,
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
