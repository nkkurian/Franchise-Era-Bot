
"use strict";

const assert = require("node:assert/strict");

const {
    MINIMUM_MARKET_CONTRACTS,
    getPerformanceMultiplier,
    calculateIndividualMarketValue
} = require("./individualMarketValueEngine");

const {
    rankPlayersByPosition
} = require("./positionRankingEngine");

// Simulated contracts only. No real league data is used.
// Player List determines contract status; Sleeper roster
// evidence verifies membership and franchise mapping.
let nextContractId = 1;

function contract(position, aav, options = {}) {
    const playerId = `CONTRACT_${nextContractId++}`;

    return {
        playerId,
        team: "Dallas Cowboys",
        position,
        contractLength: 2,
        yearsRemaining: 2,
        totalValue: aav * 2,
        aav,
        ...options
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

function buildVerificationEvidence(contractRecords) {
    const rosteredIds = contractRecords
        .filter(record => record.playerId)
        .map(record => String(record.playerId));

    return {
        rosterMembershipByPlayerId: Object.fromEntries(
            contractRecords.map(record => [
                String(record.playerId),
                {
                    sleeperRosterPlayerIds: rosteredIds,
                    rosterTeam: "Dallas Cowboys"
                }
            ])
        )
    };
}

const verificationEvidence = buildVerificationEvidence(contracts);

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

function evaluate(playerId, position, options = {}) {
    const selectedContracts = options.contracts ?? contracts;

    return calculateIndividualMarketValue({
        playerId,
        position,
        contracts: selectedContracts,
        rankings: options.rankings ?? rankings,
        verificationEvidence:
            options.verificationEvidence ??
            buildVerificationEvidence(selectedContracts)
    });
}

function assertSafetyLock(result) {
    assert.equal(result.performanceMultiplier, 1);
    assert.equal(result.performanceAdjustmentAuthorized, false);
    assert.equal(result.valuationStatus, "PROVISIONAL");
    assert.equal(result.signed, false);
    assert.equal(result.performancePercentile, null);
    assert.equal(result.positionRank, null);
    assert.equal(result.positionPlayerCount, null);
}

// Test 1: Proposed multiplier curve exists but is not applied.
assert.equal(getPerformanceMultiplier(0), 0.6);
assert.equal(getPerformanceMultiplier(50), 1);
assert.equal(getPerformanceMultiplier(100), 1.6);
assert.equal(getPerformanceMultiplier(null), null);

assert.equal(MINIMUM_MARKET_CONTRACTS, 5);

console.log("PASS: Proposed multiplier curve and threshold");

// Test 2: QB market uses median AAV without performance adjustment.
const qb = evaluate("QB_TOP", "QB");

assert.equal(qb.positionMarketValue, 40_000_000);
assert.equal(qb.suggestedAAV, 40_000_000);
assert.equal(qb.marketSampleSize, 3);
assert.equal(qb.contractBaselineEligible, false);
assertSafetyLock(qb);

console.log("PASS: QB market and salary security lock");

// Test 3: WR mid-tier player receives market median.
const wr = evaluate("WR_MID", "WR");

assert.equal(wr.positionMarketValue, 15_000_000);
assert.equal(wr.suggestedAAV, 15_000_000);
assertSafetyLock(wr);

console.log("PASS: WR market value");

// Test 4: RB and TE are not adjusted by rankings.
const rb = evaluate("RB_LOW", "RB");
const te = evaluate("TE_TOP", "TE");

assert.equal(rb.suggestedAAV, 6_000_000);
assert.equal(te.suggestedAAV, 6_000_000);
assertSafetyLock(rb);
assertSafetyLock(te);

console.log("PASS: RB and TE locked salaries");

// Test 5: Defensive position normalization.
const dl = evaluate("DL_MID", "DT");
const lb = evaluate("LB_TOP", "ILB");
const db = evaluate("DB_LOW", "SS");

assert.equal(dl.position, "DL");
assert.equal(dl.positionMarketValue, 7_500_000);
assert.equal(dl.suggestedAAV, 7_500_000);

assert.equal(lb.position, "LB");
assert.equal(lb.positionMarketValue, 5_000_000);
assert.equal(lb.suggestedAAV, 5_000_000);

assert.equal(db.position, "DB");
assert.equal(db.positionMarketValue, 5_000_000);
assert.equal(db.suggestedAAV, 5_000_000);

assertSafetyLock(dl);
assertSafetyLock(lb);
assertSafetyLock(db);

console.log("PASS: Defensive position grouping");

// Test 6: Missing rankings must not prevent provisional pricing.
const unranked = evaluate("UNKNOWN", "WR", {
    rankings: []
});

assert.equal(unranked.suggestedAAV, 15_000_000);
assertSafetyLock(unranked);

console.log("PASS: Unranked player fallback");

// Test 7: No contracts falls back to league minimum.
const noContracts = evaluate("QB_TOP", "QB", {
    contracts: []
});

assert.equal(noContracts.positionMarketValue, 1_200_000);
assert.equal(noContracts.suggestedAAV, 1_200_000);
assert.equal(noContracts.marketSampleSize, 0);
assert.equal(noContracts.contractBaselineEligible, false);
assertSafetyLock(noContracts);

console.log("PASS: League minimum fallback");

// Test 8: Five verified contracts meet the sample threshold
// but do not authorize performance adjustments.
const fiveContracts = [
    contract("WR", 5_000_000),
    contract("WR", 10_000_000),
    contract("WR", 15_000_000),
    contract("WR", 20_000_000),
    contract("WR", 25_000_000)
];

const eligible = evaluate("WR_TOP", "WR", {
    contracts: fiveContracts
});

assert.equal(eligible.positionMarketValue, 15_000_000);
assert.equal(eligible.suggestedAAV, 15_000_000);
assert.equal(eligible.marketSampleSize, 5);
assert.equal(eligible.contractBaselineEligible, true);
assertSafetyLock(eligible);

console.log("PASS: Five-contract threshold does not unlock salaries");

// Test 9: Even caller-supplied elite rankings cannot unlock pricing.
const elite = evaluate("QB_TOP", "QB", {
    rankings: [{
        playerId: "QB_TOP",
        position: "QB",
        rank: 1,
        percentile: 100
    }]
});

assert.equal(elite.suggestedAAV, 40_000_000);
assertSafetyLock(elite);

console.log("PASS: Caller rankings cannot authorize adjustments");

// Test 10: Missing verification evidence fails closed.
const unverified = evaluate("WR_TOP", "WR", {
    verificationEvidence: {}
});

assert.equal(unverified.positionMarketValue, 1_200_000);
assert.equal(unverified.suggestedAAV, 1_200_000);
assert.equal(unverified.marketSampleSize, 0);
assert.equal(unverified.contractBaselineEligible, false);
assertSafetyLock(unverified);

console.log("PASS: Missing verification evidence fails closed");

// Test 11: An invalid contract cannot count toward the threshold.
const invalidContracts = [
    contract("WR", 5_000_000),
    contract("WR", 10_000_000),
    contract("WR", 15_000_000),
    contract("WR", 20_000_000),
    contract("WR", 90_000_000, {
        team: "Free Agent"
    })
];

const belowThreshold = evaluate("WR_TOP", "WR", {
    contracts: invalidContracts
});

assert.equal(belowThreshold.positionMarketValue, 12_500_000);
assert.equal(belowThreshold.marketSampleSize, 4);
assert.equal(belowThreshold.contractBaselineEligible, false);
assertSafetyLock(belowThreshold);

console.log("PASS: Invalid contracts do not count toward threshold");

console.log("\nAll Individual Market Value Engine tests passed!");
