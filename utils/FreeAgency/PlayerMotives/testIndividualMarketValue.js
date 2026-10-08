
"use strict";

const assert = require("node:assert/strict");

const {
    getPerformanceMultiplier,
    calculateIndividualMarketValue
} = require("./individualMarketValueEngine");

const {
    rankPlayersByPosition
} = require("./positionRankingEngine");

// These are simulated contracts, not real league salaries.
function contract(position, aav) {
    return {
        position,
        contractLength: 2,
        yearsRemaining: 2,
        totalValue: aav * 2,
        aav
    };
}

const contracts = [
    contract("QB", 30_000_000),
    contract("QB", 40_000_000),
    contract("QB", 45_000_000),

    contract("WR", 10_000_000),
    contract("WR", 15_000_000),
    contract("WR", 20_000_000),

    contract("RB", 4_000_000),
    contract("RB", 6_000_000),
    contract("RB", 8_000_000),

    contract("TE", 4_000_000),
    contract("TE", 6_000_000),
    contract("TE", 8_000_000),

    contract("DE", 5_000_000),
    contract("DT", 7_500_000),
    contract("EDGE", 10_000_000),

    contract("ILB", 4_000_000),
    contract("OLB", 5_000_000),
    contract("MLB", 6_000_000),

    contract("CB", 4_000_000),
    contract("S", 5_000_000),
    contract("SS", 6_000_000)
];

// Simulated player performance.
const performances = [
    { playerId: "QB_TOP", position: "QB", weightedPointsPerGame: 25 },
    { playerId: "QB_MID", position: "QB", weightedPointsPerGame: 20 },
    { playerId: "QB_LOW", position: "QB", weightedPointsPerGame: 15 },

    { playerId: "WR_TOP", position: "WR", weightedPointsPerGame: 22 },
    { playerId: "WR_MID", position: "WR", weightedPointsPerGame: 16 },
    { playerId: "WR_LOW", position: "WR", weightedPointsPerGame: 10 },

    { playerId: "RB_TOP", position: "RB", weightedPointsPerGame: 20 },
    { playerId: "RB_MID", position: "RB", weightedPointsPerGame: 14 },
    { playerId: "RB_LOW", position: "RB", weightedPointsPerGame: 8 },

    { playerId: "TE_TOP", position: "TE", weightedPointsPerGame: 18 },
    { playerId: "TE_MID", position: "TE", weightedPointsPerGame: 12 },
    { playerId: "TE_LOW", position: "TE", weightedPointsPerGame: 6 },

    { playerId: "DL_TOP", position: "DE", weightedPointsPerGame: 14 },
    { playerId: "DL_MID", position: "DT", weightedPointsPerGame: 10 },
    { playerId: "DL_LOW", position: "EDGE", weightedPointsPerGame: 6 },

    { playerId: "LB_TOP", position: "ILB", weightedPointsPerGame: 15 },
    { playerId: "LB_MID", position: "OLB", weightedPointsPerGame: 10 },
    { playerId: "LB_LOW", position: "MLB", weightedPointsPerGame: 5 },

    { playerId: "DB_TOP", position: "CB", weightedPointsPerGame: 12 },
    { playerId: "DB_MID", position: "S", weightedPointsPerGame: 9 },
    { playerId: "DB_LOW", position: "SS", weightedPointsPerGame: 6 }
];

const rankings = rankPlayersByPosition(performances);

// Test 1: Performance multipliers
assert.equal(getPerformanceMultiplier(0), 0.6);
assert.equal(getPerformanceMultiplier(50), 1);
assert.equal(getPerformanceMultiplier(100), 1.6);
assert.equal(getPerformanceMultiplier(null), null);

console.log("✅ Performance multipliers passed");

// Test 2: QB market value
const qb = calculateIndividualMarketValue({
    playerId: "QB_TOP",
    position: "QB",
    contracts,
    rankings
});

assert.equal(qb.positionMarketValue, 40_000_000);
assert.equal(qb.suggestedAAV, 64_000_000);
assert.equal(qb.positionRank, 1);
assert.equal(qb.valuationStatus, "ESTIMATED");

console.log("✅ QB market value passed");

// Test 3: WR market value
const wr = calculateIndividualMarketValue({
    playerId: "WR_MID",
    position: "WR",
    contracts,
    rankings
});

assert.equal(wr.positionMarketValue, 15_000_000);
assert.equal(wr.suggestedAAV, 15_000_000);
assert.equal(wr.performancePercentile, 50);

console.log("✅ WR market value passed");

// Test 4: RB and TE market values
const rb = calculateIndividualMarketValue({
    playerId: "RB_LOW",
    position: "RB",
    contracts,
    rankings
});

const te = calculateIndividualMarketValue({
    playerId: "TE_TOP",
    position: "TE",
    contracts,
    rankings
});

assert.equal(rb.suggestedAAV, 3_600_000);
assert.equal(te.suggestedAAV, 9_600_000);

console.log("✅ RB and TE market values passed");

// Test 5: Defensive position grouping
const dl = calculateIndividualMarketValue({
    playerId: "DL_MID",
    position: "DT",
    contracts,
    rankings
});

const lb = calculateIndividualMarketValue({
    playerId: "LB_TOP",
    position: "ILB",
    contracts,
    rankings
});

const db = calculateIndividualMarketValue({
    playerId: "DB_LOW",
    position: "SS",
    contracts,
    rankings
});

assert.equal(dl.position, "DL");
assert.equal(dl.positionMarketValue, 7_500_000);
assert.equal(dl.suggestedAAV, 7_500_000);

assert.equal(lb.position, "LB");
assert.equal(lb.suggestedAAV, 8_000_000);

assert.equal(db.position, "DB");
assert.equal(db.suggestedAAV, 3_000_000);

console.log("✅ DL, LB, and DB market values passed");

// Test 6: No performance ranking
const unranked = calculateIndividualMarketValue({
    playerId: "UNKNOWN",
    position: "WR",
    contracts,
    rankings
});

assert.equal(unranked.suggestedAAV, 15_000_000);
assert.equal(unranked.valuationStatus, "PROVISIONAL");

console.log("✅ Missing ranking fallback passed");

// Test 7: No signed contracts
const noContracts = calculateIndividualMarketValue({
    playerId: "QB_TOP",
    position: "QB",
    contracts: [],
    rankings
});

assert.equal(noContracts.positionMarketValue, 1_200_000);
assert.equal(noContracts.suggestedAAV, 1_900_000);
assert.equal(noContracts.valuationStatus, "PROVISIONAL");

console.log("✅ League minimum fallback passed");

console.log("\n🎉 All Individual Market Value Engine tests passed!");
