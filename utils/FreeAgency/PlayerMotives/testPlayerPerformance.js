
"use strict";

const assert = require("node:assert/strict");

const {
    SEASON_WEIGHTS,
    calculateLeaguePoints,
    evaluatePlayerPerformance
} = require("./playerPerformanceEngine");

// Simplified example scoring rules.
// These are test settings, not your league's actual scoring.
const scoringSettings = {
    pass_yd: 0.04,
    pass_td: 4,
    pass_int: -2,
    rush_yd: 0.1,
    rush_td: 6,
    rec: 1,
    rec_yd: 0.1,
    rec_td: 6,
    idp_tkl: 1,
    idp_sack: 4
};

// Test 1: Season weighting
assert.deepEqual(SEASON_WEIGHTS, [0.5, 0.3, 0.2]);
console.log("✅ Three-season weights passed");

// Test 2: League-specific scoring
const offensivePoints = calculateLeaguePoints(
    { rush_yd: 100, rush_td: 2 },
    scoringSettings
);
assert.equal(offensivePoints, 22);

const defensivePoints = calculateLeaguePoints(
    { idp_tkl: 10, idp_sack: 2 },
    scoringSettings
);
assert.equal(defensivePoints, 18);

console.log("✅ Offensive and IDP scoring passed");

// Test 3: Three completed seasons
const rbResult = evaluatePlayerPerformance({
    playerId: "RB_TEST",
    position: "RB",
    scoringSettings,
    seasons: [
        {
            year: 2025,
            gamesPlayed: 16,
            stats: { rush_yd: 1200, rush_td: 10 }
        },
        {
            year: 2024,
            gamesPlayed: 15,
            stats: { rush_yd: 1000, rush_td: 8 }
        },
        {
            year: 2023,
            gamesPlayed: 14,
            stats: { rush_yd: 800, rush_td: 6 }
        }
    ]
});

assert.equal(rbResult.status, "COMPLETE");
assert.equal(rbResult.seasonsUsed, 3);
assert.equal(rbResult.weightedFantasyPoints, 157.6);
assert.equal(rbResult.weightedPointsPerGame, 10.24);

console.log("✅ Three-season RB performance passed");

// Test 4: One available season
const rookieResult = evaluatePlayerPerformance({
    playerId: "ROOKIE_TEST",
    position: "WR",
    scoringSettings,
    seasons: [
        {
            year: 2025,
            gamesPlayed: 17,
            stats: { rec: 60, rec_yd: 800, rec_td: 5 }
        }
    ]
});

assert.equal(rookieResult.status, "LIMITED_DATA");
assert.equal(rookieResult.seasonsUsed, 1);
assert.equal(rookieResult.weightedFantasyPoints, 170);
assert.equal(rookieResult.weightedPointsPerGame, 10);

console.log("✅ Limited-history player passed");

// Test 5: Missing statistics
const missingResult = evaluatePlayerPerformance({
    playerId: "MISSING_TEST",
    position: "TE",
    scoringSettings,
    seasons: []
});

assert.equal(missingResult.status, "NO_DATA");
assert.equal(missingResult.weightedFantasyPoints, null);
assert.equal(missingResult.weightedPointsPerGame, null);

console.log("✅ Missing-data handling passed");

// Test 6: Defensive player over three seasons
const lbResult = evaluatePlayerPerformance({
    playerId: "LB_TEST",
    position: "LB",
    scoringSettings,
    seasons: [
        {
            year: 2025,
            gamesPlayed: 17,
            stats: { idp_tkl: 100, idp_sack: 5 }
        },
        {
            year: 2024,
            gamesPlayed: 16,
            stats: { idp_tkl: 90, idp_sack: 4 }
        },
        {
            year: 2023,
            gamesPlayed: 15,
            stats: { idp_tkl: 80, idp_sack: 3 }
        }
    ]
});

assert.equal(lbResult.status, "COMPLETE");
assert.equal(lbResult.weightedFantasyPoints, 110.2);
assert.equal(lbResult.weightedPointsPerGame, 6.74);

console.log("✅ Three-season IDP performance passed");

console.log("\n🎉 All Player Performance Engine tests passed!");
