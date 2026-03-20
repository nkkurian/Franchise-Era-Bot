const { EmbedBuilder } = require('discord.js');

async function runWeeklyAudit(client, getSheetData) {
  console.log("⏳ Running Weekly Cap Compliance Audit...");
    try {
        const data = await getSheetData(); 
        const players = data.players;
        const currentDoc = data.doc; // Pulling the doc we just added above

        if (!currentDoc) {
            console.error("❌ Cron Error: 'doc' is still missing from getSheetData results.");
            return;
        }

        const nonCompliant = [];
        const missingData = [];

        const teams = [...new Set(players.map(p => p._rawData[0]).filter(t => t && t !== "Free Agent"))];
        
        for (const teamName of teams) {
            const sheet = currentDoc.sheetsByIndex.find(s => s.title.toLowerCase().includes(teamName.toLowerCase()));
            if (!sheet) continue;

            await sheet.loadCells('F2');
            const capRaw = sheet.getCellByA1('F2').formattedValue || "$0.00";
            const capNum = parseFloat(capRaw.replace(/[$,]/g, '')) || 0;
            
            if (capNum < 0) {
                nonCompliant.push({ name: sheet.title, balance: capRaw });
            }

            const teamRoster = players.filter(p => p._rawData[0] === teamName);
            const buggyPlayers = teamRoster.filter(p => (parseFloat(p._rawData[4]?.replace(/[$,]/g, '')) || 0) === 0);
            if (buggyPlayers.length > 0) {
                missingData.push({ team: sheet.title, players: buggyPlayers.map(p => p._rawData[1]) });
            }
        }

        const logChannel = await client.channels.fetch('1477399855541518366'); 
        const reportEmbed = new EmbedBuilder()
            .setTitle('📅 Weekly League Audit Report')
            .setColor(nonCompliant.length > 0 ? 0xe74c3c : 0x2ecc71)
            .setTimestamp();

        let pingContent = "";
        if (nonCompliant.length > 0) {
            pingContent = "⚠️ <@&1399502952506458252> **Action Required:** Cap issues detected.";
            reportEmbed.addFields({ 
                name: '🚨 Non-Compliant Teams (Negative Cap)', 
                value: nonCompliant.map(t => `• **${t.name}**: ${t.balance}`).join('\n') 
            });
        } else {
            reportEmbed.setDescription('✅ All teams are currently under the salary cap.');
        }

        if (missingData.length > 0) {
            reportEmbed.addFields({ 
                name: '⚠️ Missing Salary Data', 
                value: missingData.map(m => `• **${m.team}**: ${m.players.join(', ')}`).join('\n') 
            });
        }

        if (logChannel) {
            await logChannel.send({ content: pingContent, embeds: [reportEmbed] });
            console.log("✅ Audit Report posted to channel.");
        }

    } catch (err) {
        console.error("❌ Cron Error Detail:", err);
    }
} 

module.exports = {runWeeklyAudit}; 
