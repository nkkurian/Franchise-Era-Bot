
const assert = require("node:assert/strict");

const {
    MINIMUM_SALARY,
    parseSalary,
    calculatePositionMarket,
    calculateAllPositionMarkets
} = require("./marketValueEngine");

// Simulated league contracts.
// These are test values, not actual contracts from your sheet.
const players = [
    {
        name: "WR A",
        position: "WR",
        contractLength: 4,
        yearsRemaining: 3,
        totalValue: "20M",
        aav: "5M"
    },
    {
        name: "WR B",
        position: "WR",
        contractLength: 4,
        yearsRemaining: 2,
        totalValue: "40M",
        aav: "10M"
    },
    {
        name: "WR C",
        position: "WR",
        contractLength: 4,
        yearsRemaining: 4,
        totalValue: "60M",
        aav: "15M"
    },
    {
        name: "WR D",
        position: "WR",
        contractLength: 4,
        yearsRemaining: 1,
        totalValue: "80M",
        aav: "20M"
    },
    {
        name: "WR E",
        position: "WR",
        contractLength: 4,
        yearsRemaining: 4,
        totalValue: "100M",
        aav: "25M"
    },
    {
        name: "QB A",
        position: "QB",
        contractLength: 3,
        yearsRemaining: 2,
        totalValue: "135M",
        aav: "45M"
    },
    {
        name: "Unsigned WR",
        position: "WR",
        contractLength: 0,
        yearsRemaining: 0,
        totalValue: 0,
        aav: "1.2M"
    },
    {
        name: "Invalid WR",
        position: "WR",
        contractLength: 3,
        yearsRemaining: 2,
        totalValue: "#DIV/0!",
        aav: "#DIV/0!"
    }
];

assert.equal(MINIMUM_SALARY, 1_200_000);
assert.equal(parseSalary("$45M"), 45_000_000);
assert.equal(parseSalary("$1.2M"), 1_200_000);
assert.equal(parseSalary("#DIV/0!"), NaN);

const wrMarket = calculatePositionMarket(players, "WR");

assert.equal(wrMarket.marketValue, 15_000_000);
assert.equal(wrMarket.sampleSize, 5);
assert.equal(wrMarket.confidence, "MEDIUM");
assert.equal(wrMarket.lowestContract, 5_000_000);
assert.equal(wrMarket.highestContract, 25_000_000);

const qbMarket = calculatePositionMarket(players, "QB");

assert.equal(qbMarket.marketValue, 45_000_000);
assert.equal(qbMarket.sampleSize, 1);
assert.equal(qbMarket.confidence, "LOW");

const rbMarket = calculatePositionMarket(players, "RB");

assert.equal(rbMarket.marketValue, 1_200_000);
assert.equal(rbMarket.sampleSize, 0);
assert.equal(rbMarket.confidence, "NO_DATA");

const additionalPlayers = [
    { position: "RB", contractLength: 3, yearsRemaining: 2, totalValue: "9M", aav: "3M" },
    { position: "RB", contractLength: 3, yearsRemaining: 3, totalValue: "18M", aav: "6M" },
    { position: "RB", contractLength: 3, yearsRemaining: 1, totalValue: "27M", aav: "9M" },

    { position: "TE", contractLength: 2, yearsRemaining: 2, totalValue: "8M", aav: "4M" },
    { position: "TE", contractLength: 2, yearsRemaining: 1, totalValue: "16M", aav: "8M" },

    { position: "DL", contractLength: 2, yearsRemaining: 2, totalValue: "10M", aav: "5M" },
    { position: "DL", contractLength: 2, yearsRemaining: 1, totalValue: "20M", aav: "10M" },

    { position: "LB", contractLength: 2, yearsRemaining: 2, totalValue: "6M", aav: "3M" },
    { position: "LB", contractLength: 2, yearsRemaining: 1, totalValue: "14M", aav: "7M" },

    { position: "DB", contractLength: 2, yearsRemaining: 2, totalValue: "8M", aav: "4M" },
    { position: "DB", contractLength: 2, yearsRemaining: 1, totalValue: "12M", aav: "6M" }
];

players.push(...additionalPlayers);

assert.equal(calculatePositionMarket(players, "RB").marketValue, 6_000_000);
assert.equal(calculatePositionMarket(players, "TE").marketValue, 6_000_000);
assert.equal(calculatePositionMarket(players, "DL").marketValue, 7_500_000);
assert.equal(calculatePositionMarket(players, "LB").marketValue, 5_000_000);
assert.equal(calculatePositionMarket(players, "DB").marketValue, 5_000_000);

console.log("✅ RB market value: $6M");
console.log("✅ TE market value: $6M");
console.log("✅ DL market value: $7.5M");
console.log("✅ LB market value: $5M");
console.log("✅ DB market value: $5M");
console.log("\n🎉 All Market Value Engine tests passed!");