const { google } = require('googleapis');

/**
 * Authorize Google Sheets API using Environment Variables
 */
function getGoogleSheetsClient() {
    // Expects GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY in your process.env
    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: process.env.GOOGLE_EMAIL,
            private_key: process.env.GOOGLE_KEY?.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    return google.sheets({ version: 'v4', auth });
}

function parseSalaryInput(val) {
    if (typeof val === 'number') return val;
    if (!val || typeof val !== 'string') return 0;

    const cleaned = val.trim().toUpperCase().replace(/[\$,]/g, '');
    if (cleaned.endsWith('M')) return (parseFloat(cleaned.replace('M', '')) || 0) * 1000000;
    if (cleaned.endsWith('K')) return (parseFloat(cleaned.replace('K', '')) || 0) * 1000;
    return parseFloat(cleaned) || 0;
}

/**
 * Append or update a bid in the Google Sheet
 * Columns: [ Player Name, Team Name, AAV, Years, Total Contract Value, Timestamp ]
 */
async function recordBidInSheet(sheetId, sheetTab, bidData) {
    const sheets = getGoogleSheetsClient();
    const { playerName, teamName, aav, years, totalValue } = bidData;
    const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

    // 1. Fetch current rows to check if this team already bid on this player
    const range = `'${sheetTab}'!A:F`;

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: range,
    });

    const rows = response.data.values || [];
    let existingRowIndex = -1;

    // Search for existing row matching both Player Name AND Team Name (Case-Insensitive)
    for (let i = 1; i < rows.length; i++) {
        const rowTeam = rows[i][1];   // Col B: Team
        const rowPlayer = rows[i][2]; // Col C: Player Name

        if (
            rowPlayer?.trim().toLowerCase() === bidData.playerName.trim().toLowerCase() &&
            rowTeam?.trim().toLowerCase() === bidData.teamName.trim().toLowerCase()
        ) {
            existingRowIndex = i + 1;
            break;
        }
    }

    const rowData = [
        new Date().toLocaleString(), // Col A: Date/Time
        bidData.teamName,             // Col B: Team
        bidData.playerName,           // Col C: Player Name
        "",                           // Col D: Position (Skipped)
        bidData.aav,                  // Col E: AAV
        bidData.years,                // Col F: Length
        bidData.bonuses,              // Col G: Total Guaranteed / Bonuses
        "",                           // Col H: Signing Bonus (Included in Col G)
        "",                           // Col I: Incentives (Included in Col G)
        bidData.notes                 // Col J: Notes
    ];

    let actionTaken = "";

    if (existingRowIndex !== -1) {
        // 2a. Update existing bid row
        await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: `'${sheetTab}'!A${existingRowIndex}:J${existingRowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [rowData] },
        });
        actionTaken = 'updated';
    } else {
        // 2b. Append new bid row
        await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: range,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [rowData] },
        });
        actionTaken = 'appended';
    }

    // 3. Fetch the team's fresh total bid count
    const activeTeamBids = await fetchTeamBids(sheetId, sheetTab, bidData.teamName);

    return { 
        success: true, 
        action: actionTaken, 
        teamBidCount: activeTeamBids.length 
    };
}

/**
 * Fetch all active bids placed by a specific team
 */
async function fetchTeamBids(sheetId, sheetTab, teamName) {
    const sheets = getGoogleSheetsClient();
    // Expand range to Column J to cover all bid data
    const range = `'${sheetTab}'!A:J`;

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: range,
    });

    const rows = response.data.values || [];
    if (rows.length <= 1) return []; // Empty sheet or header only

    // Filter rows by Team Name (Col B / Index 1)
    const teamBids = rows.slice(1).filter(row => row[1]?.trim().toLowerCase() === teamName.trim().toLowerCase());

    return teamBids.map(row => {
        const parsedAAV = parseSalaryInput(row[4]); // Col E / Index 4 = AAV
        const parsedYears = parseInt(row[5], 10) || 1; // Col F / Index 5 = Length

        return {
            timestamp: row[0] || "N/A",                // Col A / Index 0 = Date/Time
            teamName: row[1] || "",                    // Col B / Index 1 = Team
            playerName: row[2] || "Unknown Player",    // Col C / Index 2 = Player Name
            aav: parsedAAV,
            years: parsedYears,
            totalValue: parsedAAV * parsedYears,       // Calculated total value
            bonuses: row[6] || "N/A",                  // Col G / Index 6 = Bonuses
            notes: row[9] || "None"                    // Col J / Index 9 = Notes
        };
    });
}

/**
 * Fetch total number of submitted bids across the whole sheet
 */
async function fetchTotalBidsCount(sheetId, sheetTab) {
    const sheets = getGoogleSheetsClient();
    const range = `'${sheetTab}'!A:A`;

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: range,
    });

    const rows = response.data.values || [];
    // Subtract 2 for Row 1 (Title) and Row 2 (Headers)
    return Math.max(0, rows.length - 2); 
}

async function removeBidFromSheet(sheetId, sheetTab, teamName, playerName) {
    const sheets = getGoogleSheetsClient();
    const range = `'${sheetTab}'!A:J`;

    const response = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: range });
    const rows = response.data.values || [];

    for (let i = 1; i < rows.length; i++) {
        const rowTeam = rows[i][1];
        const rowPlayer = rows[i][2];

        if (rowPlayer?.trim().toLowerCase() === playerName.trim().toLowerCase() &&
            rowTeam?.trim().toLowerCase() === teamName.trim().toLowerCase()) {

            const rowIndex = i + 1;
            const withdrawTimestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });

            // Option A: Hard Delete row if you prefer physically removing the line
            await sheets.spreadsheets.values.clear({
                spreadsheetId: sheetId,
                range: `'${sheetTab}'!A${rowIndex}:J${rowIndex}`
            });

            // Return details so Discord can log the event
            return {
                success: true,
                timestamp: withdrawTimestamp,
                previousAAV: rows[i][4] || "N/A"
            };
        }
    }
    return { success: false };
}

module.exports = {
    recordBidInSheet,
    fetchTeamBids,
    fetchTotalBidsCount,
    removeBidFromSheet
};