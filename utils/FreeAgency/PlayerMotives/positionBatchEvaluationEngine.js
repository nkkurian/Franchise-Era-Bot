
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
    buildPositionPlayerPool
} = require("./positionPlayerPoolEngine");

const {
    evaluateSleeperPlayer
} = require("./playerValuationEngine");

const {
    getLeagueScoringSettings
} = require("./sleeperPerformanceFetcher");

const CHECKPOINT_DIRECTORY = path.join(
    __dirname,
    "evaluationCheckpoints"
);

function getScoringSettingsKey(scoringSettings) {
    if (
        !scoringSettings ||
        typeof scoringSettings !== "object" ||
        Array.isArray(scoringSettings)
    ) {
        throw new Error("Valid scoring settings are required.");
    }

    const sortedSettings = Object.fromEntries(
        Object.entries(scoringSettings).sort(
            ([a], [b]) => a.localeCompare(b)
        )
    );

    return crypto
        .createHash("sha256")
        .update(JSON.stringify(sortedSettings))
        .digest("hex");
}

function getPlayerPoolKey(players) {
    if (!Array.isArray(players)) {
        throw new Error("Players must be an array.");
    }

    const ids = players.map(player => {
        if (!player || player.playerId == null) {
            throw new Error(
                "Every player must have a Sleeper player ID."
            );
        }

        return String(player.playerId);
    });

    if (new Set(ids).size !== ids.length) {
        throw new Error("Duplicate player IDs in position pool.");
    }

    return crypto
        .createHash("sha256")
        .update(JSON.stringify(ids.sort()))
        .digest("hex");
}

function getEvaluationSeasonKey(completedSeasons) {
    if (!Array.isArray(completedSeasons)) {
        throw new Error("Completed seasons must be an array.");
    }

    const seasons = [...new Set(
        completedSeasons
            .map(Number)
            .filter(Number.isInteger)
    )]
        .sort((a, b) => b - a)
        .slice(0, 3);

    if (seasons.length === 0) {
        throw new Error("No completed NFL seasons available.");
    }

    return seasons.join("-");
}

function getCheckpointPath(position, leagueId) {
    if (!/^[a-z0-9]+$/i.test(String(position))) {
        throw new Error("Invalid position.");
    }

    if (!/^\d+$/.test(String(leagueId))) {
        throw new Error("Invalid league ID.");
    }

    return path.join(
        CHECKPOINT_DIRECTORY,
        `${String(leagueId)}_${String(position).toUpperCase()}.json`
    );
}

function loadEvaluationCheckpoint({
    position,
    leagueId,
    completedSeasons,
    scoringSettingsKey,
    playerPoolKey
}) {
    if (
        typeof scoringSettingsKey !== "string" ||
        !/^[a-f0-9]{64}$/.test(scoringSettingsKey)
    ) {
        throw new Error(
            "A valid scoring settings fingerprint is required."
        );
    }

    if (
        typeof playerPoolKey !== "string" ||
        !/^[a-f0-9]{64}$/.test(playerPoolKey)
    ) {
        throw new Error(
            "A valid player-pool fingerprint is required."
        );
    }

    const seasonKey = getEvaluationSeasonKey(completedSeasons);
    const checkpointPath = getCheckpointPath(position, leagueId);

    const freshCheckpoint = {
        position: String(position).toUpperCase(),
        leagueId: String(leagueId),
        seasonKey,
        scoringSettingsKey,
        playerPoolKey,
        evaluations: {}
    };

    if (!fs.existsSync(checkpointPath)) {
        return {
            checkpoint: freshCheckpoint,
            refreshed: false
        };
    }

    const saved = JSON.parse(
        fs.readFileSync(checkpointPath, "utf8")
    );

    if (
        saved.seasonKey !== seasonKey ||
        saved.leagueId !== String(leagueId) ||
        saved.position !== String(position).toUpperCase() ||
        saved.scoringSettingsKey !== scoringSettingsKey ||
        saved.playerPoolKey !== playerPoolKey
    ) {
        return {
            checkpoint: freshCheckpoint,
            refreshed: true
        };
    }

    return {
        checkpoint: {
            ...freshCheckpoint,
            evaluations:
                saved.evaluations &&
                typeof saved.evaluations === "object" &&
                !Array.isArray(saved.evaluations)
                    ? saved.evaluations
                    : {}
        },
        refreshed: false
    };
}

function saveEvaluationCheckpoint(checkpoint) {
    const checkpointPath = getCheckpointPath(
        checkpoint.position,
        checkpoint.leagueId
    );

    fs.mkdirSync(CHECKPOINT_DIRECTORY, {
        recursive: true
    });

    const temporaryPath = `${checkpointPath}.tmp`;

    fs.writeFileSync(
        temporaryPath,
        JSON.stringify(checkpoint, null, 2),
        "utf8"
    );

    fs.renameSync(temporaryPath, checkpointPath);

    return checkpointPath;
}

async function evaluatePositionBatch({
    position,
    leagueId,
    completedSeasons,
    batchSize = 5
}) {
    if (
        !Number.isInteger(batchSize) ||
        batchSize < 1 ||
        batchSize > 10
    ) {
        throw new Error("Batch size must be between 1 and 10.");
    }

    const scoringSettings = await getLeagueScoringSettings(
        String(leagueId)
    );

    const scoringSettingsKey = getScoringSettingsKey(
        scoringSettings
    );

    const pool = await buildPositionPlayerPool(position);

    const playerPoolKey = getPlayerPoolKey(pool.players);

    const { checkpoint, refreshed } =
        loadEvaluationCheckpoint({
            position: pool.position,
            leagueId,
            completedSeasons,
            scoringSettingsKey,
            playerPoolKey
        });

    const pendingPlayers = pool.players.filter(
        player => !Object.prototype.hasOwnProperty.call(
            checkpoint.evaluations,
            player.playerId
        )
    );

    const batch = pendingPlayers.slice(0, batchSize);

    const errors = [];
    let completedThisBatch = 0;

    for (const player of batch) {
        try {
            const result = await evaluateSleeperPlayer({
                playerId: player.playerId,
                position: player.sleeperPosition,
                leagueId: String(leagueId)
            });

            if (
                !["COMPLETE", "LIMITED_DATA", "NO_DATA"]
                    .includes(result.status)
            ) {
                throw new Error(
                    `Unexpected performance status: ${result.status}`
                );
            }

            checkpoint.evaluations[player.playerId] = {
                ...result,
                playerId: player.playerId,
                name: player.name,
                position: pool.position
            };

            saveEvaluationCheckpoint(checkpoint);

            completedThisBatch++;
        } catch (error) {
            errors.push({
                playerId: player.playerId,
                name: player.name,
                message: error.message
            });
        }
    }

    const completedCount = pool.players.filter(
        player => Object.prototype.hasOwnProperty.call(
            checkpoint.evaluations,
            player.playerId
        )
    ).length;

    return {
        position: pool.position,
        seasonKey: checkpoint.seasonKey,
        scoringSettingsKey: checkpoint.scoringSettingsKey,
        playerPoolKey: checkpoint.playerPoolKey,
        totalPlayers: pool.totalPlayers,
        completedCount,
        remainingCount: pool.totalPlayers - completedCount,
        completedThisBatch,
        errorCount: errors.length,
        errors,
        refreshed,

        // Salary multipliers remain disabled.
        fullPositionEvaluated: false,
        rankingScope: "EVALUATED_SAMPLE"
    };
}

module.exports = {
    getScoringSettingsKey,
    getPlayerPoolKey,
    getEvaluationSeasonKey,
    getCheckpointPath,
    loadEvaluationCheckpoint,
    saveEvaluationCheckpoint,
    evaluatePositionBatch
};
