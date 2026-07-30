const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('top')
        .setDescription('View the highest annual salaries in the league')
        .addIntegerOption(option => option.setName('count').setDescription('Number of players to show'))
        .addStringOption(option => 
            option.setName('position')
                .setDescription('Filter by position')
                .addChoices(
                    { name: 'Quarterback', value: 'QB' },
                    { name: 'Running Back', value: 'RB' },
                    { name: 'Wide Receiver', value: 'WR' },
                    { name: 'Tight End', value: 'TE' },
                    { name: 'Offensive Line', value: 'OL' },
                    { name: 'Defensive Line (DL/DE/DT)', value: 'DL' },
                    { name: 'Linebacker', value: 'LB' },
                    { name: 'Defensive Back (DB/CB/S)', value: 'DB' },
                    { name: 'Kicker', value: 'K' }
                )),

    async execute(interaction, supabase, config, getSheetData, getPlayerStats, getOwnerIdMap) {
        await interaction.deferReply();
  
        // Pass the server ID so it fetches the correct spreadsheet
        const { players } = await getSheetData(interaction.guild.id);
        const count = interaction.options.getInteger('count') || 10; 
        const posFilter = interaction.options.getString('position') || 'ALL';
  
        // Grab your Supabase column mapping configuration
        const mapping = config?.column_mapping || config?.settings || config;

        let filteredPlayers = players.filter(p => {
            if (!p) return false;
            const pName = p.name || p.playerName || p.rowRef?.get(mapping?.id_player_col || "Player Name");
            return !!pName;
        });
  
        if (posFilter !== 'ALL') {
            filteredPlayers = filteredPlayers.filter(p => {
                // Dynamically grab position from object properties or the mapped sheet column
                const playerPos = (p.position || p.pos || p.rowRef?.get(mapping?.position_col || "Position"))?.toUpperCase().trim();

                // Handle Defensive Line grouping
                if (posFilter === 'DL') {
                    return ['DL', 'DE', 'DT'].includes(playerPos);
                }

                // Handle Defensive Back grouping
                if (posFilter === 'DB') {
                    return ['DB', 'CB', 'S'].includes(playerPos);
                }

                // Standard exact match for QB, RB, WR, TE, OL, LB, K
                return playerPos === posFilter;
            });
        }
  
        const leaderboard = filteredPlayers
        .map(p => {
            // Extract values dynamically using Supabase mappings or clean properties
            const rawSalary = p.aav || p.salary || p.capHit || p.rowRef?.get(mapping?.salary_col || "Salary") || "$0.00";
            const pName = p.name || p.playerName || p.rowRef?.get(mapping?.id_player_col || "Player Name");
            const pPos = p.position || p.pos || p.rowRef?.get(mapping?.position_col || "Position") || "N/A";
            const pTeam = p.team || p.teamAffiliation || p.rowRef?.get(mapping?.team_col || "Team") || "FA";

            // Parse currency string safely into a mathematical number for sorting
            // Safe mathematical parsing of raw sheet values
            let salaryNum = 0;
            const cleanSalaryStr = String(rawSalary).toLowerCase().replace(/[$, ]/g, '');

            if (typeof rawSalary === 'number') {
                salaryNum = rawSalary;
            } else if (cleanSalaryStr.includes('m')) {
                // If it's formatted as "$30.5M", parse the float and convert to millions
                salaryNum = (parseFloat(cleanSalaryStr.replace('m', '')) || 0) * 1000000;
            } else {
                // Standard raw digit formatting (e.g., "30500000")
                salaryNum = parseFloat(cleanSalaryStr) || 0;
            }

            // Standardize output display formatting for the leaderboard text
            const finalSalaryStr = salaryNum >= 1000000 
                ? `$${(salaryNum / 1000000).toFixed(2)}M` 
                : `$${salaryNum.toLocaleString()}`;

            // Clean up the output string display format
            return {
            team: pTeam,
            name: pName,
            pos: pPos,
            salaryNum: salaryNum,
            salaryStr: finalSalaryStr
            };
        })
        .sort((a, b) => b.salaryNum - a.salaryNum)
        .slice(0, count);
  
      if (leaderboard.length === 0) {
        return await interaction.editReply(`❌ No players found for: **${posFilter}**.`);
      }
  
      const listText = leaderboard.map((p, i) => 
        `${i + 1}. **${p.name}** (${p.pos}) - ${p.team}: **${p.salaryStr}**`
      ).join('\n');
  
      // Dynamic Title logic for the embed
      let displayPos = posFilter;
      if (posFilter === 'DL') displayPos = 'DL/DE/DT';
      if (posFilter === 'DB') displayPos = 'DB/CB/S';
      if (posFilter === 'ALL') displayPos = 'Overall';
  
      const topEmbed = new EmbedBuilder()
        .setTitle(`💰 League Top ${leaderboard.length} ${displayPos} Salaries`)
        .setColor(0x2ecc71)
        .setDescription(listText)
        .setTimestamp();
  
      return await interaction.editReply({ embeds: [topEmbed] });
    },
}; 