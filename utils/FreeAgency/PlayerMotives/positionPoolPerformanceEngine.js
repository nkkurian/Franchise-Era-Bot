
"use strict";

const {
    buildPositionPlayerPool
} = require("./positionPlayerPoolEngine");

const {
    evaluateSleeperPlayer
} = require("./playerValuationEngine");

/**
 * Franchise Era — Position Pool Performance Engine
 *
 * Attaches fantasy performance results to selected
 * players in a complete Sleeper positional pool.
 *
 * Important rules:
 * - Every player remains in the pool.
 * - Every player remains eligible for Free Agency.
 * - Players without statistics remain included.
 * - Players not selected remain NOT_EVALUATED.
 * - No salaries or rankings are calculated here.
 */

/**
 * Build a positional pool and evaluate selected players.
 *
 * @param {object} options
 * @param {string} options.position
 * @param {string} options.leagueId
 * @param {string[]} options.playerIds
 */
async function buildPositionPoolWithPerformance({
    position,
    leagueId,
    playerIds = []
}) {
    if (!leagueId) {
        throw new Error("League ID is required.");
    }

    if (!Array.isArray(playerIds)) {
        throw new Error("Player IDs must be an array.");
    }

    // Start with the complete positional player pool.
    const pool = await buildPositionPlayerPool(position);

    // Deduplicate requested IDs.
    const selectedIds = new Set(
        playerIds.map(id => String(id))
    );

    // Only evaluate IDs that exist in this position pool.
    const selectedPlayers = pool.players.filter(
        player => selectedIds.has(player.playerId)
    );

    const performanceById = new Map();
    const errors = [];

    // Evaluate sequentially to avoid excessive requests.
    for (const player of selectedPlayers) {
        try {
            const result = await evaluateSleeperPlayer({
                playerId: player.playerId,
                position: player.sleeperPosition,
                leagueId: String(leagueId)
            });

            performanceById.set(player.playerId, result);
        } catch (error) {
            errors.push({
                playerId: player.playerId,
                name: player.name,
                message: error.message
            });
        }
    }

    // Merge evaluated results into the COMPLETE pool.
    const players = pool.players.map(player => {
        const performance = performanceById.get(
            player.playerId
        );

        if (!performance) {
            return player;
        }

        return {
            ...player,

            performanceStatus: performance.status,
            weightedPointsPerGame:
                performance.weightedPointsPerGame ?? null,

            weightedFantasyPoints:
                performance.weightedFantasyPoints ?? null,

            totalGamesPlayed:
                performance.totalGamesPlayed ?? 0,

            seasonsUsed:
                performance.seasonsUsed ?? 0,

            confidenceScore:
                performance.confidenceScore ?? null,

            confidenceLevel:
                performance.confidenceLevel ?? null,

            weightedGames:
                performance.weightedGames ?? null,

            recencyScore:
                performance.recencyScore ?? null,

            playerRole:
                performance.playerRole ?? null,

            roleSource:
                performance.roleSource ?? null,

            seasonResults:
                performance.seasonResults ?? [],

            // No salary calculation in this module.
            suggestedAAV: null,
            valuationStatus: "NOT_EVALUATED",

            // Franchise Era rule:
            // All Sleeper players remain FA eligible.
            eligibleForFreeAgency: true
        };
    });

    return {
        position: pool.position,
        totalPlayers: players.length,
        requestedCount: selectedIds.size,
        evaluatedCount: performanceById.size,
        errorCount: errors.length,
        errors,
        players
    };
}

module.exports = {
    buildPositionPoolWithPerformance
};
