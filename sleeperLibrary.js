[35mcommands/extension.js[m[36m:[m[32m11[m[36m:[m        async execute(interaction, supabase, config, getSheetData, getPlayerStats, getOwner[1;31mIdMap[m) {
[35mcommands/help.js[m[36m:[m[32m9[m[36m:[m    async execute(interaction, supabase, config, getSheetData, getPlayerStats, getOwner[1;31mIdMap[m) {
[35mcommands/login.js[m[36m:[m[32m314[m[36m:[m    async handleSecretModalSubmit(interaction, supabase, currentConfig, getSheetData, getPlayerStats, getOwner[1;31mIdMap[m) {
[35mcommands/login.js[m[36m:[m[32m335[m[36m:[m                return await salaryCommand.execute(interaction, supabase, currentConfig, getSheetData, getPlayerStats, getOwner[1;31mIdMap[m);
[35mcommands/login.js[m[36m:[m[32m341[m[36m:[m                return await teamCommand.execute(interaction, supabase, currentConfig, getSheetData, getPlayerStats, getOwner[1;31mIdMap[m);
[35mcommands/salary.js[m[36m:[m[32m73[m[36m:[m                    const sleeperId = bestMatchPlayer ? (bestMatchPlayer.id || bestMatchPlayer.[1;31msleeper_id[m) : null;
[35mcommands/salary.js[m[36m:[m[32m77[m[36m:[m                    const sleeperLeagueId = config?.[1;31msleeper_id[m;
[35mcommands/team.js[m[36m:[m[32m12[m[36m:[m    async execute(interaction, supabase, config, getSheetData, getPlayerStats, getOwner[1;31mIdMap[m) {
[35mcommands/team.js[m[36m:[m[32m39[m[36m:[m                if (config?.[1;31msleeper_id[m) {
[35mcommands/team.js[m[36m:[m[32m53[m[36m:[m                            const rostersRes = await fetch(`https://api.sleeper.app/v1/league/${config.[1;31msleeper_id[m}/rosters`);
[35mcommands/team.js[m[36m:[m[32m56[m[36m:[m                            const usersRes = await fetch(`https://api.sleeper.app/v1/league/${config.[1;31msleeper_id[m}/users`);
[35mcommands/team.js[m[36m:[m[32m79[m[36m:[m                                const leagueRes = await fetch(`https://api.sleeper.app/v1/league/${config.[1;31msleeper_id[m}`);
[35mcommands/team.js[m[36m:[m[32m99[m[36m:[m                                const picksRes = await fetch(`https://api.sleeper.app/v1/league/${config.[1;31msleeper_id[m}/traded_picks`);
[35mcommands/top.js[m[36m:[m[32m23[m[36m:[m    async execute(interaction, supabase, config, getSheetData, getPlayerStats, getOwner[1;31mIdMap[m) {
[35mcommands/trade.js[m[36m:[m[32m27[m[36m:[m        async execute(interaction, supabase, config, getSheetData, getPlayerStats, getOwner[1;31mIdMap[m) {
[35mcommands/tradeAlert.js[m[36m:[m[32m31[m[36m:[m    async execute(interaction, supabase, config, getSheetData, getPlayerStats, getOwner[1;31mIdMap[m) {
[35mindex.js[m[36m:[m[32m262[m[36m:[m    if (!guildId) return { players: [], logs: [], [1;31midMap[m: [], doc: null };
[35mindex.js[m[36m:[m[32m273[m[36m:[m        return { players: [], logs: [], [1;31midMap[m: [], doc: null };
[35mindex.js[m[36m:[m[32m306[m[36m:[m    const iTab = config.tab_ids || "[1;31mSleeper_Players[m";
[35mindex.js[m[36m:[m[32m314[m[36m:[m            return { players: [], logs: [], [1;31midMap[m: [], doc: null };
[35mindex.js[m[36m:[m[32m346[m[36m:[m            [1;31midMap[m: idRows,
[35mindex.js[m[36m:[m[32m363[m[36m:[m        return { players: [], logs: [], [1;31midMap[m: [], doc: null };
[35mindex.js[m[36m:[m[32m499[m[36m:[m    const getOwner[1;31mIdMap[m = typeof getTeamMap !== "undefined" ? getTeamMap : null;
[35mindex.js[m[36m:[m[32m1168[m[36m:[m            return await loginCmd.handleSecretModalSubmit(interaction, supabase, currentConfig, getSheetData, getPlayerStats, getOwner[1;31mIdMap[m);
[35mindex.js[m[36m:[m[32m1201[m[36m:[m                getOwner[1;31mIdMap[m  
[35mindex.js[m[36m:[m[32m1266[m[36m:[m                    if (!config.[1;31msleeper_id[m) return;
[35mindex.js[m[36m:[m[32m1280[m[36m:[m                                `https://api.sleeper.app/v1/league/${config.[1;31msleeper_id[m}/transactions/${week}`,
[35mindex.js[m[36m:[m[32m1292[m[36m:[m                            console.error(`⚠️ Error fetching week ${week} for league ${config.[1;31msleeper_id[m}:`, weekErr.message);
[35mindex.js[m[36m:[m[32m1313[m[36m:[m                        processedTxIds.add(`${config.[1;31msleeper_id[m}_${tx.transaction_id}`);
[35mindex.js[m[36m:[m[32m1319[m[36m:[m                const newTxList = sortedTx.filter(tx => !processedTxIds.has(`${config.[1;31msleeper_id[m}_${tx.transaction_id}`));
[35mindex.js[m[36m:[m[32m1326[m[36m:[m                    getTeamMap(config.[1;31msleeper_id[m)
[35mindex.js[m[36m:[m[32m1333[m[36m:[m                    const txKey = `${config.[1;31msleeper_id[m}_${tx.transaction_id}`;
[35mindex.js[m[36m:[m[32m1340[m[36m:[m                console.error(`❌ Error polling league ${config.[1;31msleeper_id[m}:`, err.message);
[35mutils/FreeAgency/PlayerMotives/motiveStorage.js[m[36m:[m[32m9[m[36m:[m  '[1;31mSleeper_ID[m',
[35mutils/FreeAgency/PlayerMotives/motiveStorage.js[m[36m:[m[32m55[m[36m:[m    sleeperId: String(row.get('[1;31mSleeper_ID[m')),
[35mutils/FreeAgency/PlayerMotives/motiveStorage.js[m[36m:[m[32m86[m[36m:[m    String(row.get('[1;31mSleeper_ID[m')) === String(sleeperId)
[35mutils/FreeAgency/PlayerMotives/motiveStorage.js[m[36m:[m[32m132[m[36m:[m      [1;31mSleeper_ID[m: generated.sleeperId,
[35mutils/FreeAgency/PlayerMotives/testMotiveStorage.js[m[36m:[m[32m10[m[36m:[m  "[1;31mSleeper_ID[m",
[35mutils/capCompliance.js[m[36m:[m[32m22[m[36m:[m        const sleeperLeagueId = currentConfig?.[1;31msleeper_id[m;
[35mutils/setupManager.js[m[36m:[m[32m35[m[36m:[m            { name: "🏆 Sleeper Status", value: config?.[1;31msleeper_id[m ? "✅ Linked" : "❌ Not Set", inline: true },
[35mutils/setupManager.js[m[36m:[m[32m503[m[36m:[m            .select("[1;31msleeper_id[m, sleeper_name")
[35mutils/setupManager.js[m[36m:[m[32m520[m[36m:[m                    value: `\`${config?.[1;31msleeper_id[m || "Not Set"}\``,
[35mutils/setupManager.js[m[36m:[m[32m635[m[36m:[m            .select("[1;31msleeper_id[m, sleeper_team_roles")
[35mutils/setupManager.js[m[36m:[m[32m639[m[36m:[m        if (!config?.[1;31msleeper_id[m) {
[35mutils/setupManager.js[m[36m:[m[32m647[m[36m:[mif (config?.[1;31msleeper_id[m) {
[35mutils/setupManager.js[m[36m:[m[32m650[m[36m:[m            fetch(`https://api.sleeper.app/v1/league/${config.[1;31msleeper_id[m}/users`),
[35mutils/setupManager.js[m[36m:[m[32m651[m[36m:[m            fetch(`https://api.sleeper.app/v1/league/${config.[1;31msleeper_id[m}/rosters`)
[35mutils/setupManager.js[m[36m:[m[32m754[m[36m:[m            .select("[1;31msleeper_id[m")
[35mutils/setupManager.js[m[36m:[m[32m758[m[36m:[m        if (!config?.[1;31msleeper_id[m) {
[35mutils/setupManager.js[m[36m:[m[32m773[m[36m:[m                fetch(`https://api.sleeper.app/v1/league/${config.[1;31msleeper_id[m}/users`),
[35mutils/setupManager.js[m[36m:[m[32m774[m[36m:[m                fetch(`https://api.sleeper.app/v1/league/${config.[1;31msleeper_id[m}/rosters`)
[35mutils/setupManager.js[m[36m:[m[32m1116[m[36m:[m            .select("[1;31msleeper_id[m")
[35mutils/setupManager.js[m[36m:[m[32m1125[m[36m:[m            .setCustomId("in_[1;31msleeper_id[m")
[35mutils/setupManager.js[m[36m:[m[32m1130[m[36m:[m            .setValue(config?.[1;31msleeper_id[m || "")
[35mutils/setupManager.js[m[36m:[m[32m1175[m[36m:[m        const sleeperId = interaction.fields.getTextInputValue("in_[1;31msleeper_id[m");
[35mutils/setupManager.js[m[36m:[m[32m1197[m[36m:[m                    [1;31msleeper_id[m: sleeperId,
[35mutils/sleeperLibrary.js[m[36m:[m[32m45[m[36m:[m                    [1;31msleeper_id[m: playerId,
[35mutils/sleeperLibrary.js[m[36m:[m[32m64[m[36m:[m            .from("[1;31msleeper_players[m")
[35mutils/sleeperLibrary.js[m[36m:[m[32m65[m[36m:[m            .upsert(playersToUpsert, { onConflict: "[1;31msleeper_id[m" });
[35mutils/sleeperLibrary.js[m[36m:[m[32m95[m[36m:[m                .from("[1;31msleeper_players[m")
[35mutils/sleeperLibrary.js[m[36m:[m[32m96[m[36m:[m                .select("[1;31msleeper_id[m, search_key, position")
[35mutils/sleeperLibrary.js[m[36m:[m[32m105[m[36m:[m                        id: p.[1;31msleeper_id[m,
[35mutils/sleeperLibrary.js[m[36m:[m[32m110[m[36m:[m                    if (p.[1;31msleeper_id[m) {
[35mutils/sleeperLibrary.js[m[36m:[m[32m111[m[36m:[m                        global.sleeperCache.set(p.[1;31msleeper_id[m, playerData);
