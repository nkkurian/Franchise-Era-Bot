
"use strict";

/**
 * Measures how much recent playing time supports
 * a player's performance rating.
 *
 * This is a confidence measure, NOT a talent rating.
 * Players with limited data remain eligible.
 */

function evaluatePerformanceConfidence(totalGamesPlayed) {
    const games = Number(totalGamesPlayed);

    if (!Number.isInteger(games) || games < 0) {
        throw new Error("Total games played must be a non-negative integer.");
    }

    // 24 games is our initial reference point for
    // a substantial three-year performance sample.
    const referenceGames = 24;

    const confidenceScore = Math.min(
        100,
        Math.round((games / referenceGames) * 100)
    );

    let confidenceLevel;

    if (games === 0) {
        confidenceLevel = "NO_DATA";
    } else if (games < 8) {
        confidenceLevel = "LOW";
    } else if (games < 24) {
        confidenceLevel = "MODERATE";
    } else {
        confidenceLevel = "HIGH";
    }

    return {
        totalGamesPlayed: games,
        confidenceScore,
        confidenceLevel,
        eligibleForFreeAgency: true
    };
}

/**
 * Measure how recent a player's playing time is.
 *
 * Expects seasonResults from playerPerformanceEngine,
 * ordered newest to oldest.
 *
 * This measures playing-time recency, not player talent.
 */
function evaluateRecencyConfidence(seasonResults, latestCompletedYear) {
    if (!Array.isArray(seasonResults)) {
        throw new Error("Season results must be an array.");
    }

    const weights = [0.50, 0.30, 0.20];

    const orderedSeasons = [...seasonResults]
        .sort((a, b) => Number(b.year) - Number(a.year))
        .slice(0, 3);

    let weightedGames = 0;
    
    if (
    !Number.isInteger(latestCompletedYear) ||
    latestCompletedYear < 2000
) {
    throw new Error("Latest completed season year is required.");
}

    const newestYear = latestCompletedYear;

        orderedSeasons.forEach(season => {
            const games = Number(season.gamesPlayed);
            const year = Number(season.year);

            if (!Number.isInteger(games) || games < 0) {
                throw new Error("Games played must be a non-negative integer.");
            }

            if (!Number.isInteger(year)) {
                throw new Error("Season year must be an integer.");
            }

            const yearOffset = newestYear - year;

            if (yearOffset >= 0 && yearOffset < weights.length) {
                weightedGames += games * weights[yearOffset];
            }
        });


    // 8 weighted games represents a substantial
    // recent playing-time sample under this formula.
    const referenceWeightedGames = 8;

    const recencyScore = Math.min(
        100,
        Math.round(
            (weightedGames / referenceWeightedGames) * 100
        )
    );

    return {
        weightedGames: Number(weightedGames.toFixed(2)),
        recencyScore
    };
}

module.exports = {
    evaluatePerformanceConfidence,
    evaluateRecencyConfidence
};
