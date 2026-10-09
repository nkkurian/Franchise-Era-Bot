
"use strict";

const SEASON_WEIGHTS = [0.50, 0.30, 0.20];

/**
 * Calculate fantasy points from raw Sleeper stats using
 * the league's custom scoring settings.
 *
 * Works for offensive and IDP scoring categories.
 * Avoid passing pre-calculated "pts_*" fields as raw stats.
 */
function calculateLeaguePoints(stats, scoringSettings) {
    if (!stats || typeof stats !== "object") return null;
    if (!scoringSettings || typeof scoringSettings !== "object") {
        return null;
    }

    let total = 0;

    for (const [category, weight] of Object.entries(scoringSettings)) {
        const multiplier = Number(weight);

        if (!Number.isFinite(multiplier)) continue;

        const rawValue = stats[category];
        const amount = Number(rawValue ?? 0);

        if (!Number.isFinite(amount)) continue;

        total += amount * multiplier;
    }

    return Number(total.toFixed(2));
}

/**
 * Expected seasons: newest first.
 *
 * [
 *   { year: 2025, stats: {...}, gamesPlayed: 16 },
 *   { year: 2024, stats: {...}, gamesPlayed: 15 },
 *   { year: 2023, stats: {...}, gamesPlayed: 17 }
 * ]
 *
 * Only completed seasons should be supplied.
 */
function evaluatePlayerPerformance({
    playerId,
    position,
    seasons,
    scoringSettings
}) {
    if (!playerId) throw new Error("Player ID is required.");

    if (!Array.isArray(seasons)) {
        throw new Error("Seasons must be an array.");
    }

    const normalizedPosition = String(position || "")
        .trim()
        .toUpperCase();

    if (!normalizedPosition) {
        throw new Error("Position is required.");
    }

    if (!scoringSettings || typeof scoringSettings !== "object") {
        throw new Error("League scoring settings are required.");
    }

    const seenYears = new Set();

    const orderedSeasons = seasons
        .filter(s => s && Number.isInteger(Number(s.year)))
        .sort((a, b) => Number(b.year) - Number(a.year))
        .filter(s => {
            const year = Number(s.year);
            if (seenYears.has(year)) return false;
            seenYears.add(year);
            return true;
        })
        .slice(0, 3);

    let weightedPoints = 0;
    let weightedPPG = 0;
    let usedWeight = 0;
    let seasonsUsed = 0;
    let totalGamesPlayed = 0;
    const seasonResults = [];

    orderedSeasons.forEach((season, index) => {
        const gamesPlayed = Number(season.gamesPlayed);

        if (
            !season.stats ||
            typeof season.stats !== "object" ||
            !Number.isInteger(gamesPlayed) ||
            gamesPlayed <= 0
        ) {
            return;
        }

        const points = calculateLeaguePoints(
            season.stats,
            scoringSettings
        );

        if (points === null) return;

        const pointsPerGame = points / gamesPlayed;
        const weight = SEASON_WEIGHTS[index];

        weightedPoints += points * weight;
        weightedPPG += pointsPerGame * weight;
        usedWeight += weight;
        seasonsUsed++;
        totalGamesPlayed += gamesPlayed;

        seasonResults.push({
            year: Number(season.year),
            gamesPlayed,
            fantasyPoints: points,
            pointsPerGame: Number(pointsPerGame.toFixed(2)),
            weight
        });
    });

    if (seasonsUsed === 0) {
        return {
            playerId: String(playerId),
            position: normalizedPosition,
            status: "NO_DATA",
            seasonsUsed: 0,
            totalGamesPlayed: 0,
            weightedFantasyPoints: null,
            weightedPointsPerGame: null,
            seasonResults: []
        };
    }

    // Normalize available weights so missing seasons
    // aren't automatically treated as zero production.
    return {
        playerId: String(playerId),
        position: normalizedPosition,
        status: seasonsUsed === 3 ? "COMPLETE" : "LIMITED_DATA",
        seasonsUsed,
        totalGamesPlayed,
        weightedFantasyPoints: Number(
            (weightedPoints / usedWeight).toFixed(2)
        ),
        weightedPointsPerGame: Number(
            (weightedPPG / usedWeight).toFixed(2)
        ),
        seasonResults
    };
}

module.exports = {
    SEASON_WEIGHTS,
    calculateLeaguePoints,
    evaluatePlayerPerformance
};
