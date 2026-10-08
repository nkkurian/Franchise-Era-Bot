
"use strict";

const axios = require("axios");

const BASE_URL = "https://api.sleeper.app/v1";
const CACHE_DURATION_MS = 60 * 60 * 1000;

const cache = new Map();

async function getCached(url) {
    const cached = cache.get(url);

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
        return cached.data;
    }

    const response = await axios.get(url, {
        timeout: 15000
    });

    cache.set(url, {
        timestamp: Date.now(),
        data: response.data
    });

    return response.data;
}

/**
 * Get the three most recent completed NFL seasons.
 *
 * Uses Sleeper's current season state.
 */
async function getCompletedSeasons() {
    const state = await getCached(`${BASE_URL}/state/nfl`);

    const currentSeason = Number(state.season);

    if (!Number.isInteger(currentSeason)) {
        throw new Error("Invalid NFL season returned by Sleeper.");
    }

    const latestCompletedSeason = currentSeason - 1;

    return [
        latestCompletedSeason,
        latestCompletedSeason - 1,
        latestCompletedSeason - 2
    ];
}

/**
 * Retrieve custom league scoring settings.
 */
async function getLeagueScoringSettings(leagueId) {
    if (!leagueId) {
        throw new Error("Sleeper league ID is required.");
    }

    const league = await getCached(
        `${BASE_URL}/league/${encodeURIComponent(leagueId)}`
    );

    if (!league || !league.scoring_settings) {
        throw new Error("League scoring settings unavailable.");
    }

    return league.scoring_settings;
}

/**
 * Fetch one player's stats across three completed seasons.
 *
 * Sleeper season stats are keyed by Sleeper player ID.
 *
 * gamesPlayed is only populated if a suitable games-played
 * statistic is available. Missing games are not invented.
 */
async function getThreeSeasonPlayerStats(playerId) {
    if (!playerId) {
        throw new Error("Sleeper player ID is required.");
    }

    const years = await getCompletedSeasons();

    const seasonData = await Promise.all(
        years.map(async (year) => {
            const allStats = await getCached(
                `${BASE_URL}/stats/nfl/regular/${year}`
            );

            const stats = allStats?.[String(playerId)] || null;

            const games = Number(
                stats?.gp ?? stats?.games_played ?? NaN
            );

            return {
                year,
                stats,
                gamesPlayed:
                    Number.isInteger(games) && games > 0
                        ? games
                        : null
            };
        })
    );

    return seasonData;
}

/**
 * Prepare the inputs needed by playerPerformanceEngine.
 */
async function getPlayerPerformanceInputs({
    playerId,
    position,
    leagueId
}) {
    if (!position) {
        throw new Error("Player position is required.");
    }

    const [seasons, scoringSettings] = await Promise.all([
        getThreeSeasonPlayerStats(playerId),
        getLeagueScoringSettings(leagueId)
    ]);

    return {
        playerId: String(playerId),
        position: String(position).toUpperCase(),
        seasons,
        scoringSettings
    };
}

module.exports = {
    getCompletedSeasons,
    getLeagueScoringSettings,
    getThreeSeasonPlayerStats,
    getPlayerPerformanceInputs
};
