const { SlashCommandBuilder } = require('discord.js');
const { showAppealModal } = require('../utils/appeals.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('appeal')
        .setDescription('Submit an official appeal to the committee'),
    async execute(interaction) {
        await showAppealModal(interaction);
    },
};