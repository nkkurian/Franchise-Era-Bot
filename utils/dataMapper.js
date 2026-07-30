//Converts a column letter (A, B, C... Z, AA) into a 0-based array index position
function letterToIndex(letter) {
    if (!letter || typeof letter !== "string") return -1;
    const cleanLetter = letter.trim().toUpperCase();
    let index = 0;
    for (let i = 0; i < cleanLetter.length; i++) {
        index = index * 26 + (cleanLetter.charCodeAt(i) - 64);
    }
    return index - 1; // Return 0-indexed position
}

module.exports = {
    letterToIndex,
    /**
     * Extracts player data dynamically using the saved JSON mapping
     * @param {object} row - The raw Google Sheet row object
     * @param {object} mapping - The config.column_mapping JSON block from Supabase
     */
    parsePlayerRow(row, mapping) {
        if (!mapping || !row || !row._rawData) return null;

        const cleanFinance = (val) =>
            parseFloat(String(val || "0").replace(/[^0-9.-]+/g, "")) || 0;

        // Force explicit resolution of mapping configuration keys
        const nameKey = mapping.map_name || mapping.name;
        const teamKey = mapping.map_team || mapping.team;
        const posKey = mapping.map_pos || mapping.pos;
        const yearsKey = mapping.map_years_left || mapping.years_left;
        const aavKey = mapping.map_aav || mapping.aav;
        const capKey = mapping.map_cap_hit || mapping.cap_hit;
        const notesKey = mapping.map_notes || mapping.notes;

        // Convert alphabetical letters cleanly to data indices
        const nameIdx = letterToIndex(nameKey);
        const teamIdx = letterToIndex(teamKey);
        const posIdx = letterToIndex(posKey);
        const yearsIdx = letterToIndex(yearsKey);
        const aavIdx = letterToIndex(aavKey);
        const capIdx = letterToIndex(capKey);
        const notesIdx = letterToIndex(notesKey);

        return {
            name: nameIdx !== -1 ? row._rawData[nameIdx] || null : null,
            team: teamIdx !== -1 ? row._rawData[teamIdx] || null : null,
            position: posIdx !== -1 ? row._rawData[posIdx] || null : null,
            yearsLeft:
                yearsIdx !== -1 ? parseInt(row._rawData[yearsIdx]) || 0 : 0,
            aav: aavIdx !== -1 ? cleanFinance(row._rawData[aavIdx]) : 0,
            capHit: capIdx !== -1 ? cleanFinance(row._rawData[capIdx]) : 0,
            notes: notesIdx !== -1 ? row._rawData[notesIdx] || "" : "",
        };
    },

    /**
     * Extracts team-wide values from explicit cell coordinates
     * @param {object} sheet - The loaded Google Sheet tab object
     * @param {object} mapping - The config.column_mapping JSON block from Supabase
     */
    async parseTeamCells(sheet, mapping) {
        if (!mapping) return null;

        // Ensure cells are loaded before reading specific coordinates
        await sheet.loadCells(
            [mapping.team_cap, mapping.team_ext, mapping.trade_limit].filter(
                Boolean,
            ),
        ); // Filters out any unmapped/null cells

        return {
            teamCap: mapping.team_cap
                ? sheet.getCellByA1(mapping.team_cap).value
                : null,
            teamExt: mapping.team_ext
                ? sheet.getCellByA1(mapping.team_ext).value
                : null,
            tradeLimit: mapping.trade_limit
                ? sheet.getCellByA1(mapping.trade_limit).value
                : null,
        };
    },
};
