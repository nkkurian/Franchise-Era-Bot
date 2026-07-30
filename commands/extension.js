const { normalizePlayerName } = require('../utils/sleeperLibrary');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('extension')
        .setDescription('Search the Transaction Log for a player\'s history')
        .addStringOption(option => option.setName('name').setDescription('Player name').setRequired(true)),

      // 1. Fixed parameter order to include 'config'
        async execute(interaction, supabase, config, getSheetData, getPlayerStats, getOwnerIdMap) {
          await interaction.deferReply();
          const inputName = interaction.options.getString('name').toLowerCase();

          // 2. Passed the guild ID into the sheet fetcher
          const { logs } = await getSheetData(interaction.guild.id);

          // 3. Added protective checks to make sure the row and raw data exist before filtering
          const normalizedInput = normalizePlayerName(inputName);

          const extensionHistory = logs.filter(row => {
              if (!row) return false;

              // Safely look for the player name property, falling back to _rawData column 1
              const playerName = row.name || row.playerName || row.player_name || row._rawData?.[0];
              if (typeof playerName !== 'string') return false;

              return normalizePlayerName(playerName).includes(normalizedInput);
          });

        if (extensionHistory.length === 0) {
          return await interaction.editReply(`❌ No records found for **${inputName}** in the Transaction Log.`);
        }

        // Grab the cleanly formatted name from the first sheet record found
        const officialName = extensionHistory[0].name || extensionHistory[0].playerName || extensionHistory[0]._rawData?.[0];

        // ⚡ Look up the matching Sleeper ID from our memory cache
        const normalizedOfficialName = normalizePlayerName(officialName);
        let sleeperId = null;

        for (const [id, cachedPlayer] of global.sleeperCache.entries()) {
            if (cachedPlayer.searchKey === normalizedOfficialName) {
                sleeperId = id;
                break;
            }
        }

        const extensionEmbed = new EmbedBuilder()
          .setTitle(`📝 Contract History: ${officialName}`)
          .setColor(0x9b59b6)
          .setTimestamp();

        // Dynamically attach the headshot if found in our global cache!
        if (sleeperId) {
            extensionEmbed.setThumbnail(`https://sleepercdn.com/content/nfl/players/${sleeperId}.jpg`);
        }

        extensionHistory.forEach((entry) => {
          // Flexible mapping: reads property names first, falls back to indices safely
          const years = entry.years || entry.yearsExtended || entry._rawData?.[2]; 
          const salary = entry.salary || entry.aav || entry._rawData?.[3]; 
          const bonus = entry.bonus || entry.signingBonus || entry._rawData?.[4];  

          if (salary || bonus) {
            const salaryText = salary ? String(salary).replace('M', '') + 'M' : 'N/A';
            const titleLine = `${years || '?'} Year Extension | 💰 ${salaryText}`;

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
