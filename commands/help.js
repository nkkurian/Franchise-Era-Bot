const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('View all available league commands and guides'),

      // Added this first line
    async execute(interaction, supabase, config, getSheetData, getPlayerStats, getOwnerIdMap) {
    //await interaction.deferReply();
      const { players, logs } = await getSheetData();

        const helpEmbed = new EmbedBuilder()
          .setTitle('📚 Franchise Pro Bot: Command Guide')
          .setColor(0x00AAFF)
          .setDescription('Manage and view league salaries, trades, and contracts.')
          .addFields(
            { 
              name: '💰 `/salary [player]`', 
              value: 'Search for a player\'s current contract. If they have a history in the logs, a **View History** button will appear.' 
            },
			{ 
              name: '📊 `/team [teamname] [count] [position]`', 
              value: 'View a team\'s cap space and top earners. You can now filter by position or increase the list size.' 
            },
			{
				name: '🔑 `/login `',
				value: 'Login to team portal to use bot secretly, submit extensions and calculate for restructures'
			},
			{ 
              name: '🤝 `/trade [Team A] [Players A] [Team B] [Players B]`', 
              value: 'Analyze the cap impact of a trade. Calculates new cap totals for both teams based on players moved.' 
            },
			{
				name: '/`sent-trade [team] [notes]`',
				value: 'Alert individual teams via Discord that a DM or trade was sent to them'
			},
			{
				name: '/`trade-alert`',
				value: 'Alert the league to a player on the block'
			},
            { 
              name: '🔄 `/extension [name]`', 
              value: 'Search the Transaction Log for a player\'s historical salary changes, extensions, and bonus structures.' 
            },
            { 
              name: '🏆 `/top [count] [position]`', 
              value: 'View the highest annual salaries across the entire league with a position dropdown menu.' 
            }
          )
          .setFooter({ text: `Tracking ${players.length} players and ${logs.length} transactions.` }) //
          .setTimestamp();

        return await interaction.reply({ embeds: [helpEmbed] });
    },
}; 