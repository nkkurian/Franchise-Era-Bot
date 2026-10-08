
"use strict";

const assert = require("node:assert/strict");

const {
    normalizePosition,
    rankPlayersByPosition,
    getPlayerPositionRanking
} = require("./positionRankingEngine");

// Test 1: Position grouping
assert.equal(normalizePosition("DE"), "DL");
assert.equal(normalizePosition("DT"), "DL");
assert.equal(normalizePosition("EDGE"), "DL");
assert.equal(normalizePosition("ILB"), "LB");
assert.equal(normalizePosition("OLB"), "LB");
assert.equal(normalizePosition("CB"), "DB");
assert.equal(normalizePosition("SS"), "DB");
assert.equal(normalizePosition("WR"), "WR");

console.log("✅ Position grouping passed");

// Test 2: Rank quarterbacks against quarterbacks
const players = [
    { playerId: "QB_A", position: "QB", weightedPointsPerGame: 24, seasonsUsed: 3 },
    { playerId: "QB_B", position: "QB", weightedPointsPerGame: 21.5, seasonsUsed: 3 },
    { playerId: "QB_C", position: "QB", weightedPointsPerGame: 19.79, seasonsUsed: 3 },
    { playerId: "QB_D", position: "QB", weightedPointsPerGame: 16, seasonsUsed: 3 },
    { playerId: "QB_E", position: "QB", weightedPointsPerGame: 12, seasonsUsed: 3 },

    // Defensive players should be ranked separately.
    { playerId: "DL_A", position: "DE", weightedPointsPerGame: 11, seasonsUsed: 3 },
    { playerId: "DL_B", position: "DT", weightedPointsPerGame: 8, seasonsUsed: 3 },
    { playerId: "LB_A", position: "ILB", weightedPointsPerGame: 14, seasonsUsed: 3 },
    { playerId: "LB_B", position: "OLB", weightedPointsPerGame: 10, seasonsUsed: 3 },
    { playerId: "DB_A", position: "CB", weightedPointsPerGame: 9, seasonsUsed: 3 },
    { playerId: "DB_B", position: "SS", weightedPointsPerGame: 7, seasonsUsed: 3 },

    // A single-player position group.
    { playerId: "TE_A", position: "TE", weightedPointsPerGame: 13, seasonsUsed: 3 },

    // Missing performance data should be excluded.
    { playerId: "WR_MISSING", position: "WR", weightedPointsPerGame: null, seasonsUsed: 0 }
];

const rankings = rankPlayersByPosition(players);

const qbA = getPlayerPositionRanking(rankings, "QB_A");
const qbC = getPlayerPositionRanking(rankings, "QB_C");
const qbE = getPlayerPositionRanking(rankings, "QB_E");

assert.equal(qbA.rank, 1);
assert.equal(qbA.percentile, 100);
assert.equal(qbC.rank, 3);
assert.equal(qbC.percentile, 50);
assert.equal(qbE.rank, 5);
assert.equal(qbE.percentile, 0);

console.log("✅ QB ranking and percentiles passed");

// Test 3: Defensive position groups
const dlA = getPlayerPositionRanking(rankings, "DL_A");
const dlB = getPlayerPositionRanking(rankings, "DL_B");
const lbA = getPlayerPositionRanking(rankings, "LB_A");
const dbA = getPlayerPositionRanking(rankings, "DB_A");

assert.equal(dlA.position, "DL");
assert.equal(dlA.rank, 1);
assert.equal(dlB.rank, 2);
assert.equal(lbA.position, "LB");
assert.equal(lbA.rank, 1);
assert.equal(dbA.position, "DB");
assert.equal(dbA.rank, 1);

console.log("✅ DL, LB, and DB rankings passed");

// Test 4: Insufficient peers
const teA = getPlayerPositionRanking(rankings, "TE_A");

assert.equal(teA.rank, 1);
assert.equal(teA.percentile, null);
assert.equal(teA.rankingStatus, "INSUFFICIENT_PEERS");

console.log("✅ Insufficient peer handling passed");

// Test 5: Missing data
assert.equal(getPlayerPositionRanking(rankings, "WR_MISSING"), null);

console.log("✅ Missing performance data excluded");

// Test 6: Invalid input
assert.throws(
    () => rankPlayersByPosition(null),
    /Players must be an array/
);

console.log("✅ Invalid input handling passed");

console.log("\n🎉 All Position Ranking Engine tests passed!");
