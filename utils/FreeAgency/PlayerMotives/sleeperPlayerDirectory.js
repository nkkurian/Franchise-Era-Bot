
"use strict";

const axios = require("axios");

const SLEEPER_PLAYERS_URL =
    "https://api.sleeper.app/v1/players/nfl";

const {
    normalizePosition
} = require("./positionRankingEngine");

// Cache the directory to avoid repeated large downloads.
let cachedPlayers = null;

async function getSleeperPlayerDirectory() {
    if (cachedPlayers) {
        return cachedPlayers;
    }

    const response = await axios.get(SLEEPER_PLAYERS_URL);

    if (!response.data || typeof response.data !== "object") {
        throw new Error("Invalid Sleeper player directory response.");
    }

    cachedPlayers = response.data;
    return cachedPlayers;
}

/**
 * Returns real Sleeper player IDs for a position group.
 *
 * Example: getSleeperPlayersByPosition("QB", 10)
 */
async function getSleeperPlayersByPosition(
    position,
    limit = 10
) {
    const targetPosition = normalizePosition(position);

    if (!targetPosition) {
        throw new Error("Position is required.");
    }

    if (!Number.isInteger(limit) || limit < 1) {
        throw new Error("Limit must be a positive integer.");
    }

    const directory = await getSleeperPlayerDirectory();

    const players = Object.entries(directory)
        .filter(([playerId, player]) => {
            if (!player || !player.position) return false;

            const playerPosition =
                normalizePosition(player.position);

            return (
                playerPosition === targetPosition &&
                player.active === true
            );
        })
        .map(([playerId, player]) => ({
            playerId: String(playerId),
            name: player.full_name ||
                `${player.first_name || ""} ${player.last_name || ""}`.trim(),
            position: normalizePosition(player.position),
            nflTeam: player.team || "FA"
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return players.slice(0, limit);
}

module.exports = {
    getSleeperPlayerDirectory,
    getSleeperPlayersByPosition
};
