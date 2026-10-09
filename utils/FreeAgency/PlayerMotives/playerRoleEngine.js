
"use strict";

/**
 * Franchise Era — Player Role Engine
 *
 * Classifies players based on the number of games
 * with usable fantasy performance data.
 *
 * These categories describe performance history,
 * NOT actual NFL depth-chart roles.
 *
 * No salary adjustments are made here.
 * No Sleeper API calls are made here.
 */

const PLAYER_ROLES = Object.freeze({
    ESTABLISHED: "ESTABLISHED",
    DEVELOPING: "DEVELOPING",
    LIMITED_DATA: "LIMITED_DATA",
    UNPROVEN: "UNPROVEN"
});

/**
 * Determine a player's performance-history category.
 *
 * 24+ games = ESTABLISHED
 * 8–23 games = DEVELOPING
 * 1–7 games = LIMITED_DATA
 * 0 games = UNPROVEN
 *
 * @param {number} totalGamesPlayed
 * @returns {object}
 */
function classifyPlayerRole(totalGamesPlayed) {
    if (
        !Number.isInteger(totalGamesPlayed) ||
        totalGamesPlayed < 0
    ) {
        throw new Error(
            "Total games played must be a non-negative integer."
        );
    }

    let role;

    if (totalGamesPlayed >= 24) {
        role = PLAYER_ROLES.ESTABLISHED;
    } else if (totalGamesPlayed >= 8) {
        role = PLAYER_ROLES.DEVELOPING;
    } else if (totalGamesPlayed >= 1) {
        role = PLAYER_ROLES.LIMITED_DATA;
    } else {
        role = PLAYER_ROLES.UNPROVEN;
    }

    return {
        role,
        totalGamesPlayed,
        roleSource: "FANTASY_PERFORMANCE_HISTORY",
        nflDepthChartRole: null,
        salaryAdjustment: null
    };
}

module.exports = {
    PLAYER_ROLES,
    classifyPlayerRole
};
