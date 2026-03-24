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

		showAdminPanel: async (interaction) => {
        const password = interaction.fields.getTextInputValue('adminPassword');
        if (password !== 'LeagueAdmin2026') {
            return await interaction.reply({ content: '❌ Incorrect password.', ephemeral: true });
        }

        const adminEmbed = new EmbedBuilder()
            .setTitle('🛠️ Admin Command Center')
            .setDescription('Select a management tool:')
            .setColor(0xe74c3c);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('vault_modify_search').setLabel('👤 Modify Player').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('run_sync').setLabel('🔄 Sync Cache').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('run_manual_audit').setLabel('⚖️ Cap Audit').setStyle(ButtonStyle.Secondary)
        );

        return await interaction.reply({ embeds: [adminEmbed], components: [row], ephemeral: true });
    },

    // 1. Ask for the Player Name
    showPlayerSearch: async (interaction) => {
        const modal = new ModalBuilder().setCustomId('vault_player_search_modal').setTitle('Find Player');
        const nameInput = new TextInputBuilder()
            .setCustomId('search_name')
            .setLabel("Player Name")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g. Patrick Mahomes")
            .setRequired(true);
        
        modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
        await interaction.showModal(modal);
    },

    // 2. Ask what to do with that player
    showActionBranch: async (interaction) => {
        const playerName = interaction.fields.getTextInputValue('search_name');
        
        const embed = new EmbedBuilder()
            .setTitle(`Management: ${playerName}`)
            .setDescription(`What action are we taking for **${playerName}**?`)
            .setColor(0x3498db);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vault_sign_${playerName}`).setLabel('✍️ Sign').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`vault_ext_${playerName}`).setLabel('⏳ Extend').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`vault_restruct_${playerName}`).setLabel('✂️ Restructure').setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    },

    // 3. The Final Data Entry Modal
    showFinalActionModal: async (interaction, action, playerName) => {
        const modal = new ModalBuilder()
            .setCustomId(`vault_finalize_${action}_${playerName}`)
            .setTitle(`${action.toUpperCase()}: ${playerName}`);

        // Common fields for all actions
        const salaryInput = new TextInputBuilder()
            .setCustomId('input_salary').setLabel("Yearly Salary (e.g. 15.5)").setStyle(TextInputStyle.Short).setRequired(true);
        
        const yearsInput = new TextInputBuilder()
            .setCustomId('input_years').setLabel("Years").setStyle(TextInputStyle.Short).setRequired(true);

        const notesInput = new TextInputBuilder()
            .setCustomId('input_notes').setLabel("Notes / Structure").setStyle(TextInputStyle.Paragraph).setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(salaryInput),
            new ActionRowBuilder().addComponents(yearsInput),
            new ActionRowBuilder().addComponents(notesInput)
        );

        await interaction.showModal(modal);
		
    } else {
      return await interaction.reply({ content: '❌ Incorrect password.', ephemeral: true });
    }
  }
};
