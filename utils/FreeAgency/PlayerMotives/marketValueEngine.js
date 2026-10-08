
const MINIMUM_SALARY = 1_200_000;

// Convert spreadsheet salaries into dollar amounts.
function parseSalary(value) {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : NaN;
    }

    if (typeof value !== "string") return NaN;

    const cleaned = value
        .trim()
        .toUpperCase()
        .replace(/[$,\s]/g, "");

    if (!cleaned || cleaned.startsWith("#")) return NaN;

    const match = cleaned.match(/^(\d+(?:\.\d+)?)([MK])?$/);

    if (!match) return NaN;

    const amount = Number(match[1]);
    const multiplier =
        match[2] === "M" ? 1_000_000 :
        match[2] === "K" ? 1_000 : 1;

    return amount * multiplier;
}

function median(values) {
    if (!values.length) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 1) {
        return sorted[middle];
    }

    return (sorted[middle - 1] + sorted[middle]) / 2;
}

function getConfidence(sampleSize) {
    if (sampleSize >= 10) return "HIGH";
    if (sampleSize >= 5) return "MEDIUM";
    if (sampleSize >= 1) return "LOW";
    return "NO_DATA";
}

/**
 * Expected player data:
 * {
 *   name: "A.J. Brown",
 *   position: "WR",
 *   contractLength: 4,
 *   yearsRemaining: 4,
 *   totalValue: 76000000,
 *   aav: 19000000
 * }
 *
 * Salary values are in dollars.
 */
function calculatePositionMarket(players, position) {
    if (!Array.isArray(players)) {
        throw new Error("Players must be an array.");
    }

    const normalizedPosition = String(position || "")
        .trim()
        .toUpperCase();

    if (!normalizedPosition) {
        throw new Error("Position is required.");
    }

    const contracts = players
        .filter((player) => {
            if (!player) return false;

            const playerPosition = String(player.position || "")
                .trim()
                .toUpperCase();

            if (playerPosition !== normalizedPosition) return false;

            const totalValue = parseSalary(player.totalValue);
            const aav = parseSalary(player.aav);
            const length = Number(player.contractLength);
            const remaining = Number(player.yearsRemaining);

            return (
                Number.isFinite(totalValue) &&
                totalValue > 0 &&
                Number.isFinite(aav) &&
                aav >= MINIMUM_SALARY &&
                Number.isInteger(length) &&
                length > 0 &&
                Number.isInteger(remaining) &&
                remaining > 0
            );
        })
        .map((player) => parseSalary(player.aav));

    const sampleSize = contracts.length;

    if (sampleSize === 0) {
        return {
            position: normalizedPosition,
            marketValue: MINIMUM_SALARY,
            minimumSalary: MINIMUM_SALARY,
            sampleSize: 0,
            confidence: "NO_DATA",
            lowestContract: null,
            highestContract: null,
            source: "LEAGUE_MINIMUM_FALLBACK"
        };
    }

    const marketValue = Math.max(
        MINIMUM_SALARY,
        median(contracts)
    );

    return {
        position: normalizedPosition,
        marketValue,
        minimumSalary: MINIMUM_SALARY,
        sampleSize,
        confidence: getConfidence(sampleSize),
        lowestContract: Math.min(...contracts),
        highestContract: Math.max(...contracts),
        source: "SIGNED_LEAGUE_CONTRACTS"
    };
}

function calculateAllPositionMarkets(players) {
    if (!Array.isArray(players)) {
        throw new Error("Players must be an array.");
    }

    const positions = [
        ...new Set(
            players
                .filter(Boolean)
                .map((player) =>
                    String(player.position || "").trim().toUpperCase()
                )
                .filter(Boolean)
        )
    ];

    const markets = {};

    for (const position of positions) {
        markets[position] = calculatePositionMarket(players, position);
    }

    return markets;
}

module.exports = {
    MINIMUM_SALARY,
    parseSalary,
    calculatePositionMarket,
    calculateAllPositionMarkets
};
