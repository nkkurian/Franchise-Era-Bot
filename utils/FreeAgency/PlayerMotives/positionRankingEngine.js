
"use strict";

/**
 * Group equivalent defensive positions together.
 *
 * Offensive positions remain separate.
 */
const POSITION_GROUPS = {
    QB: "QB",
    RB: "RB",
    WR: "WR",
    TE: "TE",
    K: "K",

    DL: "DL",
    DE: "DL",
    DT: "DL",
    NT: "DL",
    EDGE: "DL",

    LB: "LB",
    ILB: "LB",
    OLB: "LB",
    MLB: "LB",

    DB: "DB",
    CB: "DB",
    S: "DB",
    FS: "DB",
    SS: "DB"
};

function normalizePosition(position) {
    const key = String(position || "").trim().toUpperCase();
    return POSITION_GROUPS[key] || key;
}

/**
 * Rank players within their position group.
 *
 * Expected player format:
 *
 * {
 *   playerId: "4046",
 *   position: "QB",
 *   weightedPointsPerGame: 19.79,
 *   seasonsUsed: 3
 * }
 *
 * Higher PPG means better performance.
 *
 * Players with missing performance data are excluded
 * from the rankings, not treated as zero-point players.
 */
function rankPlayersByPosition(players) {
    if (!Array.isArray(players)) {
        throw new Error("Players must be an array.");
    }

    const groups = new Map();

    for (const player of players) {
        if (!player || !player.playerId) continue;

        const position = normalizePosition(player.position);
        const ppg = player.weightedPointsPerGame;

        if (
            !position ||
            typeof ppg !== "number" ||
            !Number.isFinite(ppg) ||
            ppg < 0
        ) {
            continue;
        }

        if (!groups.has(position)) {
            groups.set(position, []);
        }

        groups.get(position).push({
            playerId: String(player.playerId),
            position,
            weightedPointsPerGame: ppg,
            seasonsUsed: player.seasonsUsed ?? 0
        });
    }

    const results = [];

    for (const [position, group] of groups.entries()) {
        group.sort(
            (a, b) =>
                b.weightedPointsPerGame - a.weightedPointsPerGame ||
                a.playerId.localeCompare(b.playerId)
        );

        const totalPlayers = group.length;

        group.forEach((player, index) => {
            const rank = index + 1;

            // Highest performer receives percentile 100.
            // Lowest performer receives percentile 0.
            // A single-player group is not enough for
            // a meaningful comparison.
            const percentile =
                totalPlayers === 1
                    ? null
                    : Number(
                        (
                            ((totalPlayers - rank) /
                                (totalPlayers - 1)) *
                            100
                        ).toFixed(2)
                    );

            results.push({
                ...player,
                rank,
                positionPlayerCount: totalPlayers,
                percentile,
                rankingStatus:
                    totalPlayers === 1
                        ? "INSUFFICIENT_PEERS"
                        : "RANKED"
            });
        });
    }

    return results.sort(
        (a, b) =>
            a.position.localeCompare(b.position) ||
            a.rank - b.rank
    );
}

/**
 * Find one player's position ranking.
 */
function getPlayerPositionRanking(rankings, playerId) {
    if (!Array.isArray(rankings)) {
        throw new Error("Rankings must be an array.");
    }

    return (
        rankings.find(
            player => player.playerId === String(playerId)
        ) || null
    );
}

module.exports = {
    POSITION_GROUPS,
    normalizePosition,
    rankPlayersByPosition,
    getPlayerPositionRanking
};
