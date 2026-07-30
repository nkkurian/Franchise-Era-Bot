const { EmbedBuilder, ActionRowBuilder, RoleSelectMenuBuilder } = require('discord.js');
const setupManager = require('./setupManager.js'); 

async function handleSetupInteractions(interaction, supabase) {
    console.log(`📥 [SetupRouter Log] Received Interaction ID: "${interaction.customId}" | Type: ${interaction.componentType}`);

    try {
        // --- 1. HANDLE CORE INTERFACE ROUTING BUTTONS ---

        // Catch the Sleeper button click / back action
        if (interaction.customId === 'nav_sleeper') {
            console.log("➡️ Routing to the main Sleeper & Misc Sub-Menu Dashboard...");
            return await setupManager.sendSleeperMenu(interaction, supabase); 
            // ^ Change this to match the name of the function in your setupManager.js 
            // that builds the menu with the Sync and Manual buttons (e.g., sendSleeperMenu, showSleeperHub, etc.)
        }

        // 👤 Clicking "Back" from a role page still goes back to the roles dashboard layout
        if (interaction.customId === 'nav_roles_dashboard') {
            console.log("➡️ Routing back to Roles Dashboard...");
            return await setupManager.sendRolesDashboard(interaction, supabase);
        }

        if (interaction.customId === "setup_auto_salary_btn") {
            return await setupManager.showAutoSalaryModal(interaction, supabase);
        }

        if (interaction.customId === 'setup_sync_team_roles') {
            console.log("➡️ Routing to initial auto-sync execution...");
            return await setupManager.syncSleeperTeamRoles(interaction, supabase);
        }

        if (interaction.customId === 'nav_manual_roles') {
            console.log("➡️ Routing to initial manual mapping menu...");
            return await setupManager.sendManualRoleMappingMenu(interaction, supabase);
        }

        if (interaction.customId === 'setup_confirm_save_roles') {
            console.log("➡️ Routing to database commit sequence...");
            return await setupManager.handleConfirmSaveRoles(interaction, supabase);
        }

        if (interaction.customId === "modal_auto_salary_config") {
            return await setupManager.handleAutoSalarySubmit(interaction, supabase);
        }
        

        // PAGINATION: Manual Role Selection
        if (interaction.customId && interaction.customId.includes('manual_roles_page_')) {
            console.log("➡️ Routing to manual mapping pagination...");
            return await setupManager.sendManualRoleMappingMenu(interaction, supabase);
        }

        // PAGINATION: Auto-Sync Audit Log
        if (interaction.customId && interaction.customId.includes('sync_team_roles_page_')) {
            console.log("➡️ Routing to auto-sync pagination...");
            return await setupManager.syncSleeperTeamRoles(interaction, supabase);
        }


        // --- 2. HANDLE DROP-DOWNS & SELECT MENUS ---

        // User selects a franchise team from the manual list dropdown
        if (interaction.customId === 'setup_select_manual_team') {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate();
            }

            const selectedSleeperUserId = interaction.values[0];
            const selectedOption = interaction.component.options.find(opt => opt.value === selectedSleeperUserId);
            const teamName = selectedOption ? selectedOption.label : "Selected Team";

            const targetEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setDescription(`🛠️ **Currently Editing:** ${teamName}\n\nSelect the server role below to link this franchise spot.`)
                .setColor(0x3498db);

            const roleSelectRow = new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder()
                    .setCustomId(`setup_assign_role_to_${selectedSleeperUserId}|${teamName}`)
                    .setPlaceholder(`Select the Discord Role for ${teamName}...`)
                    .setMinValues(1)
                    .setMaxValues(1)
            );

            return await interaction.editReply({ 
                embeds: [targetEmbed],
                components: [roleSelectRow] 
            });
        }

        // User assigns a role via the Role Select Menu
        if (interaction.customId && interaction.customId.startsWith('setup_assign_role_to_')) {
            await interaction.deferUpdate();

            const payloadData = interaction.customId.replace('setup_assign_role_to_', '');
            const [targetUserId, teamName] = payloadData.split('|');

            const chosenRoleId = interaction.values?.[0] || interaction.roles?.first()?.id;
            if (!chosenRoleId) return;

            const chosenRole = interaction.guild.roles.cache.get(chosenRoleId);
            const roleName = chosenRole ? chosenRole.name : "Custom Role";

            const { data: config } = await supabase
                .from("league_configs")
                .select("*")
                .eq("guild_id", interaction.guild.id)
                .single();

            const currentRoles = config?.sleeper_team_roles || {};

            currentRoles[targetUserId] = { 
                teamName: teamName || "Unknown Team", 
                roleId: chosenRoleId, 
                roleName: roleName 
            };

            const { error: upsertError } = await supabase.from("league_configs").upsert({
                ...config,
                sleeper_team_roles: currentRoles
            });

            if (upsertError) throw upsertError;

            await interaction.followUp({
                content: `✅ **Successfully Linked!** Assigned **${roleName}** to **${teamName || "Franchise Team"}**.`,
                flags: [64]
            });

            return await setupManager.sendManualRoleMappingMenu(interaction, supabase);
        }

        // Catch-all fall through warning
        console.warn(`⚠️ [SetupRouter] Unhandled CustomID Check: "${interaction.customId}"`);

    } catch (error) {
        console.error("🚨 [SetupRouter Fatal Crash Error]:", error);
    }
}

module.exports = {
    handleMenus: handleSetupInteractions
};