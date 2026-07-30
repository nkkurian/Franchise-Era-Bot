const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const setupManager = require("../utils/setupManager");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Opens the live league layout configuration dashboard")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, supabase) {
        // This fires the code in your manager file
        return await setupManager.sendDashboard(interaction, supabase);
    },
};
