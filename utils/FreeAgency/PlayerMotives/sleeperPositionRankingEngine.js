
"use strict";

const {
    evaluateSleeperPlayer
} = require("./playerValuationEngine");

const {
    normalizePosition,
    rankPlayersByPosition
} = require("./positionRankingEngine");

/**
 * Evaluates real Sleeper players and ranks them
 * against other players at their position.
 *
 * players format:
 * [
 *   { playerId: "4046", position: "QB" },
 *   { playerId: "1234", position: "QB" }
 * ]
 *
 * Rankings are relative only to the supplied players.
 */
async function rankSleeperPlayers({
    players,
    leagueId
}) {
    if (!Array.isArray(players)) {
        throw new Error("Players must be an array.");
    }

    if (!leagueId) {
        throw new Error("Sleeper league ID is required.");
    }

    const evaluatedPlayers = [];
    const errors = [];

    // Process sequentially to avoid flooding Sleeper
    // with requests during initial testing.
    for (const player of players) {
        if (!player || !player.playerId) {
            continue;
        }

        const position = normalizePosition(player.position);

        if (!position) {
            errors.push({
                playerId: String(player.playerId),
                error: "Player position is missing."
            });
            continue;
        }

        try {
            const performance = await evaluateSleeperPlayer({
                playerId: String(player.playerId),
                position,
                leagueId: String(leagueId)
            });

            const weightedPointsPerGame =
                performance.weightedPointsPerGame;

            if (
                typeof weightedPointsPerGame !== "number" ||
                !Number.isFinite(weightedPointsPerGame)
            ) {
                errors.push({
                    playerId: String(player.playerId),
                    error: "No valid weighted points per game."
                });
                continue;
            }

            evaluatedPlayers.push({
                playerId: String(player.playerId),
                position,
                weightedPointsPerGame,

                // Performance history
                seasonsUsed: performance.seasonsUsed ?? 0,
                totalGamesPlayed: performance.totalGamesPlayed ?? 0,

                // Performance confidence
                confidenceScore: performance.confidenceScore ?? 0,
                confidenceLevel:
                    performance.confidenceLevel ?? "NO_DATA",

                // Recency confidence
                weightedGames: performance.weightedGames ?? 0,
                recencyScore: performance.recencyScore ?? 0,

                // Free Agency eligibility
                eligibleForFreeAgency:
                    performance.eligibleForFreeAgency ?? true,

                // Performance-history classification
                playerRole: performance.playerRole ?? "UNPROVEN",
                roleSource:
                    performance.roleSource ??
                    "FANTASY_PERFORMANCE_HISTORY",
                nflDepthChartRole:
                    performance.nflDepthChartRole ?? null,
                salaryAdjustment:
                    performance.salaryAdjustment ?? null
            });

        } catch (error) {
            errors.push({
                playerId: String(player.playerId),
                error: error.message
            });
        }
    }

    return {
        rankings: rankPlayersByPosition(evaluatedPlayers),
        evaluatedCount: evaluatedPlayers.length,
        skippedCount: errors.length,
        errors
    };
}

module.exports = {
    rankSleeperPlayers
};
