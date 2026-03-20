const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('team')
        .setDescription('View a team\'s cap space and top earners')
        .addStringOption(option => 
            option.setName('teamname')
                .setDescription('The name of the team')
                .setRequired(true)),

    async execute(interaction, getSheetData) {
      const teamInput = interaction.options
	                .getString("teamname")
	                .toLowerCase();
				const {players, doc} = await getSheetData(); 
	            // 1. Find the specific team sheet
	            const sheet = doc.sheetsByIndex.find((s) =>
	                s.title.toLowerCase().includes(teamInput),
	            );
	
	            if (!sheet) {
	                return await interaction.editReply(
	                    `❌ Team **${teamInput}** not found in the spreadsheet.`,
	                );
	            }
	
	            // 2. Load Cap Info from F2 and F3
	            await sheet.loadCells("F2:J2");
	            const capSpace = sheet.getCellByA1("F2").formattedValue || "$0.00";
	            const extensionsLeft =
	                sheet.getCellByA1("J2").formattedValue || "0";
	
	            // 3. Filter players from the main PlayerList for this team
	            const teamPlayers = players.filter((p) =>
	                p._rawData[0]?.toLowerCase().includes(teamInput),
	            );
	
	            // 4. Sort by Salary (Column E / index 4)
	            const topEarners = teamPlayers
	                .map((p) => {
	                    const salaryStr = p._rawData[4] || "$0.00";
	                    const salaryNum =
	                        parseFloat(salaryStr.replace(/[$,]/g, "")) || 0;
	                    return {
	                        name: p._rawData[1],
	                        pos: p._rawData[2],
	                        salary: salaryStr,
	                        num: salaryNum,
	                    };
	                })
	                .sort((a, b) => b.num - a.num)
	                .slice(0, 5); // Show top 5 earners
	
	            const earnerList =
	                topEarners.length > 0
	                    ? topEarners
	                          .map((p) => `• **${p.name}** (${p.pos}): ${p.salary}`)
	                          .join("\n")
	                    : "No roster data found.";
	
	            // 🔗 GENERATE DIRECT LINK
	            // Format: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit#gid=SHEET_ID
	            const sheetLink = `https://docs.google.com/spreadsheets/d/${doc.spreadsheetId}/edit#gid=${sheet.sheetId}`;
	
	            const teamEmbed = new EmbedBuilder()
	                .setTitle(`📊 Team Report: ${sheet.title}`)
	                .setURL(sheetLink) // Makes the Title itself a clickable link
	                .setColor(0x3498db)
	                .addFields(
	                    {
	                        name: "💰 Current Cap Space",
	                        value: `**${capSpace}**`,
	                        inline: true,
	                    },
	                    {
	                        name: "⏳ Extensions Left",
	                        value: `**${extensionsLeft}**`,
	                        inline: true,
	                    },
	                    {
	                        name: "🔝 Top Earners",
	                        value: earnerList,
	                        inline: false,
	                    },
	                    {
	                        name: "🔗 Quick Link",
	                        value: `[Open ${sheet.title} Tab](${sheetLink})`,
	                        inline: false,
	                    },
	                )
	                .setFooter({
	                    text: "Franchise Pro • Click title to view sheet",
	                })
	                .setTimestamp();
	
	            return await interaction.editReply({ embeds: [teamEmbed] });
	        },
}; 
  
