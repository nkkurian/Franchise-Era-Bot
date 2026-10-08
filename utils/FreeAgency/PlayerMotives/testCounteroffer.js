
"use strict";

const assert = require("node:assert/strict");

const {
  generateCounteroffer,
} = require("./counterofferEngine");

const {
  validateContract,
} = require("./contractDecisionEngine");

const baseOffer = {
  years: 2,
  totalValue: 40,
  guaranteedMoney: 15,
  signingBonus: 5,
  incentives: [
    {
      id: "fantasy-points",
      description: "Score 250 fantasy points",
      amount: 5,
      probability: 0.5,
    },
  ],
};

const context = {
  marketValue: 25,
  teamWinning: 0.4,
  projectedRole: 0.7,
  loyaltyFit: 0.3,
  prestige: 0.5,
};

const players = [
  {
    name: "Money-Driven Player",
    archetype: "Mercenary",
    money: 5,
    winning: 2,
    role: 3,
    security: 2,
    loyalty: 1,
    ego: 3,
  },
  {
    name: "Security-Driven Player",
    archetype: "Security Seeker",
    money: 3,
    winning: 2,
    role: 3,
    security: 5,
    loyalty: 2,
    ego: 1,
  },
  {
    name: "Ego-Driven Player",
    archetype: "Featured Star",
    money: 3,
    winning: 2,
    role: 4,
    security: 2,
    loyalty: 1,
    ego: 5,
  },
];

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

for (const player of players) {
  runTest(`${player.name} generates a valid response`, () => {
    const result = generateCounteroffer({
      player,
      offer: baseOffer,
      context,
    });

    assert.equal(result.binding, false);

    assert.ok([
      "COUNTEROFFER",
      "HOLD_FOR_FINAL_REVIEW",
    ].includes(result.status));

    if (result.status === "COUNTEROFFER") {
      assert.ok(result.proposedOffer);
      validateContract(result.proposedOffer);

      console.log(`  Motive: ${result.primaryMotive}`);
      console.log("  Proposed terms:", result.proposedOffer);
    } else {
      assert.equal(result.proposedOffer, null);
      console.log("  Holding offer for final review.");
    }
  });
}

runTest("Original offer is not modified", () => {
  const before = JSON.stringify(baseOffer);

  generateCounteroffer({
    player: players[0],
    offer: baseOffer,
    context,
  });

  assert.equal(JSON.stringify(baseOffer), before);
});

runTest("Strong offers can be held without signing", () => {
  const strongOffer = {
    years: 4,
    totalValue: 120,
    guaranteedMoney: 110,
    signingBonus: 30,
    incentives: [],
  };

  const strongContext = {
    marketValue: 20,
    teamWinning: 1,
    projectedRole: 1,
    loyaltyFit: 1,
    prestige: 1,
  };

  const result = generateCounteroffer({
    player: players[1],
    offer: strongOffer,
    context: strongContext,
  });

  assert.equal(result.status, "HOLD_FOR_FINAL_REVIEW");
  assert.equal(result.proposedOffer, null);
  assert.equal(result.binding, false);
});

runTest("Invalid offers are rejected", () => {
  assert.throws(() =>
    generateCounteroffer({
      player: players[0],
      offer: {
        ...baseOffer,
        guaranteedMoney: 100,
      },
      context,
    })
  );
});

console.log("\nAll counteroffer tests passed!");
