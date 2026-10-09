
"use strict";

const fs = require("fs");

const {
    buildPositionPlayerPool
} = require("./positionPlayerPoolEngine");

const {
    rankPlayersByPosition,
    getPlayerPositionRanking
} = require("./positionRankingEngine");

const {
    getCompletedSeasons,
    getLeagueScoringSettings
} = require("./sleeperPerformanceFetcher");

const {
    getCheckpointPath,
    getEvaluationSeasonKey,
    getScoringSettingsKey,
    getPlayerPoolKey
} = require("./positionBatchEvaluationEngine");

async function buildCheckpointPositionRankings({
    position,
    leagueId
}) {
    if (!leagueId) {
        throw new Error("League ID is required.");
    }

    const pool = await buildPositionPlayerPool(position);

    const checkpointPath = getCheckpointPath(
        pool.position,
        leagueId
    );

    if (!fs.existsSync(checkpointPath)) {
        throw new Error(
            "No evaluation checkpoint exists for this position."
        );
    }

    const checkpoint = JSON.parse(
        fs.readFileSync(checkpointPath, "utf8")
    );

    const completedSeasons = await getCompletedSeasons();

    const scoringSettings = await getLeagueScoringSettings(
        String(leagueId)
    );

    if (
        checkpoint.position !== pool.position ||
        checkpoint.leagueId !== String(leagueId) ||
        checkpoint.seasonKey !==
            getEvaluationSeasonKey(completedSeasons) ||
        checkpoint.scoringSettingsKey !==
            getScoringSettingsKey(scoringSettings) ||
        checkpoint.playerPoolKey !==
            getPlayerPoolKey(pool.players)
    ) {
        throw new Error(
            "Checkpoint is outdated or does not match the current position pool."
        );
    }

    const evaluations = checkpoint.evaluations;

    if (
        !evaluations ||
        typeof evaluations !== "object" ||
        Array.isArray(evaluations)
    ) {
        throw new Error(
            "Checkpoint evaluations are invalid."
        );
    }

    const poolIds = new Set(
        pool.players.map(player => String(player.playerId))
    );

    const savedIds = Object.keys(evaluations);

    if (
        savedIds.length !== pool.players.length ||
        savedIds.some(id => !poolIds.has(id))
    ) {
        throw new Error(
            "Checkpoint does not cover the complete position pool."
        );
    }

    const validStatuses = new Set([
        "COMPLETE",
        "LIMITED_DATA",
        "NO_DATA"
    ]);

    for (const player of pool.players) {
        const evaluation = evaluations[player.playerId];

        if (
            !evaluation ||
            String(evaluation.playerId) !==
                String(player.playerId) ||
            evaluation.position !== pool.position ||
            !validStatuses.has(evaluation.status)
        ) {
            throw new Error(
                `Invalid saved evaluation for ${player.playerId}.`
            );
        }

        if (
            evaluation.status !== "NO_DATA" &&
            (
                typeof evaluation.weightedPointsPerGame !==
                    "number" ||
                !Number.isFinite(
                    evaluation.weightedPointsPerGame
                )
            )
        ) {
            throw new Error(
                `Invalid fantasy PPG for ${player.playerId}.`
            );
        }

        if (
            evaluation.status === "NO_DATA" &&
            evaluation.weightedPointsPerGame != null
        ) {
            throw new Error(
                `NO_DATA player has unexpected PPG: ${player.playerId}.`
            );
        }
    }

    const playersWithPerformance = pool.players.map(
        player => {
            const evaluation = evaluations[player.playerId];

            return {
                ...player,

                performanceStatus: evaluation.status,

                weightedPointsPerGame:
                    evaluation.weightedPointsPerGame ?? null,

                weightedFantasyPoints:
                    evaluation.weightedFantasyPoints ?? null,

                totalGamesPlayed:
                    evaluation.totalGamesPlayed ?? 0,

                seasonsUsed:
                    evaluation.seasonsUsed ?? 0,

                confidenceScore:
                    evaluation.confidenceScore ?? null,

                confidenceLevel:
                    evaluation.confidenceLevel ?? null,

                weightedGames:
                    evaluation.weightedGames ?? null,

                recencyScore:
                    evaluation.recencyScore ?? null,

                playerRole:
                    evaluation.playerRole ?? null,

                roleSource:
                    evaluation.roleSource ?? null,

                seasonResults:
                    evaluation.seasonResults ?? [],

                eligibleForFreeAgency: true,

                // No salary calculations.
                suggestedAAV: null,
                valuationStatus: "NOT_EVALUATED"
            };
        }
    );

    const rankablePlayers = playersWithPerformance.filter(
        player =>
            typeof player.weightedPointsPerGame === "number" &&
            Number.isFinite(player.weightedPointsPerGame)
    );

    const rankings = rankPlayersByPosition(
        rankablePlayers
    ).map(ranking => ({
        ...ranking,

        // Deliberately locked until salary integration
        // has been separately reviewed and tested.
        rankingScope: "EVALUATED_SAMPLE"
    }));

    const players = playersWithPerformance.map(player => {
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
                "NO_RANKABLE_DATA",

            rankingScope: "EVALUATED_SAMPLE",

            eligibleForFreeAgency: true
        };
    });

    return {
        position: pool.position,
        totalPlayers: pool.totalPlayers,

        evaluatedCount: players.length,
        notEvaluatedCount: 0,

        rankableCount: rankablePlayers.length,
        unrankedCount:
            pool.totalPlayers - rankablePlayers.length,

        // Coverage is verified, but salary-related
        // full-position authorization remains locked.
        checkpointCoverageVerified: true,
        fullPositionEvaluated: false,
        rankingScope: "EVALUATED_SAMPLE",

        rankings,
        players
    };
}

module.exports = {
    buildCheckpointPositionRankings
};
