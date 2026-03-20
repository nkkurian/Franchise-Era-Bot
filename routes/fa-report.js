const express = require('express');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const router = express.Router();

module.exports = (client, doc) => {
    router.post('/fa-report', async (req, res) => {
      const { teamName, channelId, ownerPings } = req.body;

  try {
    console.log(`📡 FA Request Received for: ${teamName}`);
    
    await doc.loadInfo();
    const teamSheet = doc.sheetsByTitle[teamName];

    if (!teamSheet) {
      console.error(`❌ Sheet not found for team: ${teamName}`);
      return res.status(404).send("Team sheet not found.");
    }

    // 1. Fetch "Extensions Left" from Cell J2
    await teamSheet.loadCells('J2');
    const extensionsLeft = teamSheet.getCellByA1('J2').value ?? "0";

    // 2. Fetch all rows for player data
    const rows = await teamSheet.getRows();
    
    // 3. Filter for Free Agents (0 years left)
    const faPlayers = rows.filter(row => {
      const years = row._rawData[2]; 
      const name = row._rawData[0];
      return name && years === "0";
    });

    const playerList = faPlayers.length > 0 
      ? faPlayers.map(p => `• **${p._rawData[0]}** (${p._rawData[1]})`).join('\n')
      : "✅ All players are currently under contract for 2026.";

    // 4. Create the Spreadsheet Link Button
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('📂 Open League Spreadsheet')
        .setURL(`https://docs.google.com/spreadsheets/d/1-G39QNK9o0qbgBp3nKjjXHGuuSH4bx_xqNsR51jABM8`)
        .setStyle(ButtonStyle.Link)
    );

    // 5. Send to Discord
    const channel = await client.channels.fetch(channelId);
    if (!channel) throw new Error("Channel not found");

    const faEmbed = new EmbedBuilder()
      .setTitle(`🚨 2026 Expiring Contracts: ${teamName}`)
      .setDescription(playerList)
      .setColor(0xFF0000)
      .addFields(
        { name: '⏳ Extensions Remaining', value: `**${extensionsLeft}**`, inline: true },
        {name: 'Final Date:', value: 'The last date to resign is March 23. Resign before or they will be dropped'}, 
        { name: '🛠️ Errors?', value: `Ping <@&1479107336617332787> to be fixed`, inline: false }
      )
      .setFooter({ text: "Franchise Era Front Office • Official Roster Report" })
      .setTimestamp();

    await channel.send({
      content: `🚨 Attention ${ownerPings}! 🚨\nYour offseason roster report has arrived.`,
      embeds: [faEmbed],
      components: [buttonRow]
    });

    console.log(`✅ FA Report Posted for ${teamName}`);
    res.status(200).send("Report Sent Successfully");

  } catch (err) {
            console.error(err);
            res.status(500).send("Server Error");
        }
    });
return router; 
}
    
