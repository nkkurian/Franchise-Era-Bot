
"use strict";

const {
  evaluateContractOffer,
  validateContract,
} = require("./contractDecisionEngine");

const roundMoney = (value) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, value));

/**
 * Generates a private, nonbinding counteroffer.
 *
 * All money values use the same units as the
 * Contract Decision Engine (millions).
 *
 * This function does not:
 * - submit or save an offer
 * - notify a GM
 * - promise a signing
 * - modify existing contracts
 */
function generateCounteroffer({ player, offer, context }) {
  const evaluation = evaluateContractOffer({
    player,
    offer,
    context,
  });

  const contract = validateContract(offer);

  // Strong offers don't automatically require a counter.
  if (evaluation.interest === "STRONG_INTEREST") {
    return Object.freeze({
      status: "HOLD_FOR_FINAL_REVIEW",
      message:
        "Your offer is very competitive. The player will " +
        "consider it during final review.",
      proposedOffer: null,
      binding: false,
    });
  }

  const priorities = [
    { motive: "money", score: player.money },
    { motive: "security", score: player.security },
    { motive: "ego", score: player.ego },
    { motive: "role", score: player.role },
    { motive: "winning", score: player.winning },
    { motive: "loyalty", score: player.loyalty },
  ].sort((a, b) => b.score - a.score);

  const primaryMotive = priorities[0].motive;

  let years = offer.years;
  let totalValue = offer.totalValue;
  let guaranteedMoney = offer.guaranteedMoney;
  let signingBonus = offer.signingBonus;

  const incentiveTotal = contract.maximumIncentives;

  let explanation;

  switch (primaryMotive) {
    case "money":
      totalValue = roundMoney(totalValue * 1.12);
      explanation =
        "The player wants stronger overall compensation.";
      break;

    case "security": {
      years = Math.min(years + 1, 10);

      const guaranteedTarget = roundMoney(
        Math.max(
          guaranteedMoney * 1.15,
          (totalValue - incentiveTotal) * 0.7
        )
      );

      guaranteedMoney = guaranteedTarget;

      explanation =
        "The player wants greater long-term security " +
        "and more guaranteed money.";
      break;
    }

    case "ego":
      signingBonus = roundMoney(signingBonus * 1.25);
      guaranteedMoney = Math.max(
        guaranteedMoney,
        signingBonus
      );

      explanation =
        "The player wants a larger signing bonus " +
        "as a sign of commitment.";
      break;

    case "role":
      totalValue = roundMoney(totalValue * 1.08);
      explanation =
        "The player wants compensation reflecting " +
        "a featured role.";
      break;

    case "winning":
      guaranteedMoney = roundMoney(
        guaranteedMoney * 1.1
      );
      explanation =
        "Winning matters most to this player. " +
        "A stronger guarantee could help offset " +
        "concerns about the team's competitiveness.";
      break;

    case "loyalty":
      guaranteedMoney = roundMoney(
        guaranteedMoney * 1.08
      );
      explanation =
        "The player wants a stronger commitment " +
        "from the franchise.";
      break;
  }

  // Ensure the proposed terms form a valid contract.
  const minimumNonIncentiveValue = Math.max(
    guaranteedMoney,
    signingBonus
  );

  totalValue = roundMoney(
    Math.max(
      totalValue,
      minimumNonIncentiveValue + incentiveTotal
    )
  );

  guaranteedMoney = roundMoney(
    clamp(
      guaranteedMoney,
      signingBonus,
      totalValue - incentiveTotal
    )
  );

  const proposedOffer = {
    years,
    totalValue,
    guaranteedMoney,
    signingBonus,
    incentives: offer.incentives || [],
  };

  validateContract(proposedOffer);

  return Object.freeze({
    status: "COUNTEROFFER",
    primaryMotive,
    message: explanation,
    proposedOffer,
    binding: false,
  });
}

module.exports = {
  generateCounteroffer,
};
