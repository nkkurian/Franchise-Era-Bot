
"use strict";

const {
    MINIMUM_SALARY,
    calculatePositionMarket
} = require("./marketValueEngine");

const {
    normalizePosition
} = require("./positionRankingEngine");

// Minimum valid signed contracts required before
// performance adjustments can be considered.
const MINIMUM_MARKET_CONTRACTS = 5;

/**
 * Proposed performance adjustment curve.
 *
 * Retained for future use.
 * Currently NOT applied to salaries.
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
 * Calculate a provisional annual salary.
 *
 * Signed contracts establish the positional market.
 *
 * Rankings cannot currently activate performance
 * adjustments, regardless of their supplied scope.
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

    const normalizedContracts = contracts
        .filter(Boolean)
        .map(contract => ({
            ...contract,
            position: normalizePosition(contract.position)
        }));

    const positionMarket = calculatePositionMarket(
        normalizedContracts,
        normalizedPosition
    );

    // Contract-baseline eligibility is informational.
    // It does NOT authorize a salary adjustment.
    const contractBaselineEligible =
        positionMarket.sampleSize >=
        MINIMUM_MARKET_CONTRACTS;

    // SECURITY LOCK:
    // Caller-provided rankings cannot authorize
    // performance-based salary adjustments.
    const performanceMultiplier = 1;

    const suggestedAAV = Math.max(
        MINIMUM_SALARY,
        Math.round(
            (
                positionMarket.marketValue *
                performanceMultiplier
            ) / 100_000
        ) * 100_000
    );

    return {
        playerId: String(playerId),
        position: normalizedPosition,

        positionMarketValue:
            positionMarket.marketValue,

        suggestedAAV,
        minimumSalary: MINIMUM_SALARY,

        performancePercentile: null,
        performanceMultiplier,

        positionRank: null,
        positionPlayerCount: null,

        marketConfidence:
            positionMarket.confidence,

        marketSampleSize:
            positionMarket.sampleSize,

        minimumMarketContracts:
            MINIMUM_MARKET_CONTRACTS,

        contractBaselineEligible,

        valuationStatus: "PROVISIONAL",

        performanceAdjustmentAuthorized: false,

        signed: false
    };
}

module.exports = {
    MINIMUM_MARKET_CONTRACTS,
    getPerformanceMultiplier,
    calculateIndividualMarketValue
};
