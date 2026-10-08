
"use strict";

const assert = require("node:assert/strict");
const {
  createNegotiationStorage,
} = require("./negotiationStorage");

// Simulated Supabase database.
const database = {
  fa_negotiation_sessions: [],
  fa_negotiation_events: [],
};

let nextId = 1;

function createFakeSupabase() {
  return {
    from(tableName) {
      if (!database[tableName]) {
        throw new Error(`Unknown table: ${tableName}`);
      }

      const filters = [];
      let ordering = null;

      const query = {
        eq(column, value) {
          filters.push({ column, value });
          return query;
        },

        order(column, options = {}) {
          ordering = {
            column,
            ascending: options.ascending !== false,
          };
          return query;
        },

        select() {
          return query;
        },

        single() {
          return execute(true);
        },

        maybeSingle() {
          return execute(true);
        },

        then(resolve, reject) {
          return execute(false).then(resolve, reject);
        },

        insert(record) {
          return write("insert", record);
        },

        upsert(record) {
          return write("upsert", record);
        },
      };

      function write(operation, record) {
        return {
          select() {
            return {
              async single() {
                const rows = database[tableName];

                let existing = null;

                if (operation === "upsert") {
                  existing = rows.find(
                    (row) =>
                      row.league_id === record.league_id &&
                      row.player_id === record.player_id
                  );
                }

                if (existing) {
                  Object.assign(existing, record);

                  return {
                    data: structuredClone(existing),
                    error: null,
                  };
                }

                const created = {
                  id: nextId++,
                  ...structuredClone(record),
                  created_at: new Date().toISOString(),
                };

                rows.push(created);

                return {
                  data: structuredClone(created),
                  error: null,
                };
              },
            };
          },
        };
      }

      async function execute(single) {
        let rows = database[tableName].filter((row) =>
          filters.every(
            (filter) =>
              row[filter.column] === filter.value
          )
        );

        if (ordering) {
          rows = [...rows].sort((a, b) => {
            const comparison = String(
              a[ordering.column]
            ).localeCompare(String(b[ordering.column]));

            return ordering.ascending
              ? comparison
              : -comparison;
          });
        }

        const result = structuredClone(rows);

        return {
          data: single ? result[0] || null : result,
          error: null,
        };
      }

      return query;
    },
  };
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

async function main() {
  const storage = createNegotiationStorage(
    createFakeSupabase()
  );

  const leagueId = "1353482184714895360";
  const playerId = "sleeper-player-123";

  let session;

  await runTest("Create a bidding session", async () => {
    session = await storage.saveSession({
      leagueId,
      playerId,
      deadline: "2027-03-02T12:00:00Z",
    });

    assert.equal(session.league_id, leagueId);
    assert.equal(session.player_id, playerId);
    assert.equal(session.status, "OPEN");
  });

  await runTest("Retrieve a bidding session", async () => {
    const result = await storage.getSession(
      leagueId,
      playerId
    );

    assert.equal(result.id, session.id);
  });

  await runTest("Save a private team offer", async () => {
    const event = await storage.saveEvent({
      sessionId: session.id,
      teamId: "Pittsburgh Steelers",
      eventType: "OFFER_SUBMITTED",
      payload: {
        years: 3,
        totalValue: 75,
        guaranteedMoney: 40,
        signingBonus: 10,
      },
    });

    assert.equal(event.event_type, "OFFER_SUBMITTED");
    assert.equal(event.team_id, "Pittsburgh Steelers");
  });

  await runTest("Save a revised offer", async () => {
    await storage.saveEvent({
      sessionId: session.id,
      teamId: "Pittsburgh Steelers",
      eventType: "OFFER_REVISED",
      payload: {
        years: 4,
        totalValue: 82,
        guaranteedMoney: 50,
        signingBonus: 12,
      },
    });

    const history = await storage.getTeamHistory(
      session.id,
      "Pittsburgh Steelers"
    );

    assert.equal(history.length, 2);
    assert.equal(
      history[1].event_type,
      "OFFER_REVISED"
    );
  });

  await runTest("Different teams have separate histories", async () => {
    await storage.saveEvent({
      sessionId: session.id,
      teamId: "Philadelphia Eagles",
      eventType: "OFFER_SUBMITTED",
      payload: {
        years: 3,
        totalValue: 70,
      },
    });

    const steelersHistory =
      await storage.getTeamHistory(
        session.id,
        "Pittsburgh Steelers"
      );

    const eaglesHistory =
      await storage.getTeamHistory(
        session.id,
        "Philadelphia Eagles"
      );

    assert.equal(steelersHistory.length, 2);
    assert.equal(eaglesHistory.length, 1);
  });

  await runTest("Commissioner can retrieve all events", async () => {
    const history =
      await storage.getCommissionerHistory(session.id);

    assert.equal(history.length, 3);
  });

  await runTest("Updating a session doesn't duplicate it", async () => {
    const updated = await storage.saveSession({
      leagueId,
      playerId,
      deadline: "2027-03-03T12:00:00Z",
      status: "CLOSED",
    });

    assert.equal(updated.id, session.id);
    assert.equal(
      database.fa_negotiation_sessions.length,
      1
    );
    assert.equal(updated.status, "CLOSED");
  });

  console.log("\nAll negotiation storage tests passed!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
