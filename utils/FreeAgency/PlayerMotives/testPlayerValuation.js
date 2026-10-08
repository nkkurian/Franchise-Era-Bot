
"use strict";

const assert = require("node:assert/strict");

const {
    evaluateSleeperPlayer
} = require("./playerValuationEngine");

const LEAGUE_ID = "1353482184714895360";

async function runTests() {
    console.log("Testing Player Valuation Engine...\n");

    // Sample Sleeper player ID from our successful API test.
    const player = await evaluateSleeperPlayer({
        playerId: "4046",
        position: "QB",
        leagueId: LEAGUE_ID
    });

    console.log("Player ID:", player.playerId);
    console.log("Position:", player.position);
    console.log("Status:", player.status);
    console.log("Seasons used:", player.seasonsUsed);

    console.log("\nSeason breakdown:");

    for (const season of player.seasonResults) {
        console.log(
            `${season.year}: ${season.fantasyPoints} points ` +
            `| ${season.gamesPlayed} games ` +
            `| ${season.pointsPerGame} PPG`
        );
    }

    console.log("\nThree-year results:");
    console.log(
        "Weighted fantasy points:",
        player.weightedFantasyPoints
    );
    console.log(
        "Weighted points per game:",
        player.weightedPointsPerGame
    );

    // Verify the two modules work together.
    assert.equal(player.playerId, "4046");
    assert.equal(player.position, "QB");
    assert.equal(player.status, "COMPLETE");
    assert.equal(player.seasonsUsed, 3);

    assert.ok(Number.isFinite(player.weightedFantasyPoints));
    assert.ok(Number.isFinite(player.weightedPointsPerGame));

    console.log(
        "\n🎉 Real Sleeper Player Valuation integration test passed!"
    );
}

runTests().catch((error) => {
    console.error("\n❌ Test failed:", error.message);
    process.exitCode = 1;
});
