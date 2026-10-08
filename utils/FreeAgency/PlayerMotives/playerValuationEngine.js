
"use strict";

const {
    getPlayerPerformanceInputs
} = require("./sleeperPerformanceFetcher");

const {
    evaluatePlayerPerformance
} = require("./playerPerformanceEngine");

/**
 * Retrieve a player's real Sleeper statistics and calculate
 * their three-year performance using league scoring.
 *
 * This is the first stage of individual player valuation.
 * It does not assign a dollar value yet.
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

    return evaluatePlayerPerformance(inputs);
}

module.exports = {
    evaluateSleeperPlayer
};
