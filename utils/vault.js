const { 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle 
} = require('discord.js');

module.exports = {
  handleVaultTrigger: async (message) => {
    if (message.content.toLowerCase() === '!vault' && !message.author.bot) {
        await message.delete().catch(() => null); 

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('trigger_admin_modal')
                .setLabel('🔓 Open Admin Vault')
                .setStyle(ButtonStyle.Danger)
        );

        // NOTE: This cannot be ephemeral because it's a standard message.
        // It will be visible to everyone until the admin clicks it.
        const vaultMsg = await message.channel.send({ 
            content: "🔒 **Secure Access Point Detected.**", 
            components: [row] 
        });
    }
  }, 

  showAdminModal: async (interaction) => {
    const modal = new ModalBuilder()
            .setCustomId('adminLoginModal')
            .setTitle('Admin Access');

        const passwordInput = new TextInputBuilder()
            .setCustomId('adminPassword')
            .setLabel("Enter Admin Password")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(passwordInput));
        return await interaction.showModal(modal);
    },
  showAdminPanel: async (interaction) => {
    const password = interaction.fields.getTextInputValue('adminPassword');

    if (password === 'LeagueAdmin2026') {
      const adminEmbed = new EmbedBuilder()
        .setTitle('🛠️ Admin Command Center')
        .setDescription('Authentication successful. Choose an automated task below.')
        .setColor(0xe74c3c);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('run_sync')
          .setLabel('🔄 Sync Sheets & Reload Cache')
          .setStyle(ButtonStyle.Danger),
		  new ButtonBuilder()
            .setCustomId('run_manual_audit')
            .setLabel('⚖️ Run Cap Audit')
            .setStyle(ButtonStyle.Secondary)
      );

      return await interaction.reply({ 
        embeds: [adminEmbed], 
        components: [row], 
        ephemeral: true 
      });
    } else {
      return await interaction.reply({ content: '❌ Incorrect password.', ephemeral: true });
    }
  }
};
