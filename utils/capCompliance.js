const { EmbedBuilder } = require("discord.js");
const axios = require("axios");

async function runWeeklyAudit(client, supabase, getSheetData, guildId, currentConfig, auditMode = "all") {
    console.log("⏳ Running Weekly Cap Compliance Audit...");
    try {
        const data = await getSheetData(guildId);
        const players = data.players;
        const currentDoc = data.doc; // Pulling the doc we just added above

        if (!currentDoc) {
            console.error(
                "❌ Cron Error: 'doc' is still missing from getSheetData results.",
            );
            return;
        }

        const nonCompliant = [];
        const missingData = [];

        // --- ADD FOR TANKING CHECKS ---
        const sleeperLeagueId = currentConfig?.sleeper_id;
        const tankingViolations = [];
        let sleeperUserMap = {};
        let activeMatchups = [];
        let globalPlayerData = {};

        if (sleeperLeagueId) {
            try {
                const rostersRes = await axios.get(`https://api.sleeper.app/v1/league/${sleeperLeagueId}/rosters`);
                const usersRes = await axios.get(`https://api.sleeper.app/v1/league/${sleeperLeagueId}/users`);
                const nflPlayersRes = await axios.get("https://api.sleeper.app/v1/players/nfl");
                globalPlayerData = nflPlayersRes.data || {};

                const stateRes = await axios.get("https://api.sleeper.app/v1/state/nfl");
                        const currentWeek = stateRes.data.week || 1; 

                        try {
                            console.log(`📡 Fetching Week ${currentWeek} Matchups...`);
                            const matchupsRes = await axios.get(`https://api.sleeper.app/v1/league/${sleeperLeagueId}/matchups/${currentWeek}`);
                            activeMatchups = matchupsRes.data || [];
                            console.log(`✅ Received ${activeMatchups.length} matchup datasets from Sleeper live servers.`);
                        } catch (err) {
                            console.log("⚠️ Failed to fetch matchups live, falling back to empty array.");
                            activeMatchups = [];
                        }

                        rostersRes.data.forEach(r => {
                            const user = usersRes.data.find(u => u.user_id === r.owner_id);
                            sleeperUserMap[r.roster_id] = user ? user.display_name : `Roster ${r.roster_id}`;
                        });
                    } catch (apiErr) {
                        console.error("⚠️ Sleeper API sync skipped:", apiErr.message);
                    }
                }
        
        if (auditMode === "all" || auditMode === "cap") {
        const teams = [
            ...new Set(
                players
                    .map((p) => p?.team)
                    .filter((t) => t && t !== "Free Agent"),
            ),
        ];

        
        const mapping = currentConfig?.column_mapping || {};
        const capSpaceCoordinate = mapping.team_cap || "F2";

        

        for (const teamName of teams) {
            
            const sheet = currentDoc.sheetsByIndex.find((s) =>
                s.title.toLowerCase().includes(teamName.toLowerCase())
            );
            if (!sheet) continue;

            await sheet.loadCells(capSpaceCoordinate);
            const capRaw = sheet.getCellByA1(capSpaceCoordinate).formattedValue || "$0.00";
            const capNum = parseFloat(capRaw.replace(/[$,]/g, "")) || 0;

            if (capNum < 0) {
                nonCompliant.push({ name: sheet.title, balance: capRaw });
            }

            const teamRoster = players.filter((p) => p?.team === teamName);
            const buggyPlayers = teamRoster.filter((p) => (p?.aav || 0) === 0);
            if (buggyPlayers.length > 0) {
                missingData.push({
                    team: sheet.title,
                    players: buggyPlayers.map((p) => p?.name || "Unknown Player"),
                });
            }
        }    
        } 
        // ==================== 2. TANKING & LINEUP AUDIT (Uses Sleeper Names) ====================
        // ==================== 2. TANKING & LINEUP AUDIT ====================
        if ((auditMode === "all" || auditMode === "lineups") && sleeperLeagueId) {
            console.log("\n🏃 [STARTING SLEEPER LINEUP AUDIT]...");

            try {
                // Re-fetch rosters to get live starter configurations
                const liveRostersRes = await axios.get(`https://api.sleeper.app/v1/league/${sleeperLeagueId}/rosters`);
                const liveRosters = liveRostersRes.data || [];

                // Map roster ID to starters list for quick lookup
                const rosterStartersMap = {};
                liveRosters.forEach(r => {
                    rosterStartersMap[r.roster_id] = r.starters || [];
                });

                activeMatchups.forEach((matchup) => {
                    const rosterId = matchup.roster_id;
                    const sleeperName = sleeperUserMap[rosterId] || `Roster ${rosterId}`;

                    // Fallback: Use matchup starters if available, otherwise use live roster starters
                    const starters = (matchup.starters && matchup.starters.length > 0)
                        ? matchup.starters
                        : (rosterStartersMap[rosterId] || []);

                    
                    starters.forEach((starterId, index) => {
                        const slotName = `slot position #${index + 1}`;

                        // 1. Literal Empty Spot Check (Handles "0", 0, null, undefined, "")
                        if (!starterId || starterId === "0" || starterId === 0 || String(starterId).trim() === "0") {
                            tankingViolations.push({
                                team: sleeperName, 
                                detail: `Left starting ${slotName} empty.`
                            });
                            return; // Skip further checks for this slot since it's empty
                        }

                        // Cross-reference player ID with the master database
                        const playerMeta = globalPlayerData[starterId];
                        if (playerMeta) {
                            const playerName = `${playerMeta.first_name} ${playerMeta.last_name}`;

                            // 2. Bye Week Check
                            if (playerMeta.injury_status === "Bye" || playerMeta.news_injury_status === "Bye") {
                                tankingViolations.push({
                                    team: sleeperName,
                                    detail: `Started **${playerName}** in ${slotName} while on a Bye Week.`
                                });
                            }

                            // 3. Explicit Injured Reserve (IR) Check
                            if (playerMeta.injury_status === "IR") {
                                tankingViolations.push({
                                    team: sleeperName,
                                    detail: `Started **${playerName}** in ${slotName} while designated on IR.`
                                });
                            }
                        }
                    });
                });
            } catch (lineupErr) {
                console.error("⚠️ Error processing lineup audit:", lineupErr.message);
            }
        }

        
    
        const logChannelId = currentConfig?.log_channel_id
        const logChannel = await client.channels.fetch(logChannelId);
        const reportEmbed = new EmbedBuilder()
            .setTitle("📅 Weekly League Audit Report")
            .setColor(nonCompliant.length > 0 ? 0xe74c3c : 0x2ecc71)
            .setTimestamp();

        let pingContent = "";
            // 1. Process Cap Issues Completely
        if (auditMode === "all" || auditMode === "cap") {
            if (nonCompliant.length > 0) {
                const capRoleId = currentConfig?.admin_role_id
                pingContent = `⚠️ <@&${capRoleId}> **Action Required:** Cap issues detected.`;
                reportEmbed.addFields({
                    name: "🚨 Non-Compliant Teams (Negative Cap)",
                    value: nonCompliant.map((t) => `• **${t.name}**: ${t.balance}`).join("\n"),
                });
            } else {
                reportEmbed.setDescription(
                    "✅ All teams are currently under the salary cap.",
                );
            }
        }
            // 2. Process Tanking Issues Independently
        if (auditMode === "all" || auditMode === "lineups") {
                        if (tankingViolations.length > 0) {
                            const violationLines = tankingViolations.map(v => `• **${v.team}**: ${v.detail}`);
                            let currentFieldContent = "";
                            let fieldCount = 1;

                            violationLines.forEach((line) => {
                                // If adding this line exceeds Discord's 1024 character field limit
                                if ((currentFieldContent + line + "\n").length > 1024) {
                                    reportEmbed.addFields({ // Fixed: changed 'embed' to 'reportEmbed'
                                        name: `📉 Tanking Violations (Part ${fieldCount})`,
                                        value: currentFieldContent.trim()
                                    });
                                    currentFieldContent = line + "\n"; // Start next chunk
                                    fieldCount++;
                                } else {
                                    currentFieldContent += line + "\n";
                                }
                            });

                            // Add the final remaining chunk
                            if (currentFieldContent.trim().length > 0) {
                                reportEmbed.addFields({ // Fixed: changed 'embed' to 'reportEmbed'
                                    name: fieldCount > 1 ? `📉 Tanking Violations (Part ${fieldCount})` : "📉 Tanking Violations",
                                    value: currentFieldContent.trim()
                                });
                            }
                        } else {
                            reportEmbed.addFields({ name: "📉 Tanking Violations", value: "✅ All lineups fully compliant." }); // Fixed: 'reportEmbed'
                        }
        }    

                        // Send the final compiled message to Discord
                        await logChannel.send({ content: pingContent, embeds: [reportEmbed] });

                } catch (auditErr) {
                    console.error("❌ Critical error occurred during the compliance audit execution:", auditErr);
                }
            } // Closes async function runWeeklyAudit

module.exports = { runWeeklyAudit };
