
"use strict";

// Franchise league salary cap rules
const BASE_YEAR = 2026;
const BASE_SALARY_CAP = 205_000_000;
const ANNUAL_CAP_INCREASE = 0.07;

/**
 * Calculate the salary cap for any season from 2026 onward.
 */
function getSalaryCap(year) {
    if (!Number.isInteger(year) || year < BASE_YEAR) {
        throw new Error("Year must be 2026 or later.");
    }

    const yearsElapsed = year - BASE_YEAR;

    return Math.round(
        BASE_SALARY_CAP *
        Math.pow(1 + ANNUAL_CAP_INCREASE, yearsElapsed)
    );
}

/**
 * Calculate what percentage of the salary cap
 * a player's annual salary represents.
 */
function getCapPercentage(salary, year) {
    if (
        typeof salary !== "number" ||
        !Number.isFinite(salary) ||
        salary < 0
    ) {
        throw new Error("Salary must be a nonnegative number.");
    }

    return (salary / getSalaryCap(year)) * 100;
}

/**
 * Adjust a salary between seasons while preserving
 * its percentage of the league salary cap.
 */
function adjustSalaryForCapGrowth(salary, fromYear, toYear) {
    const percentage = getCapPercentage(salary, fromYear);

    return Math.round(
        getSalaryCap(toYear) * percentage / 100
    );
}

/**
 * Generate salary cap projections for future seasons.
 */
function getSalaryCapProjection(startYear, numberOfYears) {
    if (
        !Number.isInteger(numberOfYears) ||
        numberOfYears < 1 ||
        numberOfYears > 30
    ) {
        throw new Error(
            "Number of years must be between 1 and 30."
        );
    }

    const projection = [];

    for (let i = 0; i < numberOfYears; i++) {
        const year = startYear + i;

        projection.push({
            year,
            salaryCap: getSalaryCap(year),
            annualGrowthRate: ANNUAL_CAP_INCREASE
        });
    }

    return projection;
}

module.exports = {
    BASE_YEAR,
    BASE_SALARY_CAP,
    ANNUAL_CAP_INCREASE,
    getSalaryCap,
    getCapPercentage,
    adjustSalaryForCapGrowth,
    getSalaryCapProjection
};
