
"use strict";

const assert = require("node:assert/strict");

const {
    MINIMUM_SALARY,
    parseSalary,
    calculatePositionMarket,
    calculateAllPositionMarkets
} = require("./marketValueEngine");

// Simulated Player List contracts and Sleeper roster evidence.
// No real league data, API calls, or live writes.

function makeContract(playerId, position, aav, options = {}) {
    const contractLength = options.contractLength ?? 4;

    return {
        playerId,
        name: `Test Player ${playerId}`,
        team: options.team ?? "Dallas Cowboys",
        position,
        contractLength,
        yearsRemaining: options.yearsRemaining ?? 2,
        totalValue: aav * contractLength,
        aav,
        ...options
    };
}

const players = [
    makeContract("WR1", "WR", 5_000_000),
    makeContract("WR2", "WR", 10_000_000),
    makeContract("WR3", "WR", 15_000_000),
    makeContract("WR4", "WR", 20_000_000),
    makeContract("WR5", "WR", 25_000_000),

    makeContract("QB1", "QB", 45_000_000),

    makeContract("RB1", "RB", 3_000_000),
    makeContract("RB2", "RB", 6_000_000),
    makeContract("RB3", "RB", 9_000_000),

    makeContract("TE1", "TE", 4_000_000),
    makeContract("TE2", "TE", 8_000_000),

    makeContract("DL1", "DL", 5_000_000),
    makeContract("DL2", "DL", 10_000_000),

    makeContract("LB1", "LB", 3_000_000),
    makeContract("LB2", "LB", 7_000_000),

    makeContract("DB1", "DB", 4_000_000),
    makeContract("DB2", "DB", 6_000_000),

    // Invalid records must not affect the WR median.
    makeContract("FREE", "WR", 80_000_000, {
        team: "Free Agent"
    }),

    makeContract("EXPIRED", "WR", 70_000_000, {
        yearsRemaining: 0
    }),

    makeContract("MISMATCH", "WR", 60_000_000, {
        team: "Philadelphia Eagles"
    }),

    makeContract("UNROSTERED", "WR", 50_000_000)
];

const rosteredIds = players
    .filter((player) => player.playerId !== "UNROSTERED")
    .map((player) => player.playerId);

const verificationEvidence = {
    rosterMembershipByPlayerId: Object.fromEntries(
        players.map((player) => [
            player.playerId,
            {
                sleeperRosterPlayerIds: rosteredIds,
                rosterTeam: "Dallas Cowboys"
            }
        ])
    )
};

// Test 1: Salary parsing and minimum salary.
assert.equal(MINIMUM_SALARY, 1_200_000);
assert.equal(parseSalary("$45M"), 45_000_000);
assert.equal(parseSalary("$1.2M"), 1_200_000);
assert.ok(Number.isNaN(parseSalary("#DIV/0!")));

console.log("PASS: Salary parsing and league minimum");

// Test 2: Verified WR contracts determine the median.
const wrMarket = calculatePositionMarket(
    players,
    "WR",
    verificationEvidence
);

assert.equal(wrMarket.marketValue, 15_000_000);
assert.equal(wrMarket.sampleSize, 5);
assert.equal(wrMarket.confidence, "MEDIUM");
assert.equal(wrMarket.lowestContract, 5_000_000);
assert.equal(wrMarket.highestContract, 25_000_000);
assert.equal(wrMarket.rejectedContractCount, 4);

const rejectionReasons = wrMarket.rejectedContracts
    .flatMap((entry) => entry.reasons);

assert.ok(rejectionReasons.includes("NOT_ASSIGNED_TO_FRANCHISE"));
assert.ok(
    rejectionReasons.includes(
        "EXPIRED_OR_INVALID_REMAINING_YEARS"
    )
);
assert.ok(rejectionReasons.includes("TEAM_MISMATCH"));
assert.ok(
    rejectionReasons.includes("PLAYER_NOT_ON_SLEEPER_ROSTER")
);

console.log("PASS: Verified WR market and invalid-contract rejection");

// Test 3: Verified QB market.
const qbMarket = calculatePositionMarket(
    players,
    "QB",
    verificationEvidence
);

assert.equal(qbMarket.marketValue, 45_000_000);
assert.equal(qbMarket.sampleSize, 1);
assert.equal(qbMarket.confidence, "LOW");

console.log("PASS: Verified QB market");

// Test 4: Other position markets.
const expectedMarkets = {
    RB: 6_000_000,
    TE: 6_000_000,
    DL: 7_500_000,
    LB: 5_000_000,
    DB: 5_000_000
};

for (const [position, expectedValue] of Object.entries(expectedMarkets)) {
    const market = calculatePositionMarket(
        players,
        position,
        verificationEvidence
    );

    assert.equal(market.marketValue, expectedValue);
    assert.ok(market.sampleSize > 0);
}

console.log("PASS: RB, TE, DL, LB, and DB markets");

// Test 5: No verification evidence means no qualifying contracts.
const unverifiedMarket = calculatePositionMarket(players, "WR");

assert.equal(unverifiedMarket.marketValue, MINIMUM_SALARY);
assert.equal(unverifiedMarket.sampleSize, 0);
assert.equal(unverifiedMarket.confidence, "NO_DATA");

console.log("PASS: Missing verification evidence fails closed");

// Test 6: A signed flag alone cannot bypass verification.
const forgedContract = makeContract("FORGED", "WR", 99_000_000, {
    signed: true
});

const forgedMarket = calculatePositionMarket(
    [forgedContract],
    "WR"
);

assert.equal(forgedMarket.marketValue, MINIMUM_SALARY);
assert.equal(forgedMarket.sampleSize, 0);

console.log("PASS: Signed flag cannot bypass verification");

// Test 7: Calculate all position markets using the same evidence.
const allMarkets = calculateAllPositionMarkets(
    players,
    verificationEvidence
);

assert.equal(allMarkets.WR.marketValue, 15_000_000);
assert.equal(allMarkets.QB.marketValue, 45_000_000);
assert.equal(allMarkets.RB.marketValue, 6_000_000);
assert.equal(allMarkets.TE.marketValue, 6_000_000);
assert.equal(allMarkets.DL.marketValue, 7_500_000);
assert.equal(allMarkets.LB.marketValue, 5_000_000);
assert.equal(allMarkets.DB.marketValue, 5_000_000);

console.log("PASS: All-position market calculations");

console.log("\nAll Market Value Engine tests passed!");
