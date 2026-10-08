
"use strict";

const {
    MINIMUM_SALARY,
    calculatePositionMarket
} = require("./marketValueEngine");

const {
    normalizePosition,
    getPlayerPositionRanking
} = require("./positionRankingEngine");

/**
 * Initial salary adjustment curve.
 *
 * These are proposed fantasy-league tuning values,
 * not NFL salary rules.
 *
 * 0th percentile   = 60% of positional market
 * 50th percentile  = 100% of positional market
 * 100th percentile = 160% of positional market
 */
function getPerformanceMultiplier(percentile) {
    if (
        typeof percentile !== "number" ||
        !Number.isFinite(percentile) ||
        percentile < 0 ||
        percentile > 100
    ) {
        return null;
    }

    if (percentile <= 50) {
        return 0.60 + (percentile / 50) * 0.40;
    }

    return 1.00 + ((percentile - 50) / 50) * 0.60;
}

/**
 * Calculate one player's suggested annual salary.
 *
 * contracts: signed league contracts from Player List
 * rankings: results from rankPlayersByPosition()
 */
function calculateIndividualMarketValue({
    playerId,
    position,
    contracts,
    rankings

}) {
    if (!playerId) {
        throw new Error("Player ID is required.");
    }

    if (!Array.isArray(contracts)) {
        throw new Error("Contracts must be an array.");
    }

    if (!Array.isArray(rankings)) {
        throw new Error("Rankings must be an array.");
    }

    const normalizedPosition = normalizePosition(position);

    if (!normalizedPosition) {
        throw new Error("Position is required.");
    }

    // Match signed contracts to the same position groups
    // used by the performance ranking engine.

const normalizedContracts = contracts.filter(Boolean).map(contract => {
    const contractYear = Number(contract.contractYear);

    const canAdjustForCapGrowth =
        Number.isInteger(contractYear) &&
        contractYear >= 2026 &&
        contractYear <= valuationYear;

    return {
        ...contract,
        position: normalizePosition(contract.position),
        aav: canAdjustForCapGrowth
            ? adjustSalaryForCapGrowth(
                Number(contract.aav),
                contractYear,
                valuationYear
            )
            : contract.aav
    };
});

    const positionMarket = calculatePositionMarket(
        normalizedContracts,
        normalizedPosition
    );

    const ranking = getPlayerPositionRanking(
        rankings,
        playerId
    );

    const validRanking =
        ranking &&
        ranking.position === normalizedPosition &&
        ranking.rankingStatus === "RANKED" &&
        ranking.percentile !== null;

    // Without a usable performance comparison, return
    // the positional median as a provisional estimate.
    const multiplier = validRanking
        ? getPerformanceMultiplier(ranking.percentile)
        : 1;

    const suggestedAAV = Math.max(
        MINIMUM_SALARY,
        Math.round(
            (positionMarket.marketValue * multiplier) / 100_000
        ) * 100_000
    );

    return {
        playerId: String(playerId),
        position: normalizedPosition,
        positionMarketValue: positionMarket.marketValue,
        suggestedAAV,
        minimumSalary: MINIMUM_SALARY,
        performancePercentile: validRanking
            ? ranking.percentile
            : null,
        performanceMultiplier: Number(multiplier.toFixed(3)),
        positionRank: validRanking ? ranking.rank : null,
        positionPlayerCount: validRanking
            ? ranking.positionPlayerCount
            : null,
        marketConfidence: positionMarket.confidence,
        marketSampleSize: positionMarket.sampleSize,
        valuationStatus:
            !validRanking || positionMarket.sampleSize === 0
                ? "PROVISIONAL"
                : "ESTIMATED",
        signed: false
    };
}

module.exports = {
    getPerformanceMultiplier,
    calculateIndividualMarketValue
};
