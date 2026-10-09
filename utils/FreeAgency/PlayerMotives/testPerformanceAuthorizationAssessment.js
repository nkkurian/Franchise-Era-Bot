
"use strict";

const assert = require("node:assert/strict");

const assessmentPath = require.resolve(
    "./performanceAuthorizationAssessment"
);

const checkpointPath = require.resolve(
    "./checkpointPositionRankingEngine"
);

// Simulated checkpoint. No Sleeper calls or checkpoint writes.
const simulatedCheckpoint = {
    position: "WR",
    totalPlayers: 3,
    evaluatedCount: 3,
    notEvaluatedCount: 0,
    rankableCount: 3,
    checkpointCoverageVerified: true,

    players: [
        { playerId: "WR_TOP" },
        { playerId: "WR_MID" },
        { playerId: "WR_LOW" }
    ],

    rankings: [
        { playerId: "WR_TOP", rank: 1, percentile: 100 },
        { playerId: "WR_MID", rank: 2, percentile: 50 },
        { playerId: "WR_LOW", rank: 3, percentile: 0 }
    ]
};

// Replace the checkpoint dependency only while loading
// the assessment module for this isolated test.
const originalCheckpointModule = require.cache[checkpointPath];

require.cache[checkpointPath] = {
    id: checkpointPath,
    filename: checkpointPath,
    loaded: true,
    exports: {
        buildCheckpointPositionRankings: async () =>
            simulatedCheckpoint
    }
};

let assessPerformanceAdjustmentReadiness;

try {
    delete require.cache[assessmentPath];

    ({
        assessPerformanceAdjustmentReadiness
    } = require("./performanceAuthorizationAssessment"));
} finally {
    if (originalCheckpointModule) {
        require.cache[checkpointPath] = originalCheckpointModule;
    } else {
        delete require.cache[checkpointPath];
    }

    delete require.cache[assessmentPath];
}

// All contracts below are fictional test records.
function makeContract(number, options = {}) {
    return {
        playerId: `CONTRACT_${number}`,
        team: "Dallas Cowboys",
        position: "WR",
        contractLength: 3,
        yearsRemaining: 2,
        totalValue: number * 3_000_000,
        aav: number * 1_000_000,
        ...options
    };
}

function buildEvidence(contracts) {
    const rosterIds = contracts.map(
        contract => String(contract.playerId)
    );

    return {
        rosterMembershipByPlayerId: Object.fromEntries(
            contracts.map(contract => [
                String(contract.playerId),
                {
                    sleeperRosterPlayerIds: rosterIds,
                    rosterTeam: "Dallas Cowboys"
                }
            ])
        )
    };
}

function makeInput(contracts, verificationEvidence) {
    return {
        playerId: "WR_TOP",
        position: "WR",
        leagueId: "TEST_LEAGUE",
        contracts,
        verificationEvidence
    };
}

async function expectRejection(input, expectedMessage) {
    await assert.rejects(
        () => assessPerformanceAdjustmentReadiness(input),
        error => {
            assert.equal(error.message, expectedMessage);
            return true;
        }
    );
}

function assertAuthorizationLocked(result) {
    assert.equal(
        result.performanceAdjustmentAuthorized,
        false
    );

    assert.equal(result.salaryMultiplierApplied, false);
}

async function runTests() {
    // Test 1: Player ID required.
    await expectRejection(
        { ...makeInput([], {}), playerId: "" },
        "Player ID is required."
    );

    console.log("PASS: Player ID required");

    // Test 2: League ID required.
    await expectRejection(
        { ...makeInput([], {}), leagueId: "" },
        "League ID is required."
    );

    console.log("PASS: League ID required");

    // Test 3: Contracts array required.
    await expectRejection(
        { ...makeInput([], {}), contracts: null },
        "Contracts must be an array."
    );

    console.log("PASS: Contracts array required");

    // Test 4: Position required.
    await expectRejection(
        { ...makeInput([], {}), position: "" },
        "Position is required."
    );

    console.log("PASS: Position required");

    const fiveContracts = [
        makeContract(5),
        makeContract(10),
        makeContract(15),
        makeContract(20),
        makeContract(25)
    ];

    // Test 5: Five verified contracts satisfy readiness
    // prerequisites, but do not grant authorization.
    const eligible = await assessPerformanceAdjustmentReadiness(
        makeInput(
            fiveContracts,
            buildEvidence(fiveContracts)
        )
    );

    assert.equal(eligible.marketSampleSize, 5);
    assert.equal(eligible.contractBaselineEligible, true);
    assert.equal(eligible.checkpointReady, true);
    assert.equal(eligible.playerRankingValid, true);
    assert.equal(eligible.requirementsMet, true);
    assertAuthorizationLocked(eligible);

    console.log(
        "PASS: Five verified contracts do not authorize adjustments"
    );

    // Test 6: Missing verification evidence fails closed.
    const unverified = await assessPerformanceAdjustmentReadiness(
        makeInput(fiveContracts, {})
    );

    assert.equal(unverified.marketSampleSize, 0);
    assert.equal(unverified.contractBaselineEligible, false);
    assert.equal(unverified.requirementsMet, false);
    assertAuthorizationLocked(unverified);

    console.log("PASS: Missing verification evidence fails closed");

    // Test 7: Invalid contracts do not count toward threshold.
    const invalidContracts = [
        ...fiveContracts.slice(0, 4),
        makeContract(50, { team: "Free Agent" })
    ];

    const invalid = await assessPerformanceAdjustmentReadiness(
        makeInput(
            invalidContracts,
            buildEvidence(invalidContracts)
        )
    );

    assert.equal(invalid.marketSampleSize, 4);
    assert.equal(invalid.contractBaselineEligible, false);
    assert.equal(invalid.requirementsMet, false);
    assertAuthorizationLocked(invalid);

    console.log("PASS: Invalid contract excluded from threshold");

    // Test 8: An unranked player cannot satisfy readiness.
    const originalRankings = simulatedCheckpoint.rankings;

    try {
        simulatedCheckpoint.rankings = originalRankings.filter(
            ranking => ranking.playerId !== "WR_TOP"
        );

        const unranked = await assessPerformanceAdjustmentReadiness(
            makeInput(
                fiveContracts,
                buildEvidence(fiveContracts)
            )
        );

        assert.equal(unranked.playerRankingValid, false);
        assert.equal(unranked.requirementsMet, false);
        assertAuthorizationLocked(unranked);
    } finally {
        simulatedCheckpoint.rankings = originalRankings;
    }

    console.log("PASS: Unranked player cannot satisfy readiness");

    console.log(
        "\nAll Performance Authorization Assessment tests passed!"
    );
}

runTests().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
