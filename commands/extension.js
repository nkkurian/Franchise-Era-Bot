const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('extension')
        .setDescription('Search the Transaction Log for a player\'s history')
        .addStringOption(option => option.setName('name').setDescription('Player name').setRequired(true)),

    async execute(interaction, getSheetData) {
      const inputName = interaction.options.getString('name').toLowerCase();
	      const { logs } = await getSheetData();
	
	      // Filter logs where Column A matches the name
	      const extensionHistory = logs.filter(row => 
	        row._rawData[0]?.toLowerCase().includes(inputName)
	      );
	
	      if (extensionHistory.length === 0) {
	        return await interaction.editReply(`❌ No records found for **${inputName}** in the Transaction Log.`);
	      }
	
	      const extensionEmbed = new EmbedBuilder()
	        .setTitle(`📝 History: ${extensionHistory[0]._rawData[0]}`)
	        .setColor(0x9b59b6)
	        .setTimestamp();
	
	      extensionHistory.forEach((entry) => {
	        const years = entry._rawData[2]; 
	        const salary = entry._rawData[3]; // Column D
	        const bonus = entry._rawData[4];  // Column E
	        
	        // Strictly only listing Salary and Bonus
	        if (salary || bonus) {
	  // Logic: "4 Year Extension | 💰 $30M"
	            const titleLine = `${years || '?'} Year Extension | 💰 ${salary ? salary + 'M' : 'N/A'}`;
	            
	            extensionEmbed.addFields({
	              name: titleLine,
	              value: `✨ **Bonus:** ${bonus || 'None listed'}`,
	              inline: false
	            });
	          }
	      });
	
	      return await interaction.editReply({ embeds: [extensionEmbed] });
	    },
}; 
