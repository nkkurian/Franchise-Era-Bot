
"use strict";

const assert = require("node:assert/strict");
const {
  createNegotiationManager,
} = require("./negotiationManager");

const player = {
  archetype: "Competitor",
  money: 3,
  winning: 5,
  role: 4,
  security: 5,
  loyalty: 2,
  ego: 3,
};

let currentTime = Date.parse("2027-03-01T12:00:00Z");

const manager = createNegotiationManager({
  player,
  playerId: "sleeper-player-123",
  deadline: "2027-03-02T12:00:00Z",
  now: () => currentTime,
});

function makeOffer(totalValue, guaranteedMoney) {
  return {
    years: 3,
    totalValue,
    guaranteedMoney,
    signingBonus: 10,
    incentives: [
      {
        id: "250-fantasy-points",
        description: "Score 250 fantasy points",
        amount: 5,
        probability: 0.5,
      },
    ],
  };
}

function makeContext(teamWinning, loyaltyFit) {
  return {
    marketValue: 20,
    teamWinning,
    projectedRole: 0.9,
    loyaltyFit,
    prestige: 0.75,
  };
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

runTest("Three franchises submit sealed bids", () => {
  manager.submitOffer({
    teamId: "Pittsburgh Steelers",
    offer: makeOffer(75, 40),
    context: makeContext(0.9, 0.8),
  });

  manager.submitOffer({
    teamId: "Dallas Cowboys",
    offer: makeOffer(85, 30),
    context: makeContext(0.5, 0.2),
  });

  manager.submitOffer({
    teamId: "Philadelphia Eagles",
    offer: makeOffer(70, 45),
    context: makeContext(0.85, 0.4),
  });

  assert.equal(manager.getBidderCount(), 3);
});

runTest("Public status never reveals bid details", () => {
  const status = manager.getPublicStatus();

  assert.equal(status.bidderCount, 3);
  assert.equal(status.biddingClosed, false);

  assert.equal("bids" in status, false);
  assert.equal("teamIds" in status, false);
  assert.equal("offers" in status, false);

  console.log("  Public status:", status);
});

runTest("A franchise can revise without adding a bidder", () => {
  const result = manager.submitOffer({
    teamId: "Pittsburgh Steelers",
    offer: makeOffer(82, 50),
    context: makeContext(0.9, 0.8),
  });

  assert.equal(result.revision, 2);
  assert.equal(manager.getBidderCount(), 3);

  const negotiation = manager.getTeamNegotiation(
    "Pittsburgh Steelers"
  );

  assert.equal(negotiation.offer.totalValue, 82);
  assert.equal(negotiation.offer.guaranteedMoney, 50);
});

runTest("Final review is blocked before the deadline", () => {
  assert.throws(
    () => manager.getCommissionerReview(),
    /bidding closes/
  );
});

runTest("A franchise can withdraw its bid", () => {
  const removed = manager.withdrawOffer("Dallas Cowboys");

  assert.equal(removed, true);
  assert.equal(manager.getBidderCount(), 2);
  assert.equal(
    manager.getTeamNegotiation("Dallas Cowboys"),
    null
  );
});

runTest("Bidding closes at the deadline", () => {
  currentTime = Date.parse("2027-03-02T12:00:00Z");

  assert.equal(manager.getPublicStatus().biddingClosed, true);

  assert.throws(
    () =>
      manager.submitOffer({
        teamId: "Dallas Cowboys",
        offer: makeOffer(100, 60),
        context: makeContext(0.5, 0.2),
      }),
    /Bidding is closed/
  );
});

runTest("Commissioner can review remaining bids", () => {
  const review = manager.getCommissionerReview();

  assert.equal(
    review.status,
    "PENDING_COMMISSIONER_REVIEW"
  );

  assert.equal(review.rankings.length, 2);
  assert.equal(review.signed, false);

  console.log("  Final rankings:", review.rankings);
});

console.log("\nAll negotiation manager tests passed!");

