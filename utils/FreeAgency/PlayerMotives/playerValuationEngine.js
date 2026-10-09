
"use strict";

const {
    getPlayerPerformanceInputs
} = require("./sleeperPerformanceFetcher");

const {
    evaluatePlayerPerformance
} = require("./playerPerformanceEngine");

const {
    evaluatePerformanceConfidence,
    evaluateRecencyConfidence
} = require("./performanceConfidenceEngine");

const {
    classifyPlayerRole
} = require("./playerRoleEngine");

/**
 * Retrieve a player's real Sleeper statistics and calculate
 * their three-year performance using league scoring.
 *
 * Also measures:
 * - Confidence based on total games played
 * - Recency of usable performance
 * - Performance-history role classification
 *
 * The player role is NOT an actual NFL depth-chart role.
 *
 * This does not assign a dollar value yet.
 */
async function evaluateSleeperPlayer({
    playerId,
    position,
    leagueId
}) {
    if (!playerId) {
        throw new Error("Sleeper player ID is required.");
    }

    if (!position) {
        throw new Error("Player position is required.");
    }

    if (!leagueId) {
        throw new Error("Sleeper league ID is required.");
    }

    const inputs = await getPlayerPerformanceInputs({
        playerId,
        position,
        leagueId
    });

    const performance = evaluatePlayerPerformance(inputs);

    const confidence = evaluatePerformanceConfidence(
        performance.totalGamesPlayed
    );

    // Anchor recency weights to the latest completed
    // season supplied by our Sleeper fetcher.
    const completedYears = inputs.seasons
        .map(season => Number(season.year))
        .filter(Number.isInteger);

    if (completedYears.length === 0) {
        throw new Error("No completed NFL seasons available.");
    }

    const latestCompletedYear = Math.max(...completedYears);

    const recency = evaluateRecencyConfidence(
        performance.seasonResults,
        latestCompletedYear
    );

    // Classify the amount of usable performance history.
    // This is separate from real NFL starter/backup status.
    const playerRole = classifyPlayerRole(
        performance.totalGamesPlayed
    );

    return {
        ...performance,

        confidenceScore: confidence.confidenceScore,
        confidenceLevel: confidence.confidenceLevel,
        eligibleForFreeAgency: confidence.eligibleForFreeAgency,

        weightedGames: recency.weightedGames,
        recencyScore: recency.recencyScore,

        playerRole: playerRole.role,
        roleSource: playerRole.roleSource,
        nflDepthChartRole: playerRole.nflDepthChartRole,
        salaryAdjustment: playerRole.salaryAdjustment
    };
}

module.exports = {
    evaluateSleeperPlayer
};
