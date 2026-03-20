const express = require('express');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const router = express.Router();

module.exports = (client, doc) => {
    router.post('/extension-report', async (req, res) => {
      const { teamName, channelId, ownerPings } = req.body;

  try {
    await doc.loadInfo();
    const teamSheet = doc.sheetsByTitle[teamName];
    if (!teamSheet) return res.status(404).send("Team not found");

    // 1. Get Extensions Left from J2
    await teamSheet.loadCells('J2');
    const extensionsLeft = teamSheet.getCellByA1('J2').value ?? "0";

    // 2. Fetch Roster
    const rows = await teamSheet.getRows();
    
    // 3. Filter: Years is 1 or 2 AND IsExtended (Col K / index 10) is not TRUE
    const eligible = rows.filter(row => {
      const name = row._rawData[0];
      const years = parseInt(row._rawData[2]);
      const isExtended = row._rawData[10]; // Column K
      
      return name && (years === 1 || years === 2) && isExtended !== "TRUE" && isExtended !== true;
    });

    const eligibleList = eligible.length > 0 
      ? eligible.map(p => `• **${p._rawData[0]}** (${p._rawData[1]}) | ${p._rawData[2]}yr left`).join('\n')
      : "✅ No players currently eligible for extension.";

    const channel = await client.channels.fetch(channelId);
    
    const extEmbed = new EmbedBuilder()
      .setTitle(`🏆 Extension Eligibility: ${teamName}`)
      .setDescription(eligibleList)
      .setColor(0x9b59b6) // Purple for "Elite/Extension" status
      .addFields({ name: '⭐ Extensions Remaining', value: `**${extensionsLeft}**`, inline: false })
      .setFooter({ text: "Questions? Ping @cap-goat • Role ID: 1479107336617332787" })
      .setTimestamp();

    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('📂 Open Roster')
        .setURL(`https://docs.google.com/spreadsheets/d/1-G39QNK9o0qbgBp3nKjjXHGuuSH4bx_xqNsR51jABM8`)
        .setStyle(ButtonStyle.Link)
    );

    await channel.send({
      content: `⭐️ Attention ${ownerPings}! ⭐️\nHere are your eligible extension candidates for the 2026 offseason.`,
      embeds: [extEmbed],
      components: [buttonRow]
    });

    res.status(200).send("Extension Report Sent");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});
  return router; 
} 
