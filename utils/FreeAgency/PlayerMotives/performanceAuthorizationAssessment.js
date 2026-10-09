
"use strict";

const {
    buildCheckpointPositionRankings
} = require("./checkpointPositionRankingEngine");

const {
    calculatePositionMarket
} = require("./marketValueEngine");

const {
    normalizePosition
} = require("./positionRankingEngine");

const {
    MINIMUM_MARKET_CONTRACTS
} = require("./individualMarketValueEngine");

/**
 * Read-only assessment of whether a player meets
 * the prerequisites for a future performance-based
 * salary adjustment.
 *
 * Only verified signed league contracts count
 * toward the minimum contract threshold.
 *
 * This function does NOT authorize an adjustment.
 * It does NOT calculate or modify salaries.
 */
async function assessPerformanceAdjustmentReadiness({
    playerId,
    position,
    leagueId,
    contracts,
    verificationEvidence = {}
}) {
    if (playerId == null || String(playerId) === "") {
        throw new Error("Player ID is required.");
    }

    if (!leagueId) {
        throw new Error("League ID is required.");
    }

    if (!Array.isArray(contracts)) {
        throw new Error("Contracts must be an array.");
    }

    const normalizedPosition = normalizePosition(position);

    if (!normalizedPosition) {
        throw new Error("Position is required.");
    }

    const normalizedContracts = contracts
        .filter(Boolean)
        .map(contract => ({
            ...contract,
            position: normalizePosition(contract.position)
        }));

    // Missing verification evidence fails closed:
    // unverified contracts cannot count toward
    // performance-readiness requirements.
    const positionMarket = calculatePositionMarket(
        normalizedContracts,
        normalizedPosition,
        verificationEvidence
    );

    const contractBaselineEligible =
        positionMarket.sampleSize >= MINIMUM_MARKET_CONTRACTS;

    // Independently validate the current checkpoint,
    // scoring settings, completed seasons and full pool.
    const checkpoint = await buildCheckpointPositionRankings({
        position: normalizedPosition,
        leagueId: String(leagueId)
    });

    const player = checkpoint.players.find(
        entry => String(entry.playerId) === String(playerId)
    );

    if (!player) {
        throw new Error(
            "Player is not in the current Sleeper position pool."
        );
    }

    const ranking = checkpoint.rankings.find(
        entry => String(entry.playerId) === String(playerId)
    );

    const playerRankingValid =
        !!ranking &&
        Number.isFinite(ranking.percentile) &&
        ranking.percentile >= 0 &&
        ranking.percentile <= 100 &&
        Number.isInteger(ranking.rank) &&
        ranking.rank >= 1 &&
        checkpoint.rankableCount >= 2;

    const checkpointReady =
        checkpoint.checkpointCoverageVerified === true &&
        checkpoint.notEvaluatedCount === 0 &&
        checkpoint.evaluatedCount === checkpoint.totalPlayers;

    const requirementsMet =
        checkpointReady &&
        playerRankingValid &&
        contractBaselineEligible;

    return {
        playerId: String(playerId),
        position: normalizedPosition,
        leagueId: String(leagueId),

        checkpointReady,
        checkpointCoverageVerified:
            checkpoint.checkpointCoverageVerified,

        totalPlayers: checkpoint.totalPlayers,
        evaluatedCount: checkpoint.evaluatedCount,
        rankableCount: checkpoint.rankableCount,

        playerRankingValid,
        positionRank: ranking?.rank ?? null,
        performancePercentile:
            ranking?.percentile ?? null,

        marketSampleSize: positionMarket.sampleSize,
        marketConfidence: positionMarket.confidence,

        minimumMarketContracts:
            MINIMUM_MARKET_CONTRACTS,

        contractBaselineEligible,

        requirementsMet,

        // SECURITY LOCK:
        // Readiness does not grant authorization.
        performanceAdjustmentAuthorized: false,

        salaryMultiplierApplied: false
    };
}

module.exports = {
    assessPerformanceAdjustmentReadiness
};
