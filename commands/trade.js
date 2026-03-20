const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Analyze trade impact')
    .addStringOption(o => o.setName('teama').setDescription('First team').setRequired(true))
    .addStringOption(o => o.setName('teama_players').setDescription('Players from first team').setRequired(true))
    .addStringOption(o => o.setName('teamb').setDescription('Second team').setRequired(true))
    .addStringOption(o => o.setName('teamb_players').setDescription('Players from second team').setRequired(true)),

    async execute(interaction, getSheetData) {
      const { players } = await getSheetData();
      const tA = interaction.options.getString('teama');
      const pA_input = interaction.options.getString('teama_players').split(',').map(p => p.trim().toLowerCase());
      const tB = interaction.options.getString('teamb');
      const pB_input = interaction.options.getString('teamb_players').split(',').map(p => p.trim().toLowerCase());

      const getSideData = async (teamName, playersIn) => {
        const sh = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(teamName.toLowerCase()));
        let cap = 0;
        if (sh) {
            await sh.loadCells('F2'); 
            cap = parseFloat((sh.getCellByA1('F2').formattedValue || "0").replace(/[$,]/g, '')) || 0;
        }

        let totalCapSent = 0;
        let playerDetails = [];

        playersIn.forEach(pn => {
            const r = players.find(row => row._rawData[1]?.toLowerCase().includes(pn));
            if (r) {
                const hit = parseFloat((r._rawData[6] || "0").replace(/[$,]/g, ''));
                totalCapSent += hit;
                let structureText = r._rawData[10] ? `\n    ┗ 📜 *${r._rawData[10].slice(0, 50)}...*` : "";
                playerDetails.push(`• ${r._rawData[1]}: **$${hit.toLocaleString()}**${structureText}`);
            } else {
                playerDetails.push(`• ${pn}: *Not Found*`);
            }
        });
        return { title: sh ? sh.title : teamName, cap, totalCapSent, playerDetails };
      };

      const [sA, sB] = await Promise.all([getSideData(tA, pA_input), getSideData(tB, pB_input)]);
      
      const tradeEmbed = new EmbedBuilder()
        .setTitle('🤝 Detailed Trade Analysis')
        .setColor(0xe67e22)
        .addFields(
          { name: `📤 From ${sA.title}`, value: sA.playerDetails.join('\n') || "None", inline: false },
          { name: `📥 From ${sB.title}`, value: sB.playerDetails.join('\n') || "None", inline: false },
          { name: `${sA.title} New Cap`, value: `**$${(sA.cap + sA.totalCapSent - sB.totalCapSent).toLocaleString()}**`, inline: true },
          { name: `${sB.title} New Cap`, value: `**$${(sB.cap + sB.totalCapSent - sA.totalCapSent).toLocaleString()}**`, inline: true }
        );

      return await interaction.editReply({ embeds: [tradeEmbed] });
    }
  } catch (err) {
    console.error(err);
    if (!interaction.replied) await interaction.editReply("⚠️ Bot Error.");
  }
}; 
