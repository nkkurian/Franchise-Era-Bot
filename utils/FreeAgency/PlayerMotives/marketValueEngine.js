
"use strict";

const {
    validateSignedContract
} = require("./signedContractValidator");

const MINIMUM_SALARY = 1_200_000;

function parseSalary(value) {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : NaN;
    }

    if (typeof value !== "string") return NaN;

    const cleaned = value
        .trim()
        .toUpperCase()
        .replace(/[$,\s]/g, "");

    if (!cleaned || cleaned.startsWith("#")) return NaN;

    const match = cleaned.match(/^(\d+(?:\.\d+)?)([MK])?$/);

    if (!match) return NaN;

    const amount = Number(match[1]);
    const multiplier =
        match[2] === "M" ? 1_000_000 :
        match[2] === "K" ? 1_000 : 1;

    return amount * multiplier;
}

function median(values) {
    if (!values.length) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 1
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function getConfidence(sampleSize) {
    if (sampleSize >= 10) return "HIGH";
    if (sampleSize >= 5) return "MEDIUM";
    if (sampleSize >= 1) return "LOW";
    return "NO_DATA";
}

/**
 * Calculate a position's salary market using only contracts
 * verified against Player List and Sleeper roster evidence.
 *
 * Expected verificationEvidence:
 * {
 *   rosterMembershipByPlayerId: {
 *     "12345": {
 *       sleeperRosterPlayerIds: ["12345", ...],
 *       rosterTeam: "Dallas Cowboys"
 *     }
 *   }
 * }
 *
 * A caller cannot bypass validation by setting signed: true.
 * Missing verification evidence excludes the contract.
 *
 * No API calls or live writes occur here.
 */
function calculatePositionMarket(
    players,
    position,
    verificationEvidence = {}
) {
    if (!Array.isArray(players)) {
        throw new Error("Players must be an array.");
    }

    const normalizedPosition = String(position || "")
        .trim()
        .toUpperCase();

    if (!normalizedPosition) {
        throw new Error("Position is required.");
    }

    const evidence =
        verificationEvidence &&
        typeof verificationEvidence === "object"
            ? verificationEvidence.rosterMembershipByPlayerId
            : null;

    const contracts = [];
    const rejectedContracts = [];

    for (const player of players) {
        if (!player) continue;

        const playerPosition = String(player.position || "")
            .trim()
            .toUpperCase();

        if (playerPosition !== normalizedPosition) continue;

        const playerId = String(player.playerId ?? "").trim();

        const rosterEvidence =
            evidence &&
            typeof evidence === "object" &&
            Object.prototype.hasOwnProperty.call(evidence, playerId)
                ? evidence[playerId]
                : null;

        const result = validateSignedContract({
            contract: player,
            sleeperRosterPlayerIds:
                rosterEvidence?.sleeperRosterPlayerIds,
            rosterTeam: rosterEvidence?.rosterTeam
        });

        if (!result.valid) {
            rejectedContracts.push({
                playerId: playerId || null,
                reasons: result.reasons
            });
            continue;
        }

        contracts.push(
            parseSalary(result.normalizedContract.aav)
        );
    }

    const sampleSize = contracts.length;

    const common = {
        position: normalizedPosition,
        minimumSalary: MINIMUM_SALARY,
        sampleSize,
        rejectedContractCount: rejectedContracts.length,
        rejectedContracts
    };

    if (sampleSize === 0) {
        return {
            ...common,
            marketValue: MINIMUM_SALARY,
            confidence: "NO_DATA",
            lowestContract: null,
            highestContract: null,
            source: "LEAGUE_MINIMUM_FALLBACK"
        };
    }

    return {
        ...common,
        marketValue: Math.max(
            MINIMUM_SALARY,
            median(contracts)
        ),
        confidence: getConfidence(sampleSize),
        lowestContract: Math.min(...contracts),
        highestContract: Math.max(...contracts),
        source: "VERIFIED_SIGNED_LEAGUE_CONTRACTS"
    };
}

function calculateAllPositionMarkets(
    players,
    verificationEvidence = {}
) {
    if (!Array.isArray(players)) {
        throw new Error("Players must be an array.");
    }

    const positions = [
        ...new Set(
            players
                .filter(Boolean)
                .map((player) =>
                    String(player.position || "")
                        .trim()
                        .toUpperCase()
                )
                .filter(Boolean)
        )
    ];

    const markets = {};

    for (const position of positions) {
        markets[position] = calculatePositionMarket(
            players,
            position,
            verificationEvidence
        );
    }

    return markets;
}

module.exports = {
    MINIMUM_SALARY,
    parseSalary,
    calculatePositionMarket,
    calculateAllPositionMarkets
};
