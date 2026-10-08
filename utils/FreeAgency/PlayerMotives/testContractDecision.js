
"use strict";

const assert = require("node:assert/strict");

const {
  validateContract,
  evaluateContractOffer,
  reviewFinalOffers,
} = require("./contractDecisionEngine");

// A player who strongly values winning and security.
const player = {
  archetype: "Competitor",
  money: 3,
  winning: 5,
  role: 4,
  security: 5,
  loyalty: 2,
  ego: 3,
};

// All dollar amounts are in millions.
const bids = [
  {
    bidId: "bid-001",
    teamId: "team-a",
    offer: {
      years: 4,
      totalValue: 80,
      guaranteedMoney: 50,
      signingBonus: 15,
      incentives: [
        {
          id: "fantasy-points",
          description: "Score 250 fantasy points",
          amount: 5,
          probability: 0.7,
        },
      ],
    },
    context: {
      marketValue: 18,
      teamWinning: 0.95,
      projectedRole: 0.9,
      loyaltyFit: 0.4,
      prestige: 0.8,
    },
  },
  {
    bidId: "bid-002",
    teamId: "team-b",
    offer: {
      years: 3,
      totalValue: 90,
      guaranteedMoney: 35,
      signingBonus: 10,
      incentives: [
        {
          id: "fantasy-points",
          description: "Score 250 fantasy points",
          amount: 10,
          probability: 0.3,
        },
      ],
    },
    context: {
      marketValue: 18,
      teamWinning: 0.25,
      projectedRole: 1,
      loyaltyFit: 0.2,
      prestige: 0.5,
    },
  },
  {
    bidId: "bid-003",
    teamId: "team-c",
    offer: {
      years: 3,
      totalValue: 72,
      guaranteedMoney: 48,
      signingBonus: 12,
      incentives: [],
    },
    context: {
      marketValue: 18,
      teamWinning: 0.75,
      projectedRole: 0.85,
      loyaltyFit: 0.9,
      prestige: 0.75,
    },
  },
];

function runTest(name, testFunction) {
  try {
    testFunction();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

runTest("Contract values are calculated correctly", () => {
  const result = validateContract(bids[0].offer);

  assert.equal(result.years, 4);
  assert.equal(result.totalValue, 80);
  assert.equal(result.maximumIncentives, 5);
  assert.equal(result.nonIncentiveValue, 75);
  assert.equal(result.averageAnnualValue, 20);
});

runTest("Each bid receives an interest evaluation", () => {
  for (const bid of bids) {
    const result = evaluateContractOffer({
      player,
      offer: bid.offer,
      context: bid.context,
    });

    assert.ok(result.score >= 0);
    assert.ok(result.score <= 1);

    assert.ok([
      "STRONG_INTEREST",
      "INTERESTED",
      "NEGOTIATION_NEEDED",
      "UNINTERESTED",
    ].includes(result.interest));

    console.log(
      `  ${bid.teamId}: ${result.interest} (${result.score})`
    );
  }
});

runTest("Final review is blocked while bidding is open", () => {
  assert.throws(
    () =>
      reviewFinalOffers({
        player,
        bids,
        biddingClosed: false,
      }),
    /bidding closes/
  );
});

runTest("Final review ranks all three bids", () => {
  const result = reviewFinalOffers({
    player,
    bids,
    biddingClosed: true,
  });

  assert.equal(
    result.status,
    "PENDING_COMMISSIONER_REVIEW"
  );

  assert.equal(result.signed, false);
  assert.equal(result.rankings.length, 3);
  assert.equal(
    result.recommendedBidId,
    result.rankings[0].bidId
  );

  for (let i = 1; i < result.rankings.length; i++) {
    assert.ok(
      result.rankings[i - 1].score >=
        result.rankings[i].score
    );
  }

  console.log("  Final rankings:", result.rankings);
});

runTest("Duplicate team bids are rejected", () => {
  const duplicate = {
    ...bids[1],
    bidId: "bid-004",
    teamId: "team-a",
  };

  assert.throws(
    () =>
      reviewFinalOffers({
        player,
        bids: [bids[0], duplicate],
        biddingClosed: true,
      }),
    /one final active bid per team/
  );
});

runTest("Invalid guarantees are rejected", () => {
  assert.throws(
    () =>
      validateContract({
        years: 3,
        totalValue: 50,
        guaranteedMoney: 60,
        signingBonus: 10,
        incentives: [],
      }),
    /Guarantees cannot exceed total value/
  );
});

console.log("\nAll contract decision tests passed!");
