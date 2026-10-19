const { supabase } = require("../supabaseClient.js");

function parseSalaryInput(val) {
    if (typeof val === 'number') return val;
    if (!val || typeof val !== 'string') return 0;

    const cleaned = val.trim().toUpperCase().replace(/[\$,]/g, '');
    if (cleaned.endsWith('M')) return (parseFloat(cleaned.replace('M', '')) || 0) * 1000000;
    if (cleaned.endsWith('K')) return (parseFloat(cleaned.replace('K', '')) || 0) * 1000;
    const num = parseFloat(cleaned) || 0;
    return num > 0 && num < 1000 ? num * 1000000 : num;
}

/**
 * Single source of truth: Upsert bid directly into Supabase (contract_offers)
 */
async function recordBid(guildId, teamName, bidData) {
    const { playerName, aav, years, bonuses, notes, pos } = bidData;

    const parsedAav = parseSalaryInput(aav);
    const parsedYears = parseInt(years, 10) || 1;
    const totalVal = parsedAav * parsedYears;

    // Check for existing pending offer for this player + team
    const { data: existingBids, error: fetchErr } = await supabase
        .from('contract_offers')
        .select('id')
        .ilike('to_player', playerName.trim())
        .ilike('from_team', teamName.trim())
        .eq('guild_id', String(guildId))
        .eq('status', 'PENDING');

    if (fetchErr) throw fetchErr;

    let actionTaken = 'inserted';
    const offerPayload = {
        guild_id: String(guildId),
        from_team: teamName.trim(),
        to_player: playerName.trim(),
        pos: pos || 'N/A',
        years: parsedYears,
        aav: parsedAav,
        bonuses: bonuses || null,
        notes: notes || null,
        status: 'PENDING'
    };

    if (existingBids && existingBids.length > 0) {
        const { error: updateErr } = await supabase
            .from('contract_offers')
            .update(offerPayload)
            .eq('id', existingBids[0].id);

        if (updateErr) throw updateErr;
        actionTaken = 'updated';
    } else {
        const offerId = `OFF-${Date.now().toString().slice(-6)}`;
        const { error: insertErr } = await supabase
            .from('contract_offers')
            .insert([{ ...offerPayload, offer_id: offerId }]);

        if (insertErr) throw insertErr;
    }

    const activeTeamBids = await fetchTeamBids(guildId, teamName);

    return { 
        success: true, 
        action: actionTaken, 
        teamBidCount: activeTeamBids.length 
    };
}

/**
 * Fetch active pending bids for a specific team
 */
async function fetchTeamBids(guildId, teamName) {
    if (!teamName) return [];

    const cleanedTeam = teamName.trim();

    // Query all PENDING bids matching the team name across the table
    const { data, error } = await supabase
        .from('contract_offers')
        .select('*')
        .ilike('from_team', `%${cleanedTeam}%`)
        .eq('status', 'PENDING');

    if (error) {
        console.error('Error fetching team bids:', error);
        return [];
    }

    return (data || []).map(row => ({
        id: row.id,
        timestamp: new Date(row.created_at || Date.now()).toLocaleString("en-US", { timeZone: "America/New_York" }),
        teamName: row.from_team,
        playerName: row.to_player,
        aav: Number(row.aav) || 0,
        years: Number(row.years || row.length) || 1,
        totalValue: Number(row.total_value) || 0,
        bonuses: row.bonuses || "N/A",
        notes: row.notes || "None"
    }));
}

/**
 * Fetch total number of submitted pending bids across the entire league
 */
async function fetchTotalBidsCount(guildId) {
    const { count, error } = await supabase
        .from('contract_offers')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'PENDING');

    if (error) {
        console.error('Error fetching total bids count:', error);
        return 0;
    }

    return count || 0;
}

/**
 * Remove/Cancel an active bid directly from Supabase
 */
async function removeBid(guildId, teamName, playerName) {
    if (!teamName || !playerName) return { success: false };

    const cleanedTeam = teamName.trim();
    const cleanedPlayer = playerName.trim();

    // Delete directly matching team, player, and PENDING status
    const { data, error } = await supabase
        .from('contract_offers')
        .delete()
        .ilike('from_team', `%${cleanedTeam}%`)
        .ilike('to_player', cleanedPlayer)
        .eq('status', 'PENDING')
        .select();

    if (error) {
        console.error('Error removing bid from Supabase:', error);
        return { success: false };
    }

    const deletedCount = data ? data.length : 0;
    console.log(`[FA REMOVE BID] Deleted ${deletedCount} row(s) for ${cleanedPlayer} (${cleanedTeam})`);

    return { success: deletedCount > 0 };
}

module.exports = {
    recordBid,
    fetchTeamBids,
    fetchTotalBidsCount,
    removeBid,

    // Legacy wrappers matching faEngine call signatures
    recordBidInSheet: (sheetId, sheetTab, bidData) => recordBid(bidData.guildId || "default", bidData.teamName, bidData),
    removeBidFromSheet: (sheetId, sheetTab, teamName, playerName) => removeBid("default", teamName, playerName)
};