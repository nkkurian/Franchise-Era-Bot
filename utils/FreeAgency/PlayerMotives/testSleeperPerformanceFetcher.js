
"use strict";

const assert = require("node:assert/strict");

const {
    getCompletedSeasons,
    getLeagueScoringSettings,
    getThreeSeasonPlayerStats
} = require("./sleeperPerformanceFetcher");

const LEAGUE_ID = "1353482184714895360";

async function runTests() {
    console.log("Testing Sleeper Performance Fetcher...\n");

    // Test 1: Identify three completed seasons
    const seasons = await getCompletedSeasons();

    assert.equal(seasons.length, 3);
    assert.ok(seasons.every(Number.isInteger));

    console.log("✅ Completed seasons:", seasons.join(", "));

    // Test 2: Retrieve your league's scoring settings
    const scoringSettings = await getLeagueScoringSettings(
        LEAGUE_ID
    );

    assert.ok(scoringSettings);
    assert.ok(Object.keys(scoringSettings).length > 0);

    console.log(
        "✅ League scoring settings retrieved:",
        Object.keys(scoringSettings).length,
        "categories"
    );

    // Test 3: Retrieve historical player stats.
    // This is a sample Sleeper player ID used for testing.
    const playerId = "4046";

    const playerSeasons = await getThreeSeasonPlayerStats(
        playerId
    );

    assert.equal(playerSeasons.length, 3);

    for (const season of playerSeasons) {
        console.log(
            `Season ${season.year}:`,
            season.stats
                ? "Statistics found"
                : "No statistics returned",
            "| Games played:",
            season.gamesPlayed ?? "Unavailable"
        );
    }

    console.log("\n🎉 Sleeper fetcher checks completed!");
}

runTests().catch((error) => {
    console.error("\n❌ Test failed:", error.message);
    process.exitCode = 1;
});
