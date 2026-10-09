
"use strict";

const {
    getSleeperPlayerDirectory
} = require("./sleeperPlayerDirectory");

const {
    normalizePosition
} = require("./positionRankingEngine");

/**
 * Franchise Era — Positional Player Pool Engine
 *
 * Builds a complete positional player pool from
 * the Sleeper NFL player directory.
 *
 * All listed players are included, regardless of:
 * - Sleeper active status
 * - NFL team affiliation
 * - Depth-chart position
 * - Years of experience
 * - Retirement status
 * - Recent fantasy production
 *
 * This engine does NOT:
 * - Calculate fantasy performance
 * - Assign performance percentiles
 * - Calculate salaries
 * - Change Free Agency eligibility
 */

/**
 * Return all Sleeper players at a requested position.
 *
 * @param {string} position
 * @returns {Promise<object>}
 */
async function buildPositionPlayerPool(position) {
    const normalizedPosition = normalizePosition(position);

    if (!normalizedPosition) {
        throw new Error("Position is required.");
    }

    const directory = await getSleeperPlayerDirectory();

    const players = Object.entries(directory)
        .filter(([playerId, player]) => {
            if (
                !playerId ||
                !player ||
                !player.position
            ) {
                return false;
            }

            return (
                normalizePosition(player.position) ===
                normalizedPosition
            );
        })
        .map(([playerId, player]) => ({
            playerId: String(playerId),

            name:
                player.full_name ||
                `${player.first_name || ""} ${player.last_name || ""}`.trim() ||
                "Unknown Player",

            position: normalizedPosition,
            sleeperPosition: player.position,

            nflTeam: player.team || null,
            sleeperActive: player.active ?? null,
            sleeperStatus: player.status ?? null,

            depthChartOrder:
                Number.isInteger(player.depth_chart_order)
                    ? player.depth_chart_order
                    : null,

            depthChartPosition:
                player.depth_chart_position || null,

            yearsExperience:
                Number.isInteger(player.years_exp)
                    ? player.years_exp
                    : null,

            eligibleForFreeAgency: true,

            // Performance is evaluated separately.
            performanceStatus: "NOT_EVALUATED",
            weightedPointsPerGame: null,
            performancePercentile: null,

            // No salary calculation occurs here.
            suggestedAAV: null,
            valuationStatus: "NOT_EVALUATED"
        }))
        .sort(
            (a, b) =>
                a.name.localeCompare(b.name) ||
                a.playerId.localeCompare(b.playerId)
        );

    return {
        position: normalizedPosition,
        totalPlayers: players.length,
        players
    };
}

module.exports = {
    buildPositionPlayerPool
};
