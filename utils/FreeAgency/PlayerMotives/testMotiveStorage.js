
const assert = require("node:assert/strict");
const {
  findPlayerMotives,
  getOrCreatePlayerMotives,
} = require("./motiveStorage");

const HEADERS = [
  "League_ID",
  "Sleeper_ID",
  "Archetype",
  "Money",
  "Winning",
  "Role",
  "Security",
  "Loyalty",
  "Ego",
  "Generation_Version",
  "Last_Evolved_Season",
];

function createFakeSpreadsheet() {
  const storedRows = [];

  const sheet = {
    headerValues: [...HEADERS],

    async loadHeaderRow() {
      return this.headerValues;
    },

    async getRows() {
      return storedRows;
    },

    async addRow(data) {
      const values = { ...data };

      const row = {
        get(column) {
          return values[column];
        },
        _rawData: HEADERS.map((header) => values[header] ?? ""),
      };

      storedRows.push(row);
      return row;
    },
  };

  const doc = {
    sheetsByTitle: {
      Player_Motives: sheet,
    },
  };

  return { doc, storedRows };
}

async function runTests() {
  const { doc, storedRows } = createFakeSpreadsheet();

  const player = {
    leagueId: "1353482184714895360",
    sleeperId: "96",
    age: 42,
    position: "QB",
  };

  console.log("Test 1: Player does not exist yet");

  const before = await findPlayerMotives(
    doc,
    player.leagueId,
    player.sleeperId
  );

  assert.equal(before, null);

  console.log("Test 2: Generate and save personality");

  const created = await getOrCreatePlayerMotives(doc, player);

  assert.ok(created);
  assert.equal(storedRows.length, 1);
  assert.equal(created.sleeperId, player.sleeperId);

  console.log("Test 3: Retrieve saved personality");

  const found = await findPlayerMotives(
    doc,
    player.leagueId,
    player.sleeperId
  );

  assert.ok(found);
  assert.equal(found.archetype, created.archetype);

  for (const motive of [
    "money",
    "winning",
    "role",
    "security",
    "loyalty",
    "ego",
  ]) {
    assert.equal(found[motive], created[motive]);
  }

  console.log("Test 4: Prevent duplicate entries");

  const existing = await getOrCreatePlayerMotives(doc, player);

  assert.equal(existing.archetype, created.archetype);
  assert.equal(storedRows.length, 1);

  console.log("Test 5: Two simultaneous requests");

  const secondPlayer = {
    leagueId: player.leagueId,
    sleeperId: "97",
    age: 25,
    position: "WR",
  };

  const [firstRequest, secondRequest] = await Promise.all([
    getOrCreatePlayerMotives(doc, secondPlayer),
    getOrCreatePlayerMotives(doc, secondPlayer),
  ]);

  assert.equal(firstRequest.archetype, secondRequest.archetype);
  assert.equal(storedRows.length, 2);

  console.log("\nAll motive storage tests passed!");
  console.log("Stored player personalities:", storedRows.length);
}

runTests().catch((error) => {
  console.error("\nStorage test failed:");
  console.error(error);
  process.exitCode = 1;
});
