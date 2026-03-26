const express = require('express');
const { EmbedBuilder } = require('discord.js');
const router = express.Router();

module.exports = (client) => {
    router.post('/cap-report', async (req, res) => {
        const { teamName, channelId, ownerPings, data } = req.body;

        try {
            const channel = await client.channels.fetch(channelId);
            if (!channel) return res.status(404).send("Channel not found");

            const capEmbed = new EmbedBuilder()
                .setTitle(`💰 Salary Cap & Bonus Summary: ${teamName}`)
                .setColor(0x2ecc71) // Green for money
                .setThumbnail('https://cdn-icons-png.flaticon.com/512/2489/2489756.png')
                .addFields(
                    { name: '📉 Current Cap Space', value: `**$${Number(data.capSpace).toLocaleString()}**`, inline: false },
                    { name: '━━━━━━━━━━━━━━━━━━━━━━━━', value: '📊 **Offseason Bonus Breakdown**', inline: false },
                    { name: '🔄 Carryover', value: `$${data.carryover.toLocaleString()}`, inline: true },
                    { name: '🎮 GOTW', value: `$${data.gotw.toLocaleString()}`, inline: true },
                    { name: '🌟 All Pro', value: `$${data.allPro.toLocaleString()}`, inline: true },
                    { name: '🏆 Playoff Bracket', value: `$${data.playoff.toLocaleString()}`, inline: true },
                    { name: '📈 Total Cap Increase', value: `**$${data.totalIncrease.toLocaleString()}**`, inline: false }
                )
                .setFooter({ text: "Franchise Era Finance Office • 2026 Fiscal Report" })
                .setTimestamp();

            await channel.send({
                content: `📊 ${ownerPings}, your financial summary for the 2026 season is ready.`,
                embeds: [capEmbed]
            });

            res.status(200).send("Cap Report Sent");
        } catch (err) {
            console.error("Cap Report Error:", err);
            res.status(500).send("Error");
        }
    });
    return router;
};
