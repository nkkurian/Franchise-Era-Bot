
"use strict";

const MINIMUM_SALARY = 1_200_000;

function normalizeTeam(value) {
    return String(value ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function parseMoney(value) {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value !== "string") {
        return null;
    }

    const cleaned = value.trim().replace(/[$,\s]/g, "");
    const match = cleaned.match(/^(\d+(?:\.\d+)?)([MK])?$/i);

    if (!match) {
        return null;
    }

    const amount = Number(match[1]);
    const suffix = (match[2] || "").toUpperCase();

    const multiplier =
        suffix === "M" ? 1_000_000 :
        suffix === "K" ? 1_000 :
        1;

    const result = amount * multiplier;

    return Number.isFinite(result) ? result : null;
}

function positiveInteger(value) {
    const number = Number(value);

    return Number.isSafeInteger(number) && number > 0;
}

/**
 * Validates an existing Player List contract for inclusion
 * in league salary-market calculations.
 *
 * CONTRACT AUTHORITY:
 * Google Sheets "Player List" is the contract database.
 *
 * ROSTER AUTHORITY:
 * Sleeper confirms current fantasy roster membership only.
 * Sleeper cannot create, approve, or value contracts.
 *
 * TEAM MAPPING:
 * Sleeper_Settings maps Sleeper roster IDs to franchise names.
 *
 * A team assignment alone is not proof of an active contract.
 *
 * Expected input:
 * {
 *   contract: {
 *     playerId,
 *     team,
 *     position,
 *     contractLength,
 *     yearsRemaining,
 *     totalValue,
 *     aav
 *   },
 *   sleeperRosterPlayerIds: Set<string> | string[],
 *   rosterTeam: string
 * }
 *
 * This module performs no API calls or live writes.
 */
function validateSignedContract({
    contract,
    sleeperRosterPlayerIds,
    rosterTeam
} = {}) {
    const reasons = [];

    if (!contract || typeof contract !== "object") {
        return {
            valid: false,
            signed: false,
            reasons: ["MISSING_CONTRACT"],
            normalizedContract: null
        };
    }

    const playerId = String(contract.playerId ?? "").trim();
    const contractTeam = normalizeTeam(contract.team);
    const mappedTeam = normalizeTeam(rosterTeam);

    if (!playerId) {
        reasons.push("MISSING_PLAYER_ID");
    }

    // Player List Column A determines franchise assignment.
    if (!contractTeam || contractTeam === "free agent") {
        reasons.push("NOT_ASSIGNED_TO_FRANCHISE");
    }

    // Contract fields determine whether an active contract exists.
    if (!positiveInteger(contract.contractLength)) {
        reasons.push("INVALID_CONTRACT_LENGTH");
    }

    if (!positiveInteger(contract.yearsRemaining)) {
        reasons.push("EXPIRED_OR_INVALID_REMAINING_YEARS");
    }

    const length = Number(contract.contractLength);
    const remaining = Number(contract.yearsRemaining);

    if (
        Number.isSafeInteger(length) &&
        Number.isSafeInteger(remaining) &&
        remaining > length
    ) {
        reasons.push("REMAINING_YEARS_EXCEED_LENGTH");
    }

    const totalValue = parseMoney(contract.totalValue);
    const aav = parseMoney(contract.aav);

    if (totalValue === null || totalValue <= 0) {
        reasons.push("INVALID_TOTAL_VALUE");
    }

    if (aav === null || aav < MINIMUM_SALARY) {
        reasons.push("INVALID_AAV");
    }

    // Sleeper is used only for roster verification.
    const rosterIds =
        sleeperRosterPlayerIds instanceof Set
            ? new Set(
                [...sleeperRosterPlayerIds].map((id) =>
                    String(id).trim()
                )
            )
            : Array.isArray(sleeperRosterPlayerIds)
                ? new Set(
                    sleeperRosterPlayerIds.map((id) =>
                        String(id).trim()
                    )
                )
                : null;

    if (!rosterIds) {
        reasons.push("MISSING_ROSTER_EVIDENCE");
    } else if (playerId && !rosterIds.has(playerId)) {
        reasons.push("PLAYER_NOT_ON_SLEEPER_ROSTER");
    }

    // Sleeper_Settings provides the expected franchise name.
    if (!mappedTeam) {
        reasons.push("MISSING_TEAM_MAPPING");
    } else if (
        contractTeam &&
        contractTeam !== "free agent" &&
        contractTeam !== mappedTeam
    ) {
        reasons.push("TEAM_MISMATCH");
    }

    const valid = reasons.length === 0;

    return {
        valid,
        signed: valid,
        playerId,
        reasons,
        normalizedContract: valid
            ? {
                ...contract,
                playerId,
                totalValue,
                aav,
                contractLength: length,
                yearsRemaining: remaining
            }
            : null
    };
}

module.exports = {
    MINIMUM_SALARY,
    parseMoney,
    validateSignedContract
};
