
"use strict";

const {
    getCompletedSeasons
} = require("./sleeperPerformanceFetcher");

const {
    evaluatePositionBatch
} = require("./positionBatchEvaluationEngine");

function wait(milliseconds) {
    return new Promise(resolve => {
        setTimeout(resolve, milliseconds);
    });
}

async function runPositionBatches({
    position,
    leagueId,
    batchSize = 10,
    maxBatches = 1,
    delayMs = 1500
}) {
    if (
        !Number.isInteger(maxBatches) ||
        maxBatches < 1 ||
        maxBatches > 100
    ) {
        throw new Error(
            "Maximum batches must be between 1 and 100."
        );
    }

    if (
        !Number.isInteger(delayMs) ||
        delayMs < 0
    ) {
        throw new Error(
            "Delay must be a nonnegative integer."
        );
    }

    const completedSeasons = await getCompletedSeasons();

    let lastResult = null;
    let batchesRun = 0;
    let totalCompletedThisRun = 0;

    for (let batchNumber = 1; batchNumber <= maxBatches; batchNumber++) {
        console.log(
            `Starting batch ${batchNumber} of ${maxBatches}...`
        );

        const result = await evaluatePositionBatch({
            position,
            leagueId,
            completedSeasons,
            batchSize
        });

        lastResult = result;
        batchesRun++;
        totalCompletedThisRun += result.completedThisBatch;

        console.log(
            `Batch ${batchNumber}: ` +
            `${result.completedThisBatch} completed, ` +
            `${result.remainingCount} remaining, ` +
            `${result.errorCount} errors.`
        );

        if (result.errorCount > 0) {
            console.log(
                "Stopping because an evaluation failed."
            );
            break;
        }

        if (result.remainingCount === 0) {
            console.log(
                "All players have been evaluated."
            );
            break;
        }

        if (result.completedThisBatch === 0) {
            console.log(
                "Stopping because no progress was made."
            );
            break;
        }

        if (batchNumber < maxBatches) {
            await wait(delayMs);
        }
    }

    return {
        position: lastResult?.position || position,
        batchesRun,
        totalCompletedThisRun,
        completedCount: lastResult?.completedCount ?? 0,
        remainingCount: lastResult?.remainingCount ?? null,
        errorCount: lastResult?.errorCount ?? 0,

        // Do not unlock salary multipliers.
        fullPositionEvaluated: false,
        rankingScope: "EVALUATED_SAMPLE"
    };
}

module.exports = {
    runPositionBatches
};
