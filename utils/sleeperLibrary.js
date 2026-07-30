// Function to strip suffixes, punctuation, and spacing for bulletproof text matching
function normalizePlayerName(name) {
    if (!name) return "";
    return name
        .toLowerCase()
        .replace(/\b(jr|sr|iii|ii|iv|v|vth)\b/gi, "") // Remove common suffixes
        .replace(/[^a-z0-9]/gi, "") // Remove spaces, periods, apostrophes
        .trim();
}

const axios = require("axios");

async function syncSleeperLibrary(supabaseClient) {
    console.log("⏳ Fetching master player data from Sleeper API...");
    try {
        const response = await axios.get(
            "https://api.sleeper.app/v1/players/nfl",
        );
        const allPlayers = response.data;

        // Find this block inside syncSleeperLibrary:
        const playersToUpsert = [];

        // 🎯 UPDATED: Fully accommodates Offensive, Kicker, and IDP positions
        const targetPositions = ["QB", "RB", "WR", "TE", "K", "DL", "LB", "DB"];

        for (const [playerId, data] of Object.entries(allPlayers)) {
            // Standardize position tracking to uppercase to protect against formatting discrepancies
            if (
                data.position &&
                targetPositions.includes(data.position.toUpperCase())
            ) {
                const firstName = data.first_name || "";
                const lastName = data.last_name || "";
                const fullName = `${firstName} ${lastName}`.trim();

                if (!fullName) continue; // Skip broken records

                playersToUpsert.push({
                    sleeper_id: playerId,
                    full_name: fullName,
                    search_key: normalizePlayerName(fullName),
                    position: data.position,
                    team: data.team || "FA",
                    age: data.age,
                    status: data.status,
                    injury_status: data.injury_status,
                    updated_at: new Date(),
                });
            }
        }

        console.log(
            `🧹 Filtered down to ${playersToUpsert.length} active players. Syncing to Supabase...`,
        );

        // Batch upsert into your Supabase cache table
        const { error } = await supabaseClient
            .from("sleeper_players")
            .upsert(playersToUpsert, { onConflict: "sleeper_id" });

        if (error) throw error;

        console.log("✅ Sleeper player library successfully synchronized!");
        return true;
    } catch (err) {
        console.error("❌ Failed to sync Sleeper library:", err.message);
        return false;
    }
}

async function runScheduledLibrarySync(supabaseClient) {
    // This calls the API, saves to DB, and fires your Malik Nabers console.log lines!
    const syncSuccess = await syncSleeperLibrary(supabaseClient);
    if (!syncSuccess) return false;

    try {
        global.sleeperCache.clear();
        let page = 0;
        const pageSize = 1000;
        let keepFetching = true;

        while (keepFetching) {
            const fromRange = page * pageSize;
            const toRange = fromRange + pageSize - 1;

            const { data: chunk, error } = await supabaseClient
                .from("sleeper_players")
                .select(
                    "sleeper_id, full_name, search_key, position, team, age, status, injury_status",
                )
                .range(fromRange, toRange);

            if (error) throw error;

            if (chunk && chunk.length > 0) {
                chunk.forEach((p) => {
                    global.sleeperCache.set(p.sleeper_id, {
                        name: p.full_name,
                        searchKey: p.search_key,
                        position: p.position,
                        team: p.team,
                        age: p.age,
                        status: p.status,
                        injury_status: p.injury_status,
                    });
                });

                if (chunk.length < pageSize) {
                    keepFetching = false;
                } else {
                    page++;
                }
            } else {
                keepFetching = false;
            }
        }

        console.log(
            `🔄 Scheduled Sync Complete: Memory cache reloaded with ${global.sleeperCache.size} active players.`,
        );
        return true;
    } catch (err) {
        console.error(
            "❌ Scheduled sync failed to update live memory cache:",
            err.message,
        );
        return false;
    }
}

module.exports = {
    syncSleeperLibrary,
    normalizePlayerName,
    runScheduledLibrarySync, // 👈 Add this new runner here
};
