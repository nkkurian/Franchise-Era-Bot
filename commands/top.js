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

    async execute(interaction, getSheetData) {
		await interaction.deferReply();
		const { players } = await getSheetData();
      const count = interaction.options.getInteger('count') || 10; 
	  const posFilter = interaction.options.getString('position') || 'ALL';
	
	  let filteredPlayers = players.filter(p => p._rawData[1]); 
	  
	  if (posFilter !== 'ALL') {
	    filteredPlayers = filteredPlayers.filter(p => {
	      const playerPos = p._rawData[2]?.toUpperCase();
	      
	      // Handle Defensive Line grouping
	      if (posFilter === 'DL') {
	        return ['DL', 'DE', 'DT'].includes(playerPos);
	      }
	      
	      // Handle Defensive Back grouping
	      if (posFilter === 'DB') {
	        return ['DB', 'CB', 'S'].includes(playerPos);
	      }
	      
	      // Standard exact match for QB, RB, WR, TE, LB, K
	      return playerPos === posFilter;
	    });
	  }
	
	  const leaderboard = filteredPlayers
	    .map(p => {
	      const salaryStr = p._rawData[4] || "$0.00";
	      let salaryNum = parseFloat(salaryStr.replace(/[$,]/g, '')) || 0;
	      if (salaryStr.toLowerCase().includes('m') && salaryNum < 1000) {
	        salaryNum *= 1000000;
	      }
	
	      return {
	        team: p._rawData[0] || "FA",
	        name: p._rawData[1],
	        pos: p._rawData[2],
	        salaryNum: salaryNum,
	        salaryStr: salaryStr
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
