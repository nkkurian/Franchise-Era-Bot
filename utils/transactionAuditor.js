const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const normalizePlayerName = (name) => {
    if (!name) return "";
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "") // removes spaces, periods, apostrophes, suffixes
        .trim();
};

function createTransactionActionRow(txn, config) {
    const type = txn.type?.toLowerCase(); // e.g., 'add', 'cut', 'drop', 'out'
    const rules = config?.auto_salary_rules || {};

    if (!type || type === 'trade') return null; // Trades get zero buttons

    const row = new ActionRowBuilder();
    const pId = txn.player_id || "unknown";

    if (type === 'add') {
        let rawAAV = rules.waiver_aav ?? config?.min_contract_salary ?? "Min";
        const defaultYears = rules.waiver_years || "1";

        // Format label cleanly (e.g., if rawAAV is 1.75, show "$1.75M")
        let displayAAV = rawAAV;
        if (!isNaN(parseFloat(rawAAV))) {
            const numVal = parseFloat(rawAAV);
            displayAAV = numVal >= 1000 ? `$${numVal.toLocaleString()}` : `$${numVal}M`;
        }

        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`tx_waiver_${pId}_${rawAAV}_${defaultYears}`)
                .setLabel(`Waiver Salary (${displayAAV} - ${defaultYears}Y)`)
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`tx_edit_${pId}`)
                .setLabel("Edit Salary")
                .setStyle(ButtonStyle.Secondary)
        );
    } else if (['cut', 'drop', 'out'].includes(type)) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`tx_edit_${pId}`)
                .setLabel("Edit Salary")
                .setStyle(ButtonStyle.Danger)
        );
    }

    return row.components.length > 0 ? row : null;
}

const colToIndex = (colLetter) => {
    if (!colLetter) return null;
    const clean = colLetter.trim().toUpperCase();
    if (clean.length === 1) return clean.charCodeAt(0) - 65;
    let index = 0;
    for (let i = 0; i < clean.length; i++) {
        index = index * 26 + (clean.charCodeAt(i) - 64);
    }
    return index - 1;
};

const getDetails = async (pId, players, config) => {
    // 1. Pull directly from your real Supabase properties
    const nameLetter = config?.column_mapping?.name || config?.col_player_name || "A";
    const salaryLetter = config?.column_mapping?.cap_hit || config?.column_mapping?.salary || config?.col_salary || "F";
    const yearsLetter = config?.column_mapping?.years || "D";
    const deadCapLetter = config?.column_mapping?.dead_cap || "I";
    const notesLetter = config?.column_mapping?.notes || "K";

    const nameIdx = colToIndex(String(nameLetter));  
    const salaryIdx = colToIndex(String(salaryLetter));     
    const yearsIdx = colToIndex(String(yearsLetter));       
    const deadCapIdx = colToIndex(String(deadCapLetter));   
    const notesIdx = colToIndex(String(notesLetter));      

    let name = `Unknown Player (${pId})`;

    // Try local cache first
    let cachedPlayer = global.sleeperCache ? global.sleeperCache.get(pId) : null;

    if (cachedPlayer && cachedPlayer.name) {
        name = cachedPlayer.name;
    } else {
        // 🟢 HOT-FIX: Dynamic fallback lookup directly from Sleeper API
        try {
            const sleeperUserRes = await fetch(`https://api.sleeper.app/v1/players/nfl`);
            if (sleeperUserRes.ok) {
                const masterPlayers = await sleeperUserRes.json();
                if (masterPlayers[pId]) {
                    const p = masterPlayers[pId];
                    name = `${p.first_name} ${p.last_name}`;

                    // Optional: Push it to your cache so it remembers it next time
                    if (global.sleeperCache) {
                        global.sleeperCache.set(pId, { name });
                    }
                }
            }
        } catch (err) {
            console.error(`⚠️ Failed to hot-fetch player ID ${pId} from Sleeper:`, err.message);
        }
    }

    const searchKey = normalizePlayerName(name);

    console.log(`[getDetails] Searching for: "${name}" -> Key: "${searchKey}"`);

    // 2. Find the matching financial profile row in the processed players array
    const pData = players.find((p) => {
        // If dataMapper parsed a name property, use it directly!
        let sheetPlayerName = p.name || p.playerName || "";

        // Unpack the raw row object if it exists
        const rowRef = p.rowRef;

        // Fallback to rowRef if the dataMapper name field wasn't populated
        if (!sheetPlayerName && rowRef) {
            if (rowRef.get) {
                sheetPlayerName = rowRef.get('Player Name') || rowRef.get('player_name') || rowRef.get('name') || "";
            }
            if (!sheetPlayerName && rowRef._rawData && nameIdx < rowRef._rawData.length) {
                sheetPlayerName = rowRef._rawData[nameIdx] || "";
            }
        }

        const sheetKey = normalizePlayerName(sheetPlayerName);

        // 🟢 FIXED: Only trigger the scanner if it's actually a match AND contains your debug name
        if (sheetKey === searchKey && (sheetKey.includes("luke") || searchKey.includes("luke"))) {
            console.log(` 🎯 ACTUAL MATCH FOUND! Sheet: "${sheetPlayerName}" (Key: "${sheetKey}") MATCHED Cache Key: "${searchKey}"`);
        }

        return sheetKey === searchKey;
    });

    // Handle players missing from the sheet layout safely
    if (!pData) {
        return {
            name,
            cap: 0,
            isDeadCap: false,
            text: `• **${name}**: $Unknown (Not in Sheet)`,
        };
    }

    // 3. Extract data cleanly by checking parsed properties first, then falling back to rowRef
    const getCellByValue = (parsedObj, directProp, idx, headerKey) => {
        // Try accessing the cleanly parsed property from dataMapper first
        if (parsedObj[directProp] !== undefined && parsedObj[directProp] !== null) {
            return parsedObj[directProp];
        }

        const rowRef = parsedObj.rowRef;
        if (!rowRef) return "0";

        if (rowRef.get && headerKey) {
            const val = rowRef.get(headerKey);
            if (val !== undefined && val !== null) return val;
        }
        return (rowRef._rawData && idx < rowRef._rawData.length) ? rowRef._rawData[idx] : "0";
    };

    // Looks for pData.salary or pData.capHit, then falls back to column index calculations
    const rawSalary = getCellByValue(pData, 'salary', salaryIdx, 'Cap Hit') || getCellByValue(pData, 'capHit', salaryIdx, 'Cap Hit');
    const cap = parseFloat(String(rawSalary).replace(/[$,]/g, "")) || 0;

    const years = getCellByValue(pData, 'years', yearsIdx, 'Years');

    const rawDeadCap = getCellByValue(pData, 'deadCap', deadCapIdx, 'Dead Cap') || getCellByValue(pData, 'isDeadCap', deadCapIdx, 'Dead Cap');
    const isDeadCap = rawDeadCap === "TRUE" || rawDeadCap === true || rawDeadCap === "checked";

    const rawStructure = getCellByValue(pData, 'structure', notesIdx, 'Contract Structure') || getCellByValue(pData, 'notes', notesIdx, 'Contract Structure');
    const structure = rawStructure && rawStructure !== "0" ? `\n    ┗ 📜 *${rawStructure}*` : "";

    return {
        name,
        cap,
        isDeadCap,
        text: `• **${name}**: $${cap.toLocaleString()} (${years}yrs)${structure}`,
    };
};

async function processAndSend(tx, channel, players, teamMap, config, doc) {
    let title =
        tx.type === "trade"
            ? tx.status === "pending"
                ? "🚨 PENDING TRADE"
                : "🤝 TRADE COMPLETED"
            : "📝 TRANSACTION";
    let color = tx.status === "pending" ? 0xffa500 : 0x2ecc71;
    let needsSalaryPing = false;

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setTimestamp();
    let teamSummaries = {};

    const initTeam = (rId) => {
        const tName = teamMap[rId] || `Team ${rId}`;
        if (!teamSummaries[tName])
            teamSummaries[tName] = { adds: [], drops: [], net: 0, deadCap: 0, rawAddsCap: 0, rawDropsCap: 0 };
        return tName;
    };

    for (const [pId, rId] of Object.entries(tx.adds || {})) {
        const d = await getDetails(pId, players, config);
        const tName = initTeam(rId);
        teamSummaries[tName].adds.push(d.text);
        teamSummaries[tName].net -= d.cap;
        teamSummaries[tName].rawAddsCap += d.cap;
        if (d.cap === 0) needsSalaryPing = true;
    }

    for (const [pId, rId] of Object.entries(tx.drops || {})) {
        const d = await getDetails(pId, players, config);
        const tName = initTeam(rId);
        teamSummaries[tName].drops.push(d.text);
        teamSummaries[tName].net += d.cap;
        teamSummaries[tName].rawDropsCap += d.cap;
        if (d.isDeadCap) teamSummaries[tName].deadCap += d.cap;
    }

    const mapping = config?.column_mapping || config?.settings || config;

    for (const [tName, data] of Object.entries(teamSummaries)) {
        let desc =
            (data.adds.length ? `✅ **In:**\n${data.adds.join("\n")}\n` : "") +
            (data.drops.length ? `📤 **Out:**\n${data.drops.join("\n")}\n` : "");

        if (needsSalaryPing) desc += `⚠️ **NOTICE:** Missing salary data.\n`;

        // 📊 Fetch sheet balance figures dynamically if spreadsheet document connection is present
        if (doc) {
            const sh = doc.sheetsByIndex.find((s) =>
                s.title.toLowerCase().includes(tName.toLowerCase())
            );

            if (sh) {
                try {
                    const capCellA1 = mapping?.team_cap || mapping?.cap_space_cell
                    
                    await sh.loadCells(capCellA1);

                    const currentCap = parseFloat(
                        (sh.getCellByA1(capCellA1).formattedValue || "0")
                        .replace(/[$,]/g, "")
                    ) || 0;

                    // Net math matching how salary pools shift
                    // Incoming players subtract cap space, outgoing players add cap space back
                    const projectedCap = currentCap - data.rawAddsCap + data.rawDropsCap;

                    desc += `\n**Cap Space Balance:**\n`;
                    desc += `• Before: **$${currentCap.toLocaleString()}**\n`;
                    desc += `• After: **$${projectedCap.toLocaleString()}**\n`;
                } catch (capErr) {
                    console.error(`⚠️ Failed evaluating current cell metrics for ${tName}:`, capErr.message);
                }
            }
        }

        embed.addFields({
            name: `🏟️ ${tName.toUpperCase()}`,
            value: desc || "No player movement",
            inline: false,
        });
    }

    let calculatedType = tx.type; 
    if (tx.type === "waiver" || tx.type === "free_agent") {
        const hasAdds = Object.keys(tx.adds || {}).length > 0;
        const hasDrops = Object.keys(tx.drops || {}).length > 0;

        if (hasAdds) {
            calculatedType = "add";
        } else if (hasDrops) {
            calculatedType = "drop"; 
        }
    }

    const mockTxn = {
        type: calculatedType,
        player_id: Object.keys(tx.adds || {})[0] || Object.keys(tx.drops || {})[0] || "unknown"
    };

    const actionRow = createTransactionActionRow(mockTxn, config);

    const messagePayload = { embeds: [embed] };
    if (actionRow) {
        messagePayload.components = [actionRow];
    }

    await channel.send(messagePayload);

    if (needsSalaryPing && config?.audit_ping_role_id) {
        await channel.send(
            `⚠️ <@&${config.audit_ping_role_id}> **Missing Salary Alert:** A transaction occurred with $0.00 salary in the sheets.`
        );
    }
}

module.exports = { processAndSend };