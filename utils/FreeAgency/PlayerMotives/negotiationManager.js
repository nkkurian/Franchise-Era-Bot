
"use strict";

const {
  evaluateContractOffer,
  reviewFinalOffers,
} = require("./contractDecisionEngine");

const {
  generateCounteroffer,
} = require("./counterofferEngine");

function createNegotiationManager({
  player,
  playerId,
  deadline,
  now = () => Date.now(),
}) {
  if (!player || !playerId) {
    throw new Error("Player and playerId are required.");
  }

  const deadlineTime = new Date(deadline).getTime();

  if (!Number.isFinite(deadlineTime)) {
    throw new Error("A valid bidding deadline is required.");
  }

  const bids = new Map();
  let closed = false;

  function isClosed() {
    return closed || now() >= deadlineTime;
  }

  function submitOffer({ teamId, offer, context }) {
    if (isClosed()) {
      throw new Error("Bidding is closed.");
    }

    if (!teamId || typeof teamId !== "string") {
      throw new Error("A valid team ID is required.");
    }

    // Evaluate before storing anything.
    const evaluation = evaluateContractOffer({
      player,
      offer,
      context,
    });

    const response = generateCounteroffer({
      player,
      offer,
      context,
    });

    const previous = bids.get(teamId);

    const bid = {
      bidId: previous?.bidId || `${playerId}:${teamId}`,
      teamId,
      offer: structuredClone(offer),
      context: structuredClone(context),
      evaluation,
      response,
      revision: (previous?.revision || 0) + 1,
      updatedAt: now(),
    };

    bids.set(teamId, bid);

    return structuredClone({
      bidId: bid.bidId,
      revision: bid.revision,
      evaluation: {
        interest: evaluation.interest,
      },
      response,
    });
  }

  function withdrawOffer(teamId) {
    if (isClosed()) {
      throw new Error("Bidding is closed.");
    }

    return bids.delete(teamId);
  }

  function getBidderCount() {
    return bids.size;
  }

  // Safe for public Free Agency announcements.
  function getPublicStatus() {
    return {
      playerId,
      bidderCount: getBidderCount(),
      biddingClosed: isClosed(),
      deadline: new Date(deadlineTime).toISOString(),
    };
  }

  // A GM may retrieve only their own bid.
  // The Discord command layer must authenticate the
  // GM and derive teamId from their authorized franchise.
  function getTeamNegotiation(teamId) {
    const bid = bids.get(teamId);

    if (!bid) return null;

    return structuredClone({
      bidId: bid.bidId,
      teamId: bid.teamId,
      offer: bid.offer,
      revision: bid.revision,
      response: bid.response,
      updatedAt: bid.updatedAt,
    });
  }

  // Commissioner-only: never expose through public
  // Discord commands or GM-facing API routes.
  function getCommissionerReview() {
    if (!isClosed()) {
      throw new Error(
        "Final review cannot begin before bidding closes."
      );
    }

    if (bids.size === 0) {
      return {
        status: "NO_ACTIVE_BIDS",
        rankings: [],
        recommendedBidId: null,
        signed: false,
      };
    }

    return reviewFinalOffers({
      player,
      bids: [...bids.values()],
      biddingClosed: true,
    });
  }

  function closeBidding() {
    closed = true;
    return getPublicStatus();
  }

  return Object.freeze({
    submitOffer,
    withdrawOffer,
    getBidderCount,
    getPublicStatus,
    getTeamNegotiation,
    getCommissionerReview,
    closeBidding,
  });
}

module.exports = {
  createNegotiationManager,
};
