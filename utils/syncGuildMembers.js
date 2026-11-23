// utils/syncGuildMembers.js
async function syncGuildTeamLinks(client, supabase) {
    try {
        // Only target active leagues where FA is enabled
        const { data: configs, error } = await supabase
            .from("league_configs")
            .select("guild_id, sleeper_team_roles")
            .eq("fa_enabled", true);

        if (error || !configs || configs.length === 0) return;

        for (const config of configs) {
            const { guild_id, sleeper_team_roles } = config;
            if (!guild_id || !sleeper_team_roles) continue;

            const guild = await client.guilds.fetch(guild_id).catch(() => null);
            if (!guild) continue;

            // Fetch all members in the guild via Discord Gateway
            const members = await guild.members.fetch();
            const teamRoles = Object.values(sleeper_team_roles);
            const upsertPayloads = [];

            for (const [memberId, member] of members) {
                if (member.user.bot) continue;

                const userRoleIds = member.roles.cache.map(r => r.id);
                const matched = teamRoles.find(tr => userRoleIds.includes(tr.roleId));
                const teamName = matched ? (matched.teamName || matched.roleName) : "Free Agent";

                upsertPayloads.push({
                    discord_id: String(memberId),
                    username: member.user.username,
                    team_name: teamName,
                    guild_id: guild_id,
                    updated_at: new Date().toISOString()
                });
            }

            if (upsertPayloads.length > 0) {
                const { error: upsertErr } = await supabase
                    .from("user_team_links")
                    .upsert(upsertPayloads, { onConflict: "discord_id" });

                if (upsertErr) {
                    console.error("❌ [Cron Sync Error]:", upsertErr.message);
                } else {
                    console.log(`🔄 [Guild Sync] Synchronized ${upsertPayloads.length} members for Guild ${guild_id}`);
                }
            }
        }
    } catch (err) {
        console.error("❌ Exception during scheduled guild sync:", err.message);
    }
}

module.exports = { syncGuildTeamLinks };