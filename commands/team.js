const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('team')
        .setDescription('View a team\'s cap space and top earners')
        .addStringOption(option => 
            option.setName('teamname')
                .setDescription('The name of the team')
                .setRequired(true)),

    async execute(interaction, supabase, config, getSheetData, getPlayerStats, getOwnerIdMap) {
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferReply({ ephemeral: interaction.isStringSelectMenu() });
                }
                const teamInput = interaction.options.getString("teamname").toLowerCase();
            
                // 2. Pass the dynamic server ID into the sheet getter
                const { players, doc } = await getSheetData(interaction.guild.id); 
            
                // 3. Find the specific team sheet
                const sheet = doc.sheetsByIndex.find((s) =>
                    s.title.toLowerCase().includes(teamInput),
                );
            
                if (!sheet) {
                    return await interaction.editReply(
                        `❌ Team **${teamInput}** not found in the spreadsheet.`,
                    );
                }
                // =========================================================
                // 🎟️ EXTRA FEATURE: DYNAMIC SLEEPER DRAFT CAPITAL LOOKUP
                // =========================================================
                let draftPicksDisplay = "*No draft asset ledger found or League ID unconfigured.*";
                let totalPickCount = 0;
                let hiddenPicksCount = 0;
                let leftColumnDisplay = "⚪ None";
                let rightColumnDisplay = "⚪ None";
                let sleeperWaiverBalance = "N/A";

                if (config?.sleeper_id) {
                    try {
                        const currentRoles = config?.sleeper_team_roles || {};
                        let targetSleeperUserId = null;

                        // Match spreadsheet tab name to a Sleeper User ID from database
                        for (const [userId, data] of Object.entries(currentRoles)) {
                            if (data.teamName && data.teamName.toLowerCase().includes(teamInput)) {
                                targetSleeperUserId = userId;
                                break;
                            }
                        }
                        if (targetSleeperUserId) {
                            // 1. Fetch league rosters and users to construct display maps
                            const rostersRes = await fetch(`https://api.sleeper.app/v1/league/${config.sleeper_id}/rosters`);
                            const rosters = await rostersRes.json();

                            const usersRes = await fetch(`https://api.sleeper.app/v1/league/${config.sleeper_id}/users`);
                            const users = await usersRes.json();

                            // Build a quick lookup dictionary: { roster_id: "Team Name" }
                            const rosterNameMap = {};
                            rosters.forEach(r => {
                                const user = users.find(u => u.user_id === r.owner_id);
                                if (user) {
                                    const username = user.display_name || "Unknown Team";
                                    rosterNameMap[r.roster_id] = user.metadata?.team_name || `${username}`;
                                } else {
                                    rosterNameMap[r.roster_id] = `Team ${r.roster_id}`;
                                }
                            });

                            // 2. Find the target roster matching the selected manager
                            const targetRoster = rosters.find(r => r.owner_id === targetSleeperUserId);

                            if (targetRoster) {
                                const currentYear = new Date().getFullYear();
                                const rosterId = targetRoster.roster_id;

                                // 1. Fetch league details to check the live status of the draft/season
                                const leagueRes = await fetch(`https://api.sleeper.app/v1/league/${config.sleeper_id}`);
                                const leagueData = await leagueRes.json();
                                // Get total starting budget from league settings (default to 100 if unset)
                                const totalLeagueBudget = leagueData.settings?.waiver_budget ?? 100;

                                // Sleeper tracks spent budget here. If it's undefined, they have spent $0.
                                const spentBudget = targetRoster.settings?.waiver_budget_used ?? 0;

                                // Remaining balance is Total minus Spent
                                sleeperWaiverBalance = totalLeagueBudget - spentBudget;

                                // If the league is still "pre_draft" or actively "drafting", include the current year.
                                // If the season has started ("in_season" / "complete"), skip current year and look ahead.
                                const isDraftOver = leagueData.status !== 'pre_draft' && leagueData.status !== 'drafting';
                                const startYear = isDraftOver ? currentYear + 1 : currentYear;

                                const compiledPicks = [];
                                const dynamicSeasons = [startYear, startYear + 1, startYear + 2];
                                const totalRounds = leagueData.settings?.rookie_rounds || 4;

                                const picksRes = await fetch(`https://api.sleeper.app/v1/league/${config.sleeper_id}/traded_picks`);
                                const allTradedPicks = await picksRes.json();

                                // 4. Filter picks this roster currently owns vs picks they traded away
                                const ownedTradedPicks = allTradedPicks.filter(pick => pick.owner_id === rosterId);
                                const soldPicks = allTradedPicks.filter(pick => pick.roster_id === rosterId && pick.owner_id !== rosterId);

                                // 5. Calculate native capital assets minus traded capital assets
                                let hiddenPicksCount = 0; // Tracks rounds 3+

                                // 5. Calculate native capital assets minus traded capital assets
                                dynamicSeasons.forEach(season => {
                                    for (let round = 1; round <= totalRounds; round++) {
                                        const isSold = soldPicks.some(p => parseInt(p.season) === season && p.round === round);
                                        if (!isSold) {
                                            if (round <= 2) {
                                                compiledPicks.push(`• **${season}** Round ${round}`);
                                            } else {
                                                hiddenPicksCount++;
                                            }
                                        }
                                    }

                                    const acquiredPicks = ownedTradedPicks.filter(p => parseInt(p.season) === season && p.roster_id !== rosterId);
                                    acquiredPicks.forEach(pick => {
                                        const originalOwnerName = rosterNameMap[pick.roster_id] || `Team ${pick.roster_id}`;
                                        if (pick.round <= 2) {
                                            compiledPicks.push(`• **${pick.season}** Round ${pick.round} *(via ${originalOwnerName})*`);
                                        } else {
                                            hiddenPicksCount++;
                                        }
                                    });
                                });

                        // Calculate true asset count before adding the string summary footer
                                totalPickCount = compiledPicks.length + hiddenPicksCount;

                                if (hiddenPicksCount > 0) {
                                    compiledPicks.push(`*...plus ${hiddenPicksCount} additional picks (Rounds 3+). *`);
                                }

                                draftPicksDisplay = compiledPicks.length > 0 ? compiledPicks.join('\n') : "⚪ This franchise owns zero upcoming draft choices.";

                                // Split elements evenly into 2 columns
                                const half = Math.ceil(compiledPicks.length / 2);
                                const leftColumnPicks = compiledPicks.slice(0, half);
                                const rightColumnPicks = compiledPicks.slice(half);

                                leftColumnDisplay = leftColumnPicks.length > 0 ? leftColumnPicks.join('\n') : "⚪ None";
                                rightColumnDisplay = rightColumnPicks.length > 0 ? rightColumnPicks.join('\n') : "⚪ None";
                            }
                        }
                    } catch (sleeperError) {
                        console.error("⚠️ Background draft pick execution error:", sleeperError);
                        draftPicksDisplay = "⚠️ *Failed to download live draft capital from Sleeper API.*";
                    }
                }
                // =========================================================

               // 1. Resolve exact properties matching your /setup configuration payload
               // 1. Resolve exact properties matching your Supabase structure
               const mapping = config?.column_mapping || {};

               // Pull matching cell coordinates with correct keys matching your setup dashboard database structure
               const capCellA1 = mapping?.team_cap_space_cell || "F2"; 
               const extCellA1 = mapping?.team_extensions_cell || "J2";

               // 2. Safely collect and load cells from the targeted sheet
               const cellsToLoad = [];
               if (capCellA1 && typeof capCellA1 === 'string') cellsToLoad.push(capCellA1.trim().toUpperCase());
               if (extCellA1 && typeof extCellA1 === 'string') cellsToLoad.push(extCellA1.trim().toUpperCase());

               try {
                   if (cellsToLoad.length > 0) {
                       // Load the specified cell coordinates into memory
                       await Promise.all(cellsToLoad.map(cell => sheet.loadCells(cell)));
                   }
               } catch (cellError) {
                   console.error("⚠️ Failed to load cell range from sheet:", cellError);
               }

               // 3. Extract formatted text directly out of the grid cells
               let capSpace = "$0.00";
               try {
                   capSpace = sheet.getCellByA1(capCellA1).formattedValue || "$0.00";
               } catch(e) {
                   console.log("Could not find Cap Cell:", capCellA1);
               }

               let extensionsLeft = null;
               try {
                   extensionsLeft = sheet.getCellByA1(extCellA1).formattedValue;
               } catch(e) {
                   console.log("Could not find Extensions Cell:", extCellA1);
               }

                // =========================================================
                // 🌱 DYNAMIC BUILD STATUS CALCULATION
                // =========================================================
                let buildStatus = "⚖️ Balanced";

                // Parse Cap Space to a clean number
                const capCleanNum = parseFloat(String(capSpace).replace(/[$,]/g, "")) || 0;

                if (capCleanNum <= 5000000 && totalPickCount < 12) {
                    buildStatus = "🔥 Win-Now / Contender (All-In)";
                } else if (capCleanNum > 15000000 && totalPickCount >= 14) {
                    buildStatus = "🌱 Rebuilding / Asset Hoarder";
                } else if (capCleanNum <= 2000000 && totalPickCount >= 13) {
                    buildStatus = "🔄 Retooling (Heavy Assets & Max Cap)";
                } else if (capCleanNum > 20000000 && totalPickCount < 10) {
                    buildStatus = "💵 Free Agent Hunter (High Cap / Few Picks)";
                }
        
                // 5. Protected player filter logic
                const teamPlayers = players.filter((p) => {
                    if (!p) return false;
        
                    // Check for a standard object property, fallback to dynamic config property mappings
                    const playerTeam = p.team || p.teamAffiliation || p.rowRef?.get(config?.column_mapping?.team_col || "Team");
        
                    return typeof playerTeam === 'string' && playerTeam.toLowerCase().includes(teamInput);
                });

                
                const topEarners = teamPlayers
                    .map((p) => {
                        
                        const salaryStr = p.aav || p.salary || p.capHit || p.rowRef?.get(config?.column_mapping?.salary_col || "Salary") || "$0.00";
                        const pName = p.name || p.playerName || p.rowRef?.get(config?.column_mapping?.id_player_col || "Player Name") || "Unknown Player";
                        const pPos = p.position || p.pos || p.rowRef?.get(config?.column_mapping?.position_col || "Position") || "N/A";

                        // Clean out currency formatting symbols to handle sorting math safely
                        const salaryNum = typeof salaryStr === 'number' 
                            ? salaryStr 
                            : parseFloat(String(salaryStr).replace(/[$,]/g, "")) || 0;

                        return {
                            name: pName,
                            pos: pPos,
                            salary: typeof salaryStr === 'number' ? `$${(salaryStr / 1000000).toFixed(2)}M` : salaryStr,
                            num: salaryNum,
                        };
                    })
                    .sort((a, b) => b.num - a.num)
                    .slice(0, 5); // Keeps your top 5 earners list intact

                const earnerList = topEarners.length > 0
                    ? topEarners
                          .map((p) => `• **${p.name}** (${p.pos}): ${p.salary}`)
                          .join("\n")
                    : "No roster data found.";

                // 🔗 GENERATE DIRECT LINK
                // Format: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit#gid=SHEET_ID
                const sheetLink = `https://docs.google.com/spreadsheets/d/${doc.spreadsheetId}/edit#gid=${sheet.sheetId}`;

                const teamEmbed = new EmbedBuilder()
                    .setTitle(`📊 Team Report: ${sheet.title}`)
                    .setURL(sheetLink) 
                    .setColor(0x3498db)
                    .addFields(
                        {
                            name: "💰 Current Cap Space",
                            value: `**${capSpace}**`,
                            inline: true,
                        },
                        {
                            name: "📋 Waiver Balance",
                                value: `**${typeof sleeperWaiverBalance === 'number' ? '$' : ''}${sleeperWaiverBalance}**`,
                                inline: true,
                        }
                    );

                // Only inject the extension field if the cell is mapped and filled out
                if (extensionsLeft !== null && extensionsLeft !== undefined && extensionsLeft !== "") {
                    teamEmbed.addFields({
                        name: "⏳ Extensions Left",
                        value: `**${extensionsLeft}**`,
                        inline: true,
                    });
                }

                // Shifted upwards and changed inline to true to force it onto the top row grid
                teamEmbed.addFields({
                    name: "🔮 Franchise Direction",
                    value: `**${buildStatus}**`,
                    inline: true,
                });

                // Add the remaining static elements underneath
                teamEmbed.addFields(
                    {
                        name: "🔝 Top Earners",
                        value: earnerList,
                        inline: false,
                    },
                    {
                        name: "🎟️ Premium Capital (Part 1)",
                        value: leftColumnDisplay,
                        inline: true,
                    },
                    {
                        name: "🎟️ Premium Capital (Part 2)",
                        value: rightColumnDisplay,
                        inline: true,
                    },
                    {
                        name: "🔗 Quick Link",
                        value: `[Open ${sheet.title} Tab](${sheetLink})`,
                        inline: false,
                    }
                )
                .setFooter({
                    text: "Franchise Pro • Click title to view sheet",
                })
                .setTimestamp();

        await interaction.editReply({ embeds: [teamEmbed] });
            } 
        };
