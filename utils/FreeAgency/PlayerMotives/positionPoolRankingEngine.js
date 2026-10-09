
"use strict";

const {
    buildPositionPoolWithPerformance
} = require("./positionPoolPerformanceEngine");

const {
    rankPlayersByPosition,
    getPlayerPositionRanking
} = require("./positionRankingEngine");

/**
 * Franchise Era — Position Pool Ranking Engine
 *
 * Rules:
 * - Every Sleeper player remains in the pool.
 * - Every player remains eligible for Free Agency.
 * - NO_DATA counts as evaluated.
 * - NOT_EVALUATED does not count as evaluated.
 * - Failed evaluations prevent full-pool completion.
 * - Negative fantasy PPG is valid for rankings.
 * - Salary calculations are not performed here.
 */

async function buildPositionPoolWithRankings({
    position,
    leagueId,
    playerIds = []
}) {
    const pool = await buildPositionPoolWithPerformance({
        position,
        leagueId,
        playerIds
    });

    // A player is evaluated if the performance engine
    // successfully returned a result, including NO_DATA.
    const successfullyEvaluatedCount =
        pool.evaluatedCount;

    const notEvaluatedCount = pool.players.filter(
        player =>
            player.performanceStatus === "NOT_EVALUATED"
    ).length;

    // Full coverage requires every player in the
    // positional pool to have an evaluation result.
    const fullPositionEvaluated =
        pool.totalPlayers > 0 &&
        successfullyEvaluatedCount === pool.totalPlayers &&
        notEvaluatedCount === 0 &&
        pool.errorCount === 0;

    const rankingScope = fullPositionEvaluated
        ? "FULL_POSITION_POOL"
        : "EVALUATED_SAMPLE";

    // Only players with finite fantasy PPG receive
    // numerical performance rankings.
    const rankablePlayers = pool.players.filter(
        player =>
            player.performanceStatus !== "NOT_EVALUATED" &&
            typeof player.weightedPointsPerGame === "number" &&
            Number.isFinite(player.weightedPointsPerGame)
    );

    const rankings = rankPlayersByPosition(
        rankablePlayers
    ).map(ranking => ({
    ...ranking,
    rankingScope
    }));

    const players = pool.players.map(player => {
        const ranking = getPlayerPositionRanking(
            rankings,
            player.playerId
        );

        return {
            ...player,

            positionRank: ranking?.rank ?? null,

            positionPlayerCount:
                ranking?.positionPlayerCount ?? null,

            performancePercentile:
                ranking?.percentile ?? null,

            rankingStatus:
                ranking?.rankingStatus ??
                (
                    player.performanceStatus === "NOT_EVALUATED"
                        ? "NOT_EVALUATED"
                        : "NO_RANKABLE_DATA"
                ),

            rankingScope,

            eligibleForFreeAgency: true
        };
    });

    return {
        position: pool.position,

        totalPlayers: pool.totalPlayers,
        requestedCount: pool.requestedCount,

        evaluatedCount: successfullyEvaluatedCount,
        notEvaluatedCount,

        rankableCount: rankablePlayers.length,
        unrankedCount:
            pool.totalPlayers - rankablePlayers.length,

        fullPositionEvaluated,
        rankingScope,

        errorCount: pool.errorCount,
        errors: pool.errors,

        rankings,
        players
    };
}

module.exports = {
    buildPositionPoolWithRankings
};
