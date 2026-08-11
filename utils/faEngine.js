 // Process and write a Free Agency bid to Google Sheets
async function processFreeAgencyBid({ guildId, userId, teamName, rawPlayerName, rawSalary, rawYears, winPct = 0.500 }, getSheetData, config) {
    // 1. Sanitize & Parse Inputs
    const playerName = rawPlayerName.trim();
    const years = parseInt(rawYears, 10);

    let salary = parseFloat(String(rawSalary).replace(/[$,]/g, ""));
    if (String(rawSalary).toLowerCase().endsWith("m")) {
        salary = parseFloat(rawSalary) * 1000000;
    }

    if (isNaN(salary) || salary <= 0 || isNaN(years) || years <= 0) {
        return { success: false, message: "❌ Invalid salary or contract duration provided." };
    }

    const totalValue = salary * years;

    // 2. Calculate Internal Score (~80% Money Priority / ~20% Win Pct)
    const moneyScore = Math.min((totalValue / 50000000) * 80, 80);
    const winPctScore = (parseFloat(winPct) || 0.5) * 20;
    const internalScore = (moneyScore + winPctScore).toFixed(2);

    // 3. Fetch Google Sheet Data
    const { doc } = await getSheetData(guildId);

    // 4. Ensure 'FA_Bids' Sheet Exists
    let faSheet = doc.sheetsByTitle["FA_Bids"];
    if (!faSheet) {
        faSheet = await doc.addSheet({
            title: "FA_Bids",
            headerValues: [
                "Timestamp",
                "Team_Name",
                "User_ID",
                "Player_Name",
                "Salary",
                "Years",
                "Total_Value",
                "Team_Win_Pct",
                "Internal_Score",
                "Status"
            ]
        });
    }

    // 5. Check for Existing Bid Overwrite
    const rows = await faSheet.getRows();
    const existingRow = rows.find(
        (r) => r.get("User_ID") === String(userId) && r.get("Player_Name")?.toLowerCase() === playerName.toLowerCase()
    );

    const nowFormatted = new Date().toISOString();

    if (existingRow) {
        // OVERWRITE EXISTING ROW
        existingRow.set("Timestamp", nowFormatted);
        existingRow.set("Team_Name", teamName);
        existingRow.set("Salary", `$${salary.toLocaleString()}`);
        existingRow.set("Years", years);
        existingRow.set("Total_Value", `$${totalValue.toLocaleString()}`);
        existingRow.set("Team_Win_Pct", winPct);
        existingRow.set("Internal_Score", internalScore);
        existingRow.set("Status", "Submitted");
        await existingRow.save();

        return {
            success: true,
            isUpdate: true,
            data: { playerName, salary, years, totalValue, internalScore }
        };
    } else {
        // APPEND NEW ROW
        await faSheet.addRow({
            Timestamp: nowFormatted,
            Team_Name: teamName,
            User_ID: String(userId),
            Player_Name: playerName,
            Salary: `$${salary.toLocaleString()}`,
            Years: years,
            Total_Value: `$${totalValue.toLocaleString()}`,
            Team_Win_Pct: winPct,
            Internal_Score: internalScore,
            Status: "Submitted"
        });

        return {
            success: true,
            isUpdate: false,
            data: { playerName, salary, years, totalValue, internalScore }
        };
    }
}

module.exports = { processFreeAgencyBid };