"use strict";

const MOTIVES = [
  "money",
  "winning",
  "role",
  "security",
  "loyalty",
  "ego",
];

const clamp = (value, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

function requireNumber(value, name, min = 0, max = Infinity) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`Invalid ${name}.`);
  }

  return value;
}

/**
 * Contract format:
 *
 * {
 *   years: 3,
 *   totalValue: 60,
 *   guaranteedMoney: 35,
 *   signingBonus: 12,
 *   incentives: [
 *     {
 *       id: "250-points",
 *       description: "Score 250 fantasy points",
 *       amount: 3,
 *       probability: 0.65
 *     }
 *   ]
 * }
 *
 * Money is measured in millions.
 *
 * totalValue includes base salaries, signing bonus,
 * and maximum available incentives.
 *
 * guaranteedMoney includes the signing bonus.
 *
 * Earned incentives are charged to the following
 * season's cap by a separate future ledger system.
 */

function validateContract(offer) {
  if (!offer || typeof offer !== "object") {
    throw new Error("Contract offer is required.");
  }

  const {
    years,
    totalValue,
    guaranteedMoney,
    signingBonus,
    incentives = [],
  } = offer;

  requireNumber(years, "contract length", 1, 10);

  if (!Number.isInteger(years)) {
    throw new Error("Contract length must be a whole number.");
  }

  requireNumber(totalValue, "total value", 0);
  requireNumber(guaranteedMoney, "guaranteed money", 0);
  requireNumber(signingBonus, "signing bonus", 0);

  if (!Array.isArray(incentives)) {
    throw new Error("Incentives must be an array.");
  }

  const incentiveIds = new Set();
  let maximumIncentives = 0;
  let expectedIncentives = 0;

  for (const incentive of incentives) {
    if (
      !incentive ||
      typeof incentive.id !== "string" ||
      !incentive.id.trim() ||
      typeof incentive.description !== "string" ||
      !incentive.description.trim()
    ) {
      throw new Error("Each incentive needs an ID and description.");
    }

    if (incentiveIds.has(incentive.id)) {
      throw new Error(`Duplicate incentive: ${incentive.id}`);
    }

    incentiveIds.add(incentive.id);

    requireNumber(incentive.amount, "incentive amount", 0);
    requireNumber(
      incentive.probability,
      "incentive probability",
      0,
      1
    );

    maximumIncentives += incentive.amount;
    expectedIncentives +=
      incentive.amount * incentive.probability;
  }

  if (guaranteedMoney > totalValue) {
    throw new Error("Guarantees cannot exceed total value.");
  }

  if (signingBonus > guaranteedMoney) {
    throw new Error(
      "Signing bonus must be included in guaranteed money."
    );
  }

  if (maximumIncentives > totalValue) {
    throw new Error(
      "Incentives cannot exceed total contract value."
    );
  }

  const nonIncentiveValue = totalValue - maximumIncentives;

  if (guaranteedMoney > nonIncentiveValue + 1e-9) {
    throw new Error(
      "Guaranteed money cannot include contingent incentives."
    );
  }

  return {
    years,
    totalValue,
    guaranteedMoney,
    signingBonus,
    maximumIncentives,
    expectedIncentives,
    nonIncentiveValue,
    averageAnnualValue: totalValue / years,
    expectedAnnualValue:
      (nonIncentiveValue + expectedIncentives) / years,
  };
}

/**
 * Context values:
 *
 * marketValue: annual market salary in millions
 * teamWinning: 0-1
 * projectedRole: 0-1
 * loyaltyFit: 0-1
 * prestige: 0-1
 *
 * probability is an internal estimate, not a
 * guarantee that an incentive will be earned.
 */

function evaluateContractOffer({ player, offer, context }) {
  if (!player || !context) {
    throw new Error("Player and context are required.");
  }

  for (const motive of MOTIVES) {
    const rating = player[motive];

    if (
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      throw new Error(`Invalid motive: ${motive}`);
    }
  }

  const contract = validateContract(offer);

  requireNumber(context.marketValue, "market value", 0.000001);

  for (const field of [
    "teamWinning",
    "projectedRole",
    "loyaltyFit",
    "prestige",
  ]) {
    requireNumber(context[field], field, 0, 1);
  }

  const marketValue = context.marketValue;
  const expectedAAV = contract.expectedAnnualValue;

  const guaranteeRatio =
    contract.nonIncentiveValue === 0
      ? 0
      : contract.guaranteedMoney /
        contract.nonIncentiveValue;

  const bonusRatio =
    contract.nonIncentiveValue === 0
      ? 0
      : contract.signingBonus /
        contract.nonIncentiveValue;

  const incentiveRatio =
    contract.totalValue === 0
      ? 0
      : contract.expectedIncentives /
        contract.totalValue;

  // Contract length preference is personality-dependent.
  const prefersShortDeal =
    player.archetype === "Bet-on-Myself";

  const lengthFit = prefersShortDeal
    ? clamp(1 - (contract.years - 1) * 0.18)
    : clamp(contract.years / 4);

  const satisfaction = {
    money: clamp(expectedAAV / (marketValue * 1.25)),

    winning: context.teamWinning,

    role: context.projectedRole,

    security: clamp(
      guaranteeRatio * 0.65 +
      lengthFit * 0.35
    ),

    loyalty: context.loyaltyFit,

    ego: clamp(
      (contract.averageAnnualValue / marketValue) * 0.45 +
      context.prestige * 0.35 +
      bonusRatio * 0.15 +
      incentiveRatio * 0.05
    ),
  };

  let weightedTotal = 0;
  let totalWeight = 0;

  for (const motive of MOTIVES) {
    weightedTotal +=
      satisfaction[motive] * player[motive];

    totalWeight += player[motive];
  }

  const score = weightedTotal / totalWeight;

  let interest;

  if (score >= 0.78) {
    interest = "STRONG_INTEREST";
  } else if (score >= 0.63) {
    interest = "INTERESTED";
  } else if (score >= 0.46) {
    interest = "NEGOTIATION_NEEDED";
  } else {
    interest = "UNINTERESTED";
  }

  return Object.freeze({
    interest,
    score: Number(score.toFixed(4)),
    expectedAnnualValue: Number(
      expectedAAV.toFixed(4)
    ),
    guaranteedPercentage: Number(
      (guaranteeRatio * 100).toFixed(2)
    ),
    maximumIncentives: Number(
      contract.maximumIncentives.toFixed(4)
    ),
    expectedIncentives: Number(
      contract.expectedIncentives.toFixed(4)
    ),
  });
}

/**
 * Review competing bids only after bidding closes.
 *
 * This function ranks offers but does NOT sign anyone.
 * Commissioner approval is still required.
 *
 * Each bid:
 * {
 *   bidId,
 *   teamId,
 *   offer,
 *   context
 * }
 */

function reviewFinalOffers({ player, bids, biddingClosed }) {
  if (biddingClosed !== true) {
    throw new Error(
      "Final review cannot begin before bidding closes."
    );
  }

  if (!Array.isArray(bids) || bids.length === 0) {
    throw new Error("At least one bid is required.");
  }

  const seenTeams = new Set();
  const seenBids = new Set();

  const rankings = bids.map((bid) => {
    if (
      !bid ||
      typeof bid.bidId !== "string" ||
      !bid.bidId.trim() ||
      typeof bid.teamId !== "string" ||
      !bid.teamId.trim()
    ) {
      throw new Error(
        "Every bid requires a bidId and teamId."
      );
    }

    if (seenBids.has(bid.bidId)) {
      throw new Error("Duplicate bid ID.");
    }

    if (seenTeams.has(bid.teamId)) {
      throw new Error(
        "Submit only one final active bid per team."
      );
    }

    seenBids.add(bid.bidId);
    seenTeams.add(bid.teamId);

    const evaluation = evaluateContractOffer({
      player,
      offer: bid.offer,
      context: bid.context,
    });

    return {
      bidId: bid.bidId,
      teamId: bid.teamId,
      interest: evaluation.interest,
      score: evaluation.score,
    };
  });

  rankings.sort(
    (a, b) =>
      b.score - a.score ||
      a.bidId.localeCompare(b.bidId)
  );

  return Object.freeze({
    status: "PENDING_COMMISSIONER_REVIEW",
    rankings,
    recommendedBidId: rankings[0].bidId,
    signed: false,
  });
}

module.exports = {
  validateContract,
  evaluateContractOffer,
  reviewFinalOffers,
};