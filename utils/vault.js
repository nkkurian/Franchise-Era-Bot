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
            .setStyle(ButtonStyle.Secondary), 
		  new ButtonBuilder().setCustomId('vault_modify_search').setLabel('👤 Modify Player').setStyle(ButtonStyle.Primary)
      );

      return await interaction.reply({ 
                embeds: [adminEmbed], 
                components: [row], 
                ephemeral: true 
            });
        } else {
            return await interaction.reply({ content: '❌ Incorrect password.', ephemeral: true });
        }
    },

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
            .setDescription(`Select the transaction type for **${playerName}**:`)
            .setColor(0x3498db);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vault_sign_${playerName}`).setLabel('✍️ Sign').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`vault_ext_${playerName}`).setLabel('⏳ Extend').setStyle(ButtonStyle.Primary),
        );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    },

    // 3. The Final Data Entry Modal
    // 3. The Final Data Entry Modal
    showFinalActionModal: async (interaction, action, playerName) => {
        // We use 'vlt_fin_' to match the check in index.js
        const modal = new ModalBuilder()
            .setCustomId(`vlt_fin_${action}_${playerName}`)
            .setTitle(`${action.toUpperCase()}: ${playerName}`);

        // Each TextInput MUST be in its own ActionRow
        const salaryRow = new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('in_sal')
                .setLabel("Yearly Salary (e.g. 15.5)")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
        );

        const yearsRow = new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('in_yrs')
                .setLabel("Total Contract Years")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
        );

        const notesRow = new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('in_struct')
                .setLabel("Notes / Structure")
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder("e.g. Fully Guaranteed, Backloaded, etc.")
                .setRequired(false)
        );

        // Add the rows to the modal
        modal.addComponents(salaryRow, yearsRow, notesRow);

        return await interaction.showModal(modal);
    }
};
