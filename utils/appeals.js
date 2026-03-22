const { 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle 
} = require('discord.js');

const APPEAL_CHANNEL_ID = '1477399855541518366';
const LOG_CHANNEL_ID = '1477399855541518366';
const COMMITTEE_ROLE_ID = '1399502952506458252';

async function showAppealModal(interaction) {
  const modal = new ModalBuilder()
	            .setCustomId('appealModal')
	            .setTitle('Official League Appeal');
	
	        const reasonInput = new TextInputBuilder()
	            .setCustomId('appealReason')
	            .setLabel("What are you appealing and why?")
	            .setStyle(TextInputStyle.Paragraph)
	            .setPlaceholder("e.g., The trade between Team A and Team B was unfairly vetoed...")
	            .setRequired(true);
	
	        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
	        return await interaction.showModal(modal);
	    }

async function handleAppealSubmit(interaction) {
  const reason = interaction.fields.getTextInputValue('appealReason');
        const appealChannel = await interaction.client.channels.fetch('1477399855541518366'); // Replace ID

        // Inside your appealModal handler
              const appealEmbed = new EmbedBuilder()
                .setTitle('⚖️ New Appeal Submitted')
                .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                .setDescription(`**Appeal Reason:**\n${reason}\n\n**Submitted by:** <@${interaction.user.id}>`) 
                .setColor(0xF1C40F)
                .addFields({ name: 'Status', value: '⏳ Waiting for Seconds (0/4)' })
                // ADD THIS LINE: This "hides" the ID in the footer for the bot to check later
                .setFooter({ text: `Submitter ID: ${interaction.user.id}` }) 
                .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('second_appeal_0') // We will track the count in the ID
                .setLabel('Second this Appeal')
                .setStyle(ButtonStyle.Primary)
        );

        await appealChannel.send({ content: '🔔 **New Appeal Alert**', embeds: [appealEmbed], components: [row] });
        return await interaction.reply({ content: '✅ Your appeal has been posted. It needs 4 more people to second it.', ephemeral: true });
    }

async function handleAppealButton(interaction) {
  const messageEmbed = interaction.message.embeds[0];
    if (!messageEmbed) return;

    const embed = EmbedBuilder.from(messageEmbed);
    
    // Get count from the button ID (current count + 1)
    const currentCount = parseInt(interaction.customId.split('_')[2]);
    const newCount = currentCount + 1;

    const footerText = embed.data.footer?.text || ""; 
    const submitterId = footerText.replace("Submitter ID: ", "");

    // 1. Block the original author
    if (interaction.user.id === submitterId) {
        return await interaction.reply({ content: "❌ You cannot second your own appeal!", ephemeral: true });
    }
    
    let currentDesc = embed.data.description || "";

    // 2. Anti-Spam Check (using global name or username)
    const voterName = interaction.user.globalName || interaction.user.username;
    if (currentDesc.includes(`• ${voterName}`)) {
        return await interaction.reply({ content: "❌ You already seconded this!", ephemeral: true });
    }

    // 3. Add the user to the "Seconded by" list
    if (!currentDesc.includes("**Seconded by:**")) {
        currentDesc += `\n\n**Seconded by:**\n• ${voterName}`;
    } else {
        currentDesc += `\n• ${voterName}`;
    }
    embed.setDescription(currentDesc);

    // 4. Update or Finalize
    if (newCount < 1) {
        embed.setFields({ name: 'Status', value: `⏳ Waiting for Seconds (${newCount}/4)` });
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`second_appeal_${newCount}`) // Pass the new count to the next button
                .setLabel(`Second (${newCount}/4)`)
                .setStyle(ButtonStyle.Primary)
        );

        return await interaction.update({ embeds: [embed], components: [row] });

    } else {
        // SUCCESS: Hit 4 seconds
        embed.setColor(0x2ECC71)
             .setFields({ name: 'Status', value: '✅ Seconded! Awaiting Committee Poll.' });
        
        await interaction.update({ embeds: [embed], components: [] });
        
        // Final Log Ping
        const logChannel = await interaction.client.channels.fetch('1477399855541518366');
        await logChannel.send({ 
            content: `🚨 **APPEAL SECONDED** 🚨\n<@&1399502952506458252> - Appeal has reached 4 seconds.`,
            embeds: [embed] 
        });
    }
} 
	module.exports = { 
    showAppealModal, 
    handleAppealSubmit, 
    handleAppealButton 
};
	


