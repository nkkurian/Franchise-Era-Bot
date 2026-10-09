
"use strict";

const assert = require("node:assert/strict");

const {
    validateSignedContract
} = require("./signedContractValidator");

const {
    calculatePositionMarket
} = require("./marketValueEngine");

const MINIMUM_SALARY = 1_200_000;

// All test data is simulated.
// No Sleeper, Google Sheets, or Supabase connections.

function makeContract(playerId, team, aav, overrides = {}) {
    return {
        playerId,
        team,
        position: "WR",
        contractLength: 3,
        yearsRemaining: 2,
        totalValue: aav * 3,
        aav,
        ...overrides
    };
}

const contracts = [
    makeContract("101", "Dallas Cowboys", 5_000_000),
    makeContract("102", "Dallas Cowboys", 10_000_000),
    makeContract("103", "Dallas Cowboys", 15_000_000),
    makeContract("104", "Dallas Cowboys", 20_000_000),
    makeContract("105", "Dallas Cowboys", 25_000_000),

    // Free Agent with historical contract figures.
    makeContract("106", "Free Agent", 80_000_000),

    // Expired contract.
    makeContract("107", "Dallas Cowboys", 70_000_000, {
        yearsRemaining: 0
    }),

    // Assigned to a different franchise.
    makeContract("108", "Philadelphia Eagles", 60_000_000),

    // Not present on the supplied Sleeper roster.
    makeContract("109", "Dallas Cowboys", 50_000_000)
];

const rosterIds = [
    "101", "102", "103", "104", "105",
    "106", "107", "108"
];

function verifyContracts(rosterEvidence) {
    return contracts.map(contract =>
        validateSignedContract({
            contract,
            sleeperRosterPlayerIds: rosterEvidence,
            rosterTeam: "Dallas Cowboys"
        })
    );
}

function buildVerificationEvidence(rosterEvidence) {
    return {
        rosterMembershipByPlayerId: Object.fromEntries(
            contracts.map(contract => [
                String(contract.playerId),
                {
                    sleeperRosterPlayerIds: rosterEvidence,
                    rosterTeam: "Dallas Cowboys"
                }
            ])
        )
    };
}

// Test 1: Validator identifies exactly five valid contracts.
const results = verifyContracts(rosterIds);

const verifiedContracts = results
    .filter(result => result.valid)
    .map(result => result.normalizedContract);

assert.equal(verifiedContracts.length, 5);

assert.ok(
    results[5].reasons.includes("NOT_ASSIGNED_TO_FRANCHISE")
);

assert.ok(
    results[6].reasons.includes(
        "EXPIRED_OR_INVALID_REMAINING_YEARS"
    )
);

assert.ok(
    results[7].reasons.includes("TEAM_MISMATCH")
);

assert.ok(
    results[8].reasons.includes("PLAYER_NOT_ON_SLEEPER_ROSTER")
);

console.log("PASS: Validator identifies five qualifying contracts");

// Test 2: The protected market engine independently
// verifies contracts before calculating the median.
const verifiedMarket = calculatePositionMarket(
    contracts,
    "WR",
    buildVerificationEvidence(rosterIds)
);

assert.equal(verifiedMarket.marketValue, 15_000_000);
assert.equal(verifiedMarket.sampleSize, 5);
assert.equal(verifiedMarket.confidence, "MEDIUM");
assert.equal(verifiedMarket.rejectedContractCount, 4);
assert.equal(
    verifiedMarket.source,
    "VERIFIED_SIGNED_LEAGUE_CONTRACTS"
);

console.log("PASS: Protected market produces correct median");

// Test 3: Missing roster evidence rejects every contract.
const missingEvidenceResults = verifyContracts(undefined);

assert.equal(
    missingEvidenceResults.filter(result => result.valid).length,
    0
);

assert.ok(
    missingEvidenceResults.every(result =>
        result.reasons.includes("MISSING_ROSTER_EVIDENCE")
    )
);

const fallbackMarket = calculatePositionMarket(
    contracts,
    "WR"
);

assert.equal(fallbackMarket.marketValue, MINIMUM_SALARY);
assert.equal(fallbackMarket.sampleSize, 0);
assert.equal(fallbackMarket.confidence, "NO_DATA");
assert.equal(fallbackMarket.rejectedContractCount, 9);
assert.equal(
    fallbackMarket.source,
    "LEAGUE_MINIMUM_FALLBACK"
);

console.log("PASS: Missing evidence produces safe fallback");

// Test 4: Pre-filtered contracts cannot bypass
// the market engine's own verification requirements.
const prefilteredWithoutEvidence = calculatePositionMarket(
    verifiedContracts,
    "WR"
);

assert.equal(
    prefilteredWithoutEvidence.marketValue,
    MINIMUM_SALARY
);
assert.equal(prefilteredWithoutEvidence.sampleSize, 0);
assert.equal(
    prefilteredWithoutEvidence.rejectedContractCount,
    5
);

console.log("PASS: Pre-filtering cannot bypass verification");

// Test 5: A signed flag alone is insufficient.
const signedFlagOnly = calculatePositionMarket(
    [
        makeContract("999", "Dallas Cowboys", 99_000_000, {
            signed: true
        })
    ],
    "WR"
);

assert.equal(signedFlagOnly.marketValue, MINIMUM_SALARY);
assert.equal(signedFlagOnly.sampleSize, 0);

console.log("PASS: Signed flag cannot bypass verification");

console.log(
    "\nAll Verified Contract Market tests passed!"
);
