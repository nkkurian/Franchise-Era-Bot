const express = require("express");
require('dotenv').config();
const router = express.Router();
const { recordBid, fetchTeamBids, removeBid } = require("../utils/FreeAgency/bidsService");
const { supabase } = require("../utils/supabaseClient");
const { sendBidStatusEmbed, sendDirectTeamAlert } = require('../utils/discordNotifier');


// 1. JSON API ENDPOINTS (For Web Portal Dashboard & AJAX)

// POST /api/offers - Submit or update a bid directly in Supabase
router.post("/api/offers", async (req, res) => {
    try {
        const { playerName, teamName, guildId, aav, years, bonuses, notes, pos } = req.body;

        if (!playerName || !teamName || !aav) {
            return res.status(400).json({ error: "Player name, team name, and AAV are required." });
        }

        // Fetch target guild configuration from Supabase (relying solely on guild_id & fa_enabled)
        let config = null;
        if (guildId) {
            const { data } = await supabase
                    .from("league_configs")
                    .select("guild_id, fa_enabled, max_bids_per_team, agent_role_id, agent_assignment_mode, agent_position_map, log_channel_id")
                    .eq("guild_id", guildId)
                    .limit(1)
                    .maybeSingle();
                config = data;
            }

            if (!config) {
                return res.status(500).json({ error: "League configuration not found in Supabase." });
            }

            if (config.fa_enabled === false) {
                return res.status(403).json({ error: "Free Agency bidding is currently closed." });
            }

        const maxBidsLimit = Number(config.max_bids_per_team);
        if (Number.isFinite(maxBidsLimit) && maxBidsLimit > 0) {
            const { data: existingPending } = await supabase
                .from("contract_offers")
                .select("id")
                .eq("guild_id", config.guild_id)
                .ilike("from_team", teamName.trim())
                .ilike("to_player", playerName.trim())
                .eq("status", "PENDING")
                .limit(1);

            const isRevisingExistingBid = existingPending && existingPending.length > 0;

            if (!isRevisingExistingBid) {
                const { count: activeBidCount, error: countErr } = await supabase
                    .from("contract_offers")
                    .select("*", { count: "exact", head: true })
                    .eq("guild_id", config.guild_id)
                    .ilike("from_team", teamName.trim())
                    .eq("status", "PENDING");

                if (!countErr && (activeBidCount || 0) >= maxBidsLimit) {
                    return res.status(400).json({
                        error: `Bid limit reached (${activeBidCount}/${maxBidsLimit} active bids). Wait for a pending offer to resolve before submitting another.`
                    });
                }
            }
        }

            // Delegate directly to Supabase via bidsService
            const result = await recordBid(config.guild_id, teamName, {
                playerName,
                aav,
                years,
                bonuses,
                notes,
                pos
            });

            // Inherit or auto-assign agent across all offers for this player (excluding self-bid conflicts)
            const cleanPlayer = playerName.trim();
            const { data: existingPlayerOffers } = await supabase
                .from("contract_offers")
                .select("*")
                .eq("guild_id", config.guild_id)
                .ilike("to_player", cleanPlayer);

        const bidders = new Set(
            (existingPlayerOffers || [])
                .filter(o => String(o.status || "PENDING").toUpperCase() !== "WITHDRAWN")
                .map(o => String(o.from_team || "").toLowerCase().trim())
                .filter(Boolean)
        );
            bidders.add(teamName.toLowerCase().trim());

            const existingAssigned = (existingPlayerOffers || []).find(o => o.agent_discord_id);
            let targetAgentLabel = existingAssigned?.agent_assigned || "@Commissioner";
            let targetAgentId = existingAssigned?.agent_discord_id || null;

            // Check if existing agent now has a self-bid conflict via user_team_links
            if (targetAgentId) {
                const { data: agentLink } = await supabase
                    .from("user_team_links")
                    .select("team_name")
                    .eq("guild_id", config.guild_id)
                    .eq("discord_id", targetAgentId)
                    .maybeSingle();

                if (agentLink?.team_name && bidders.has(String(agentLink.team_name).toLowerCase().trim())) {
                    targetAgentLabel = "@Commissioner";
                    targetAgentId = null;
                }
            }

            // Auto-assign if unassigned and mode is 'random' or 'position'
            const mode = config.agent_assignment_mode || "manual";
            if (!targetAgentId && config.agent_role_id && (mode === "random" || mode === "position")) {
                const client = getDiscordClient(req);
                const guild = client?.guilds?.cache?.get(config.guild_id);
                if (guild) {
                    await guild.members.fetch().catch(() => {});
                    const { data: allLinks } = await supabase
                        .from("user_team_links")
                        .select("discord_id, team_name")
                        .eq("guild_id", config.guild_id);

                    const teamByDiscordId = {};
                    (allLinks || []).forEach(l => {
                        if (l.discord_id && l.team_name) {
                            teamByDiscordId[String(l.discord_id)] = String(l.team_name).toLowerCase().trim();
                        }
                    });

                    const conflictFreeAgents = guild.members.cache
                        .filter(m => !m.user.bot && m.roles.cache.has(config.agent_role_id))
                        .map(m => ({ discordId: m.user.id, username: m.displayName || m.user.username }))
                        .filter(a => !teamByDiscordId[a.discordId] || !bidders.has(teamByDiscordId[a.discordId]));

                    const existingPos = (existingPlayerOffers || []).find(o => o.position || o.pos);
                    const effectivePos = String(pos || existingPos?.position || existingPos?.pos || "").trim();

                    let picked = null;
                    if (mode === "position" && effectivePos) {
                        const mappedId = resolvePositionAgentId(config.agent_position_map || {}, effectivePos);
                        picked = conflictFreeAgents.find(a => a.discordId === mappedId) || null;
                    } else if (mode === "random" && conflictFreeAgents.length > 0) {
                        picked = conflictFreeAgents[Math.floor(Math.random() * conflictFreeAgents.length)];
                    }

                    if (picked) {
                        targetAgentLabel = `@${picked.username}`;
                        targetAgentId = picked.discordId;
                    }
                }
            }

            await supabase
                .from("contract_offers")
                .update({ agent_assigned: targetAgentLabel, agent_discord_id: targetAgentId })
                .eq("guild_id", config.guild_id)
                .ilike("to_player", cleanPlayer);

        try {
                const logChannelId = config.log_channel_id;
                if (logChannelId) {
                    const client = getDiscordClient(req);
                    const logChannel =
                        client?.channels?.cache?.get(logChannelId) ||
                        (await client?.channels?.fetch(logChannelId).catch(() => null));

                    if (logChannel && typeof logChannel.send === "function") {
                        const isRevised = result.action === "updated";
                        const agentMention = targetAgentId ? `<@${targetAgentId}>` : (targetAgentLabel || "@Commissioner");

                        await logChannel.send({
                            embeds: [
                                {
                                    color: isRevised ? 0xf59e0b : 0x06b6d4,
                                    title: isRevised ? "📝 Free Agency Offer Revised" : "📩 New Free Agency Offer Submitted",
                                    description: `**${teamName.trim()}** has ${isRevised ? "updated their contract offer for" : "submitted a contract offer to"} **${cleanPlayer}**.`,
                                    fields: [
                                        { name: "Franchise", value: teamName.trim(), inline: true },
                                        { name: "Target Player", value: cleanPlayer, inline: true },
                                        { name: "Assigned Agent", value: agentMention, inline: true }
                                    ],
                                    footer: { text: "Contract terms are confidential • View details in the Master Offers Log" },
                                    timestamp: new Date().toISOString()
                                }
                            ]
                        });
                    }
                }
            } catch (logErr) {
                console.warn("⚠️ Failed to send FA log channel notification:", logErr.message);
            }

            return res.json({
            success: true, 
            action: result.action, 
            activeBidsCount: result.teamBidCount 
        });

            return res.json({
            success: true, 
            action: result.action, 
            activeBidsCount: result.teamBidCount 
        });

    } catch (err) {
        console.error("❌ Web offer submission failed:", err.message);
        return res.status(500).json({ error: err.message || "Failed to submit offer." });
    }
});

// DELETE /api/offers - Withdraw a bid directly from Supabase
router.delete("/api/offers", async (req, res) => {
    try {
        const { teamName, playerName } = req.body;

        if (!teamName || !playerName) {
            return res.status(400).json({ error: "Team name and player name are required." });
        }

        const { data: config } = await supabase
            .from("league_configs")
            .select("guild_id")
            .limit(1)
            .single();

        const result = await removeBid(config?.guild_id || "default", teamName, playerName);

        if (!result.success) {
            return res.status(400).json({ error: "Could not find active offer to withdraw." });
        }

        return res.json({ success: true, message: "Offer withdrawn successfully." });

    } catch (err) {
        console.error("❌ Web offer withdraw failed:", err.message);
        return res.status(500).json({ error: "Failed to withdraw offer." });
    }
});

// -------------------------------------------------------------------
// 2. STANDALONE MOBILE FORM (Serves /fa and processes /api/fa/bid)
// -------------------------------------------------------------------

// GET: Serve Hybrid Glassmorphic Mobile-First Free Agency Form
router.get("/fa", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Free Agency Hub</title>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
                :root {
                    --bg-main: #07090E;
                    --card-bg: rgba(15, 23, 42, 0.75);
                    --card-border: rgba(51, 65, 85, 0.6);
                    --input-bg: rgba(2, 6, 23, 0.8);
                    --input-border: rgba(51, 65, 85, 0.8);
                    --accent-cyan: #06B6D4;
                    --accent-glow: rgba(6, 182, 212, 0.25);
                    --text-primary: #F8FAFC;
                    --text-secondary: #94A3B8;
                    --text-muted: #64748B;
                }
            
                * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
            
                body {
                    background-color: var(--bg-main);
                    background-image: 
                        radial-gradient(at 0% 0%, rgba(6, 182, 212, 0.08) 0px, transparent 50%),
                        radial-gradient(at 100% 100%, rgba(16, 185, 129, 0.05) 0px, transparent 50%);
                    color: var(--text-primary);
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    padding: 20px 16px;
                }
            
                .hub-container {
                    width: 100%;
                    max-width: 500px;
                    background: var(--card-bg);
                    backdrop-filter: blur(20px);
                    -webkit-backdrop-filter: blur(20px);
                    border: 1px solid var(--card-border);
                    border-radius: 20px;
                    padding: 28px;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
                }
            
                /* Header Strip */
                .header-strip {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 24px;
                    padding-bottom: 12px;
                    border-b: 1px solid rgba(255, 255, 255, 0.05);
                }
            
                .badge-status {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    background: rgba(16, 185, 129, 0.1);
                    border: 1px solid rgba(16, 185, 129, 0.25);
                    color: #34D399;
                    padding: 4px 12px;
                    border-radius: 99px;
                    font-size: 11px;
                    font-weight: 700;
                    letter-spacing: 0.5px;
                }
            
                .status-dot {
                    width: 6px;
                    height: 6px;
                    background-color: #34D399;
                    border-radius: 50%;
                    box-shadow: 0 0 10px #34D399;
                }
            
                .badge-league {
                    color: var(--text-muted);
                    font-size: 11px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }
            
                h1 {
                    font-size: 24px;
                    font-weight: 800;
                    letter-spacing: -0.5px;
                    margin-bottom: 24px;
                    text-align: center;
                    background: linear-gradient(135deg, #FFFFFF 0%, #94A3B8 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
            
                /* Form Inputs */
                .form-section-title {
                    font-size: 10px;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 1.2px;
                    color: var(--accent-cyan);
                    margin: 20px 0 10px 2px;
                }
            
                .field-group {
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                }
            
                .input-wrapper {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }
            
                label {
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--text-secondary);
                }
            
                input, select, textarea {
    width: 100%;
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: 10px;
    padding: 12px 14px;
    color: #FFF;
    font-size: 14px;
    outline: none;
    transition: all 0.2s ease-in-out;
    }
    
    input, select {
        height: 46px;
        padding: 0 14px;
    }
    
    textarea {
        resize: vertical;
        min-height: 80px;
    }
    
    input:focus, select:focus, textarea:focus {
        border-color: var(--accent-cyan);
        box-shadow: 0 0 0 3px var(--accent-glow);
    }
    
    input::placeholder, textarea::placeholder { color: #475569; }
            
                /* Live Preview Card */
                .projection-card {
                    background: rgba(2, 6, 23, 0.6);
                    border: 1px solid var(--card-border);
                    border-radius: 14px;
                    padding: 16px;
                    margin: 24px 0 20px 0;
                }
            
                .projection-header {
                    font-size: 10px;
                    font-weight: 800;
                    color: var(--text-muted);
                    letter-spacing: 0.8px;
                    margin-bottom: 8px;
                    display: flex;
                    justify-content: space-between;
                }
            
                .projection-player {
                    font-size: 17px;
                    font-weight: 800;
                    color: #FFF;
                    margin-bottom: 12px;
                }
            
                .projection-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 12px;
                    background: rgba(15, 23, 42, 0.8);
                    padding: 12px;
                    border-radius: 10px;
                    border: 1px solid rgba(255, 255, 255, 0.03);
                }
            
                .stat-box { display: flex; flex-direction: column; gap: 2px; }
                .stat-label { font-size: 9px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
                .stat-val { font-size: 16px; font-weight: 800; color: #34D399; }
            
                /* Submit Button */
                button[type="submit"] {
                    width: 100%;
                    height: 50px;
                    background: linear-gradient(135deg, #0891B2 0%, #0E7490 100%);
                    border: none;
                    border-radius: 12px;
                    color: #FFF;
                    font-size: 14px;
                    font-weight: 700;
                    cursor: pointer;
                    box-shadow: 0 4px 16px rgba(6, 182, 212, 0.3);
                    transition: transform 0.15s ease, box-shadow 0.2s ease, background 0.2s ease;
                } 
            
                button[type="submit"]:hover {
                    background: linear-gradient(135deg, #06B6D4 0%, #0891B2 100%);
                    box-shadow: 0 6px 20px rgba(6, 182, 212, 0.45);
                }
            
                button[type="submit"]:active { transform: scale(0.98); }
            </style>
        </head>
            <body class="p-4 md:p-8 flex justify-center items-center min-h-screen">

                <!-- Center Card Container (Fixed Max Width for Desktop & Mobile) -->
                <div class="w-full max-w-md bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">

                    <!-- Header Strip -->
                    <div class="flex justify-between items-center pb-4 border-b border-slate-800/80">
                        <div class="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 rounded-full text-emerald-400 text-xs font-bold">
                            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> BIDDING OPEN
                        </div>
                        <span class="text-xs font-bold text-slate-500 uppercase tracking-widest">Franchise Pro</span>
                    </div>

                    <h1 class="text-2xl font-extrabold text-center bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                        🏈 Free Agency Portal
                    </h1>

                    <!-- 1. Offer Submission Form (TOP) -->
                    <form action="/api/fa/bid" method="POST" class="space-y-4 text-xs">
                        <div class="text-[10px] font-extrabold uppercase tracking-widest text-cyan-400 mb-2">Contract Offer Details</div>

                        <div>
                            <label for="playerName" class="block text-slate-300 font-semibold mb-1">Target Player Name</label>
                            <input type="text" id="playerName" name="playerName" placeholder="e.g. Colston Loveland" required 
                                   class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors" />
                        </div>

                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label for="salary" class="block text-slate-300 font-semibold mb-1">Base Salary ($)</label>
                                <input type="text" id="salary" name="salary" inputmode="decimal" placeholder="e.g. 12.5M" required 
                                       class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors" />
                            </div>
                            <div>
                                <label for="years" class="block text-slate-300 font-semibold mb-1">Contract Duration</label>
                                <select id="years" name="years" required 
                                        class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors">
                                    <option value="1">1 Year</option>
                                    <option value="2">2 Years</option>
                                    <option value="3">3 Years</option>
                                    <option value="4">4 Years</option>
                                    <option value="5">5 Years</option>
                                </select>
                            </div>
                        </div>

                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label for="guaranteed" class="block text-slate-300 font-semibold mb-1">Guaranteed Money ($)</label>
                                <input type="text" id="guaranteed" name="guaranteed" inputmode="decimal" placeholder="e.g. 5M" 
                                       class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors" />
                            </div>
                            <div>
                                <label for="bonus" class="block text-slate-300 font-semibold mb-1">Signing Bonus ($)</label>
                                <input type="text" id="bonus" name="bonus" inputmode="decimal" placeholder="e.g. 2M" 
                                       class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors" />
                            </div>
                        </div>

                        <div>
                            <label for="notes" class="block text-slate-300 font-semibold mb-1">Notes / Message to Agent</label>
                            <textarea id="notes" name="notes" rows="2" placeholder="e.g. Starting role guaranteed..." 
                                      class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500 transition-colors"></textarea>
                        </div>

                        <button type="submit" class="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg transition duration-200 shadow-lg shadow-cyan-500/20">
                            ⚡ Submit Free Agency Offer
                        </button>
                    </form>

                    <!-- 2. Franchise Identity & Cap Breakdown Card (BOTTOM) -->
                    <div class="bg-slate-950/60 border border-slate-800/90 rounded-xl p-5 space-y-4">
                        <div class="flex justify-between items-center">
                            <div>
                                <span class="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Franchise Identity</span>
                                <h2 id="cardTeamName" class="text-2xl font-bold text-white">Loading Team...</h2>
                            </div>
                            <span id="linkBadge" class="px-2.5 py-1 text-[11px] font-bold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                LINKED
                            </span>
                        </div>

                        <!-- Financial Breakdown Grid -->
                        <div class="grid grid-cols-3 gap-2 bg-slate-900/80 p-3 rounded-lg border border-slate-800">
                            <div>
                                <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Cap Available</p>
                                <p id="statCapAvailable" class="text-sm font-bold text-emerald-400">$0.00</p>
                            </div>
                            <div>
                                <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Projected Cap</p>
                                <p id="statProjectedCap" class="text-sm font-bold text-blue-400">$0.00</p>
                            </div>
                            <div>
                                <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Active Bids</p>
                                <p id="statActiveBids" class="text-sm font-bold text-purple-400">0 Bids</p>
                            </div>
                        </div>

                        <!-- Current Deal Impact -->
                        <div class="bg-slate-900/50 p-3.5 rounded-lg border border-slate-800/70 space-y-2">
                            <div class="grid grid-cols-2 gap-2">
                                <div>
                                    <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Target Player</p>
                                    <p id="previewPlayer" class="text-xs font-bold text-white truncate">Select Player</p>
                                </div>
                                <div>
                                    <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Offer AAV</p>
                                    <p id="previewAAV" class="text-xs font-bold text-emerald-400">$0.00</p>
                                </div>
                            </div>
                            <div class="pt-2 border-t border-slate-800/80">
                                <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Cap Space After Deal</p>
                                <p id="statCapAfterCurrentDeal" class="text-sm font-extrabold text-amber-400">$0.00</p>
                            </div>
                        </div>

                        <button id="authBtn" type="button" onclick="loginWithDiscord()" class="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition duration-200">
                            Connect Discord Account
                        </button>
                    </div>

                </div>
                <script>
                    function loginWithDiscord() {
                        const clientId = "${process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID}";
                        const redirectUri = encodeURIComponent(window.location.origin + "/auth/discord/callback");
                        const scope = encodeURIComponent("identify guilds.members.read");

                        window.location.href = "https://discord.com/api/oauth2/authorize?client_id=" + clientId + "&redirect_uri=" + redirectUri + "&response_type=code&scope=" + scope;
                    }
                </script>
                <script src="/app.js"></script>
            </body>
        </html>
    `);
});

router.post("/api/fa/bid", async (req, res) => {
    try {
        // 1. Safely extract and sanitize form inputs
        const playerName = (req.body.playerName || "").trim();
        const salary = (req.body.salary || "").trim();
        const guaranteed = (req.body.guaranteed || "").trim();
        const bonus = (req.body.bonus || "").trim();
        const years = (req.body.years || "1").trim();
        const notes = (req.body.notes || "").trim();
        const discordId = (req.body.discordId || "").trim();

        if (!playerName || !salary) {
            return res.status(400).send("<h3>❌ Target Player Name and Base Salary are required.</h3>");
        }

        // 2. Fetch active guild config
        const { data: config } = await supabase
            .from("league_configs")
            .select("guild_id")
            .eq("fa_enabled", true)
            .limit(1)
            .single();

        const guildId = config?.guild_id || "default";

        // 3. Dynamic team name lookup via user_team_links
        let teamName = (req.body.teamName || "").trim();

        if (!teamName && discordId) {
            const { data: userLink } = await supabase
                .from("user_team_links")
                .select("team_name")
                .eq("discord_id", discordId)
                .single();

            if (userLink?.team_name) {
                teamName = userLink.team_name;
            }
        }

        // Fallback to prevent recordBid from crashing on missing teamName
        if (!teamName) {
            teamName = "Unlinked GM";
        }

        const parsedYears = parseInt(years, 10) || 1;

        // 4. Submit to database with guaranteed non-null strings
        const result = await recordBid(guildId, teamName, {
            playerName,
            aav: salary,
            years: parsedYears,
            bonuses: bonus || guaranteed || null,
            notes: notes || null
        });

        if (result && result.success) {
            const isUpdate = result.action === 'updated';
            let parsedAav = parseFloat(String(salary).replace(/[\$,]/g, '')) || 0;
            if (String(salary).toUpperCase().endsWith('M')) parsedAav *= 1000000;
            if (parsedAav > 0 && parsedAav < 1000) parsedAav *= 1000000;
            const totalVal = parsedAav * parsedYears;

            return res.send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Bid Submitted</title>
                    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
                    <style>
                        body { background: #0B0E14; color: #FFF; font-family: 'Inter', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; margin: 0; }
                        .card { background: rgba(22, 27, 34, 0.85); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 20px; padding: 32px; text-align: center; max-width: 400px; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
                        .icon { font-size: 48px; margin-bottom: 16px; }
                        h2 { font-size: 22px; font-weight: 800; color: #10B981; margin-bottom: 8px; }
                        p { font-size: 14px; color: #9CA3AF; margin-bottom: 24px; line-height: 1.5; }
                        .details { background: rgba(0,0,0,0.3); padding: 16px; border-radius: 10px; margin-bottom: 24px; text-align: left; }
                        .row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px; }
                        .row:last-child { margin-bottom: 0; }
                        .label { color: #9CA3AF; }
                        .val { font-weight: 700; color: #FFF; }
                        a { display: inline-block; width: 100%; padding: 14px; background: #2563EB; border-radius: 10px; color: #FFF; font-weight: 700; text-decoration: none; font-size: 14px; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <div class="icon">${isUpdate ? "🔄" : "✅"}</div>
                        <h2>${isUpdate ? "Bid Updated!" : "Offer Submitted!"}</h2>
                        <p>Your contract offer for <strong>${playerName}</strong> has been logged for <strong>${teamName}</strong>.</p>

                        <div class="details">
                            <div class="row"><span class="label">Annual AAV:</span><span class="val">$${parsedAav.toLocaleString()}</span></div>
                            <div class="row"><span class="label">Contract Length:</span><span class="val">${parsedYears} Year(s)</span></div>
                            <div class="row"><span class="label">Total Contract:</span><span class="val" style="color:#10B981;">$${totalVal.toLocaleString()}</span></div>
                        </div>

                        <a href="/fa">Submit Another Offer</a>
                    </div>
                </body>
                </html>
            `);
        } else {
            return res.status(400).send(`
                <body style="background:#0B0E14; color:#FFF; font-family:sans-serif; text-align:center; padding-top:50px;">
                    <h2 style="color:#EF4444;">❌ Error Processing Bid</h2>
                    <p style="color:#9CA3AF;">Unable to save bid to Supabase.</p>
                    <br><a href="/fa" style="color:#3B82F6;">Back to Form</a>
                </body>
            `);
        }
    } catch (err) {
        console.error("Web FA Bid Error:", err);
        return res.status(500).send("<h3>❌ Server Error submitting bid.</h3>");
    }
});

router.get("/auth/discord/callback*", async (req, res) => {
            console.log("====================================");
            console.log("🚀 DISCORD CALLBACK ROUTE TRIGGERED");
            console.log("Query Params:", req.query);
            console.log("====================================");

            const code = req.query.code;

            if (!code) {
                console.log("❌ No code parameter in request.");
                return res.status(400).send("No authorization code provided from Discord.");
            }

            try {
                const clientId = process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID;
                const clientSecret = process.env.CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET;

                // Clean host and protocol for exact redirect match
                const hostHeader = (req.get('x-forwarded-host') || req.get('host') || "").split(',')[0].trim();
                const cleanHost = hostHeader.replace(/:5000$/, '');
                const protocol = req.get('x-forwarded-proto') || 'https';
                const redirectUri = `${protocol}://${cleanHost}/auth/discord/callback`;

                // 1. Exchange OAuth Code for Access Token
                const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        client_id: clientId,
                        client_secret: clientSecret,
                        grant_type: "authorization_code",
                        code: String(code),
                        redirect_uri: redirectUri,
                    }),
                });

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            console.error("❌ [OAuth Token Exchange Error]:", tokenData);
            return res.status(400).send(`OAuth Error: ${tokenData.error_description || tokenData.error}`);
        }

        // 2. Fetch Discord Profile
        const userResponse = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });

        const userData = await userResponse.json();
        if (!userData || !userData.id) {
            console.error("❌ Failed to resolve user identity:", userData);
            return res.status(500).send("Unable to retrieve user profile from Discord.");
        }

        console.log(`👤 Authenticated User: ${userData.username} (${userData.id})`);

        // 3. Safely Query Supabase for active league (fa_enabled = true)
                let activeGuildId = null;
                try {
                    if (supabase) {
                        // Fetch all configured leagues (prioritizing fa_enabled = true)
                        const { data: configuredLeagues, error: leagueErr } = await supabase
                            .from("league_configs")
                            .select("guild_id, fa_enabled")
                            .order("fa_enabled", { ascending: false });

                        if (leagueErr) {
                            console.warn("⚠️ Error querying league_configs:", leagueErr.message);
                        } else if (Array.isArray(configuredLeagues) && configuredLeagues.length > 0) {
                            // Check which Discord servers the user belongs to (requires 'guilds' scope)
                            const guildsRes = await fetch("https://discord.com/api/users/@me/guilds", {
                                headers: { Authorization: `Bearer ${tokenData.access_token}` },
                            });

                            if (guildsRes.ok) {
                                const userGuilds = await guildsRes.json();
                                const userGuildIds = new Set(userGuilds.map(g => String(g.id)));
                                const matchedLeague = configuredLeagues.find(l => userGuildIds.has(String(l.guild_id)));
                                if (matchedLeague) {
                                    activeGuildId = matchedLeague.guild_id;
                                }
                            }

                            // Fallback to primary configured league if guilds scope wasn't granted
                            if (!activeGuildId) {
                                activeGuildId = configuredLeagues[0].guild_id;
                            }

                            console.log(`🏆 League Resolved: ${activeGuildId}`);
                        }
                    }
                } catch (cfgErr) {
                    console.warn("⚠️ Exception resolving league:", cfgErr.message);
                }

        // 4. Safely Lookup Guild Roles
                let matchedTeam = "Free Agent";

                if (activeGuildId) {
                    try {
                        const memberResponse = await fetch(`https://discord.com/api/users/@me/guilds/${activeGuildId}/member`, {
                            headers: { Authorization: `Bearer ${tokenData.access_token}` },
                        });

                        if (memberResponse.ok) {
                            const memberData = await memberResponse.json();
                            const userRoleIds = memberData.roles || [];

                            // Read the sleeper_team_roles JSON object from league_configs
                            const { data: configData } = await supabase
                                .from("league_configs")
                                .select("sleeper_team_roles")
                                .eq("guild_id", activeGuildId)
                                .single();

                            if (configData?.sleeper_team_roles) {
                                // Iterate over the JSONB map values: { "roleId": "...", "teamName": "..." }
                                const teamRoleList = Object.values(configData.sleeper_team_roles);

                                const foundTeam = teamRoleList.find(tr => userRoleIds.includes(tr.roleId));
                                if (foundTeam) {
                                    matchedTeam = foundTeam.teamName || foundTeam.roleName;
                                }
                            }
                        } else {
                            console.warn(`⚠️ Member query returned HTTP ${memberResponse.status} for Guild: ${activeGuildId}`);
                        }
                    } catch (roleErr) {
                        console.warn("⚠️ Non-fatal role lookup error:", roleErr.message);
                    }
                }

        // 5. Safely Upsert into user_team_links
        try {
            if (supabase) {
                const { error: upsertErr } = await supabase
                    .from("user_team_links")
                    .upsert({
                        discord_id: String(userData.id),
                        username: userData.username || "Franchise GM",
                        team_name: matchedTeam,
                        guild_id: activeGuildId || null,
                        updated_at: new Date().toISOString()
                    }, { onConflict: "discord_id" });

                if (upsertErr) {
                    console.error("❌ Supabase Link Upsert Error:", upsertErr.message);
                } else {
                    console.log(`💾 Link Saved: ${userData.username} -> ${matchedTeam} (${activeGuildId})`);
                }
            }
        } catch (dbErr) {
            console.error("❌ Database Upsert Exception:", dbErr.message);
        }

        // 6. Complete Redirect to /fa
                const returnTo = (req.query.state && String(req.query.state).startsWith('/'))
                    ? req.query.state
                    : '/';

                const redirectParams = new URLSearchParams({
                    discordId: String(userData.id),
                    username: userData.username || "Franchise GM",
                    avatar: userData.avatar || "",
                    teamName: matchedTeam || "Free Agent",
                    guildId: activeGuildId || ""
                });

                return res.redirect(`${returnTo}?${redirectParams.toString()}`);

    } catch (err) {
        console.error("💥 Fatal Uncaught Callback Exception:", err.stack || err);
        return res.status(500).send("Authentication server error.");
    }
});

// GET /api/user/franchise-identity
router.get("/api/user/franchise-identity", async (req, res) => {
    try {
        const { discordId } = req.query;

        if (!discordId) {
            return res.json({ linked: false, message: "No Discord ID provided." });
        }

        // Updated table reference to user_team_links
        const { data: userLink, error } = await supabase
            .from("user_team_links")
            .select("team_name, username, guild_id")
            .eq("discord_id", discordId)
            .single();

        if (error || !userLink) {
            return res.json({
                linked: false,
                teamName: "No Team Linked",
                username: "Unlinked User",
                capStatus: "Unauthenticated"
            });
        }

        return res.json({
            linked: true,
            teamName: userLink.team_name,
            username: userLink.username || "Franchise GM",
            capStatus: "Cap Verified"
        });
    } catch (err) {
        console.error("Identity lookup failed:", err);
        return res.status(500).json({ linked: false, error: "Server error checking user identity." });
    }
});

// for player card
router.get("/api/team-financials", async (req, res) => {
    try {
        const { teamName, guildId } = req.query;
        if (!teamName || !guildId) {
            return res.status(400).json({ error: "Missing teamName or guildId" });
        }

        const { players, doc } = await `getSheetData`(guildId);

        // Lookup team cap row in sheet (or set baseline hard cap fallback)
        let totalCapAvailable = 255000000; // Example baseline cap if not read from sheet tab

        // 2. Fetch pending/active contract offers for team
        const { data: activeOffers, error } = await supabase
            .from("contract_offers")
            .select("projected_aav, status")
            .eq("guild_id", guildId)
            .eq("team_name", teamName)
            .in("status", ["PENDING", "ACTIVE", "LEADING"]);

        if (error) {
            console.error("❌ Error fetching team active offers:", error.message);
        }

        const activeBids = activeOffers || [];
        const activeBidCount = activeBids.length;

        // Sum up committed AAV across all pending/active bids
        const totalCommittedBidsAAV = activeBids.reduce((sum, offer) => {
            const val = parseFloat(offer.projected_aav) || 0;
            return sum + val;
        }, 0);

        return res.json({
            teamName,
            capAvailable: totalCapAvailable,
            committedBidsAAV: totalCommittedBidsAAV,
            activeBidCount,
        });
    } catch (err) {
        console.error("❌ Team financial fetch error:", err.message);
        return res.status(500).json({ error: "Failed to fetch team financial breakdown." });
    }
});

router.post("/api/admin/bids/action", async (req, res) => {
    console.log("\n==========================================");
    console.log("🚀 [SERVER] Incoming POST /api/admin/bids/action");
    console.log("🚀 [SERVER] Request Body:", req.body);

    try {
        const { offerId, action, commissionerName } = req.body;
        const discordClient = req.app.get("discordClient");

        console.log("🚀 [SERVER] Check discordClient attached to Express:", !!discordClient);
        if (discordClient) {
            console.log("🚀 [SERVER] discordClient status:", discordClient.ws?.status);
        }

        if (!offerId || !action) {
            console.warn("⚠️ [SERVER] Missing offerId or action in request body.");
            return res.status(400).json({ error: "Missing offerId or action." });
        }

        // 1. Fetch offer details
        console.log(`🚀 [SERVER] Querying Supabase contract_offers for ID: ${offerId}`);
        const { data: offer, error: fetchErr } = await supabase
            .from('contract_offers')
            .select('*')
            .eq('id', offerId)
            .single();

        if (fetchErr || !offer) {
            console.error("❌ [SERVER] Error fetching offer from Supabase:", fetchErr);
            return res.status(404).json({ error: "Offer not found." });
        }
        console.log(`🚀 [SERVER] Found offer for player: ${offer.to_player}, guild_id: ${offer.guild_id}`);

        // 2. Update status in database
        console.log(`🚀 [SERVER] Updating Supabase status to: ${action}`);
        const { error: updateErr } = await supabase
            .from('contract_offers')
            .update({ status: action, updated_at: new Date() })
            .eq('id', offerId);

        if (updateErr) {
            console.error("❌ [SERVER] Error updating status in Supabase:", updateErr);
            throw updateErr;
        }

        // 3. Get channel ID from league_configs
        console.log(`🚀 [SERVER] Querying league_configs for guild_id: ${offer.guild_id}`);
        const { data: leagueConfig, error: configErr } = await supabase
            .from('league_configs')
            .select('log_channel_id')
            .eq('guild_id', offer.guild_id)
            .single();

        if (configErr) {
            console.warn("⚠️ [SERVER] Could not fetch league_config:", configErr.message);
        }

        const channelId = leagueConfig?.log_channel_id; 
        console.log("🚀 [SERVER] Resolved Target Channel ID:", channelId);

        // 4. Send embed via Discord Bot
        if (!discordClient) {
            console.error("❌ [SERVER] SKIPPING DISCORD: discordClient is not defined on app!");
        } else if (!channelId) {
            console.error("❌ [SERVER] SKIPPING DISCORD: No channel ID found in league_configs or .env!");
        } else {
            console.log("🚀 [SERVER] Dispatching to sendBidStatusEmbed...");
            await sendBidStatusEmbed(discordClient, channelId, offer, action, commissionerName || "Commissioner");
        }

        // 5. Expire competing pending bids
        if (action === 'ACCEPTED' || action === 'SIGNED') {
            console.log(`🚀 [SERVER] Expiring competing bids for player: ${offer.to_player}`);
            await supabase
                .from('contract_offers')
                .update({ status: 'OUTBID' })
                .ilike('to_player', offer.to_player)
                .eq('guild_id', offer.guild_id)
                .eq('status', 'PENDING');
        }

        console.log("🚀 [SERVER] Action processed successfully.");
        console.log("==========================================\n");
        return res.json({ success: true, action, offerId });

    } catch (err) {
        console.error("❌ [SERVER] Unhandled Exception in Admin Action Route:", err);
        return res.status(500).json({ error: "Failed to process bid action." });
    }
});

router.post("/api/admin/bids/message", async (req, res) => {
    try {
        const { offerId, message, commissionerName } = req.body;
        const discordClient = req.app.get("discordClient");

        if (!offerId || !message) {
            return res.status(400).json({ error: "Missing offerId or message." });
        }

        // 1. Fetch offer details
        const { data: offer, error: fetchErr } = await supabase
            .from('contract_offers')
            .select('*')
            .eq('id', offerId)
            .single();

        if (fetchErr || !offer) {
            return res.status(404).json({ error: "Offer not found." });
        }

        // 2. Fetch league configuration (including team channels JSONB mapping)
        const { data: leagueConfig } = await supabase
            .from('league_configs')
            .select('log_channel_id, sleeper_team_channels')
            .eq('guild_id', offer.guild_id)
            .single();

        let targetChannelId = null;
        const targetTeamName = (offer.from_team || "").trim().toLowerCase();

        // 3. Search sleeper_team_channels JSONB for matching team channel
        if (leagueConfig?.sleeper_team_channels) {
            const teamChannelsMap = leagueConfig.sleeper_team_channels;

            // Loop through JSON entries to match by teamName
            for (const entry of Object.values(teamChannelsMap)) {
                if (entry && entry.teamName && entry.teamName.trim().toLowerCase() === targetTeamName) {
                    targetChannelId = entry.channelId;
                    console.log(`🎯 Found dedicated channel ID ${targetChannelId} for team "${entry.teamName}"`);
                    break;
                }
            }
        }

        // 4. Fallback hierarchy: Dedicated Team Channel
        if (!targetChannelId) {
            targetChannelId = leagueConfig?.log_channel_id; 
            console.log(`⚠️ No team channel found for "${offer.from_team}". Using fallback channel: ${targetChannelId}`);
        }

        // 5. Send message via Discord Bot client
        if (discordClient && targetChannelId) {
            const success = await sendDirectTeamAlert(discordClient, targetChannelId, offer, message, commissionerName || "Commissioner");
            if (success) {
                return res.json({ success: true, channelId: targetChannelId });
            }
        }

        return res.status(500).json({ error: "Failed to dispatch message to Discord." });
    } catch (err) {
        console.error("Error sending team message:", err);
        return res.status(500).json({ error: "Failed to send message." });
    }
});

// GET /api/league/cap-summaries?guildId=...
router.get("/api/league/cap-summaries", async (req, res) => {
    try {
        const guildId = (req.query.guildId || "").trim();
        if (!guildId) {
            return res.status(401).json({ error: "Login required to view league financials." });
        }

        const { data: config } = await supabase
            .from("league_configs")
            .select("*")
            .eq("guild_id", guildId)
            .limit(1)
            .maybeSingle();

        if (!config) {
            return res.status(404).json({ error: "League configuration not found." });
        } 

        const mapping = config.column_mapping || {};
        const capCellA1 = (mapping.team_cap || "").trim().toUpperCase();
        const extCellA1 = (mapping.team_ext || "").trim().toUpperCase();

        // 2. Load Google Spreadsheet and Player List via existing helper
        const getSheetData = req.app.locals.getSheetData;
        if (typeof getSheetData !== "function") {
            return res.status(500).json({ error: "getSheetData helper is not attached to app.locals." });
        }

        const { players, doc } = await getSheetData(config.guild_id);
        if (!doc) {
            return res.status(500).json({ error: "Unable to load Google Spreadsheet." });
        }

        // 3. Identify valid franchise tabs (skipping system tabs like PlayerList, Transaction Log, etc.)
        const systemTabs = new Set([
            (config.tab_players || "PlayerList").toLowerCase(),
            (config.tab_logs || "Transaction Log").toLowerCase(),
            (config.tab_ids || "Sleeper_Players").toLowerCase(),
            "player list",
            "rules",
            "settings",
            "draft",
            "free agents"
        ]);

        const validTeamNames = Object.values(config.sleeper_team_roles || {})
            .map(r => (r.teamName || "").toLowerCase().trim())
            .filter(Boolean);

        const teamSheets = doc.sheetsByIndex.filter(s => {
            const titleLower = s.title.toLowerCase().trim();
            if (systemTabs.has(titleLower)) return false;
            // Match against registered league teams if available, otherwise include non-system tabs
            return validTeamNames.length > 0
                ? validTeamNames.some(name => titleLower.includes(name) || name.includes(titleLower))
                : true;
        });

        // 4. Load target cells (e.g., D4 and J2) across all team tabs in parallel
        const cellsToLoad = [capCellA1, extCellA1].filter(Boolean);
        await Promise.all(
            teamSheets.map(async (sheet) => {
                if (cellsToLoad.length > 0) {
                    await Promise.all(cellsToLoad.map(cell => sheet.loadCells(cell).catch(() => null)));
                }
            })
        );

        // 5. Build structured cap summary for each franchise
        const teams = teamSheets.map(sheet => {
            const titleLower = sheet.title.toLowerCase().trim();

            // Extract Cap Space (e.g., D4)
            let capSpaceFormatted = "$0";
            let capSpaceNum = 0;

            if (capCellA1) {
                try {
                    const cell = sheet.getCellByA1(capCellA1);
                    if (typeof cell.value === "number") {
                        capSpaceNum = cell.value;
                        capSpaceFormatted = cell.formattedValue || `$${cell.value.toLocaleString("en-US")}`;
                    } else if (cell.formattedValue || cell.value) {
                        capSpaceFormatted = String(cell.formattedValue || cell.value);
                        capSpaceNum = parseFloat(capSpaceFormatted.replace(/[$,]/g, "")) || 0;
                    }
                } catch {}
            }

            // Extract Extensions Left (e.g., J2)
            let extensionsLeft = null;
            if (extCellA1) {
                try {
                    const extCell = sheet.getCellByA1(extCellA1);
                    extensionsLeft = extCell.formattedValue ?? extCell.value ?? null;
                } catch {}
            }

            // Calculate Roster Count & Active Salary Committed from PlayerList
            const teamPlayers = (players || []).filter(p => {
                const pTeam = String(p.team || p.teamAffiliation || p.Team || "").toLowerCase().trim();
                return pTeam && (pTeam === titleLower || titleLower.includes(pTeam) || pTeam.includes(titleLower));
            });

            const activeCapCommitted = teamPlayers.reduce((sum, p) => {
                const rawSal = p.cap_hit ?? p.aav ?? p.salary ?? p.Salary ?? 0;
                const numSal = typeof rawSal === "number"
                    ? rawSal
                    : parseFloat(String(rawSal).replace(/[$,]/g, "")) || 0;
                return sum + numSal;
            }, 0);

            return {
                teamName: sheet.title,
                capSpace: capSpaceNum,
                capSpaceFormatted,
                activeCapCommitted,
                rosterCount: teamPlayers.length,
                extensionsLeft,
                sheetUrl: `https://docs.google.com/spreadsheets/d/${doc.spreadsheetId}/edit#gid=${sheet.sheetId}`
            };
        });

        // Sort highest cap space first by default
        teams.sort((a, b) => b.capSpace - a.capSpace);

        return res.json({
            success: true,
            leagueName: config.sleeper_name || config.league_name || "League Cap Overview",
            guildId: config.guild_id,
            faEnabled: Boolean(config.fa_enabled),
            teams
        });
    } catch (err) {
        console.error("❌ Error fetching league cap summaries:", err);
        return res.status(500).json({ error: "Failed to fetch team cap summaries from Google Sheets." });
    }
});

// GET /api/offers/my-team?teamName=...&guildId=...
router.get("/api/offers/my-team", async (req, res) => {
    try {
        const teamName = (req.query.teamName || "").trim();
        const guildId = (req.query.guildId || "").trim();

        if (!teamName) {
            return res.status(400).json({ error: "teamName is required." });
        }

        let query = supabase
            .from("contract_offers")
            .select("*")
            .ilike("from_team", teamName)
            .order("created_at", { ascending: false });

        if (guildId) {
            query = query.eq("guild_id", guildId);
        }

        const { data: offers, error } = await query;

        if (error) {
            console.error("❌ Error fetching team offers:", error);
            return res.status(500).json({ error: "Failed to fetch team offers from Supabase." });
        }

        return res.json({
            success: true,
            teamName,
            offers: offers || []
        });
    } catch (err) {
        console.error("❌ Unhandled error in GET /api/offers/my-team:", err);
        return res.status(500).json({ error: "Server error fetching team offers." });
    }
});

// GET /api/league/fa-settings?guildId=...
router.get("/api/league/fa-settings", async (req, res) => {
    try {
        const guildId = (req.query.guildId || "").trim();
        if (!guildId) {
            return res.status(400).json({ error: "guildId is required." });
        }

        const { data: config, error } = await supabase
            .from("league_configs")
            .select("guild_id, fa_enabled, max_bids_per_team")
            .eq("guild_id", guildId)
            .maybeSingle();

        if (error || !config) {
            return res.status(404).json({ error: "League configuration not found." });
        }

        return res.json({
            success: true,
            guildId: config.guild_id,
            faEnabled: Boolean(config.fa_enabled),
            maxBidsPerTeam: config.max_bids_per_team ?? null
        });
    } catch (err) {
        console.error("❌ Error fetching FA settings:", err);
        return res.status(500).json({ error: "Failed to fetch FA settings." });
    }
});

// POST /api/league/fa-settings
router.post("/api/league/fa-settings", async (req, res) => {
    try {
        const guildId = (req.body.guildId || "").trim();
        if (!guildId) {
            return res.status(400).json({ error: "guildId is required." });
        }

        // Empty string or null disables the limit (saves null)
        const rawMax = req.body.maxBidsPerTeam;
        let maxBidsPerTeam = null;
        if (rawMax !== "" && rawMax !== null && rawMax !== undefined) {
            const parsed = parseInt(rawMax, 10);
            if (!Number.isFinite(parsed) || parsed < 1) {
                return res.status(400).json({ error: "Max bids per team must be at least 1, or left empty." });
            }
            maxBidsPerTeam = parsed;
        }

        const { data, error } = await supabase
            .from("league_configs")
            .update({ max_bids_per_team: maxBidsPerTeam })
            .eq("guild_id", guildId)
            .select("guild_id, fa_enabled, max_bids_per_team")
            .maybeSingle();

        if (error) {
            console.error("❌ Error updating FA settings:", error);
            return res.status(500).json({ error: "Failed to update FA settings." });
        }

        return res.json({
            success: true,
            maxBidsPerTeam: data?.max_bids_per_team ?? null
        });
    } catch (err) {
        console.error("❌ Error saving FA settings:", err);
        return res.status(500).json({ error: "Server error saving FA settings." });
    }
});

// PATCH /api/offers/:id — Revise a PENDING offer
router.patch("/api/offers/:id", async (req, res) => {
    try {
        const offerId = req.params.id;
        const { teamName, guildId, aav, years, guaranteed, bonuses, notes } = req.body;

        if (!offerId || !teamName) {
            return res.status(400).json({ error: "Offer ID and teamName are required." });
        }

        const parsedAav = Number(aav);
        const parsedYears = parseInt(years, 10) || 1;
        if (!Number.isFinite(parsedAav) || parsedAav <= 0) {
            return res.status(400).json({ error: "AAV must be greater than $0." });
        }

        // Verify the offer belongs to this team and is still PENDING
        const { data: existing, error: fetchErr } = await supabase
            .from("contract_offers")
            .select("*")
            .eq("id", offerId)
            .maybeSingle();

        if (fetchErr || !existing) {
            return res.status(404).json({ error: "Offer not found." });
        }

        const ownerTeam = String(existing.from_team || existing.team_name || "").toLowerCase().trim();
        if (ownerTeam !== String(teamName).toLowerCase().trim()) {
            return res.status(403).json({ error: "You can only revise your own team's offers." });
        }

        if (String(existing.status || "PENDING").toUpperCase() !== "PENDING") {
            return res.status(400).json({ error: `Cannot revise an offer that is already ${existing.status}.` });
        }

        const totalValue = parsedAav * parsedYears;
        const gtdNum = Number(guaranteed) || 0;
        const bonusNum = Number(bonuses) || 0;
        const bonusParts = [];
        if (gtdNum > 0) bonusParts.push(`$${gtdNum.toLocaleString("en-US")} GTD`);
        if (bonusNum > 0) bonusParts.push(`$${bonusNum.toLocaleString("en-US")} Signing Bonus`);

        const updatePayload = {
            aav: parsedAav,
            years: parsedYears,
            notes: notes !== undefined ? String(notes).trim() : existing.notes
        };

        if ("bonuses" in existing) {
            updatePayload.bonuses = bonusParts.length > 0 ? bonusParts.join(" • ") : null;
        }

        const { data: updated, error: updateErr } = await supabase
            .from("contract_offers")
            .update(updatePayload)
            .eq("id", offerId)
            .select()
            .single();

        if (updateErr) {
            console.error("❌ Error revising offer:", updateErr);
            return res.status(500).json({ error: "Failed to revise offer." });
        }

        return res.json({ success: true, offer: updated });
    } catch (err) {
        console.error("❌ Exception revising offer:", err);
        return res.status(500).json({ error: "Server error revising offer." });
    }
});

// DELETE /api/offers/:id — Withdraw a PENDING offer
router.delete("/api/offers/:id", async (req, res) => {
    try {
        const offerId = req.params.id;
        const teamName = (req.body?.teamName || req.query?.teamName || "").trim();

        if (!offerId || !teamName) {
            return res.status(400).json({ error: "Offer ID and teamName are required." });
        }

        const { data: existing, error: fetchErr } = await supabase
            .from("contract_offers")
            .select("*")
            .eq("id", offerId)
            .maybeSingle();

        if (fetchErr || !existing) {
            return res.status(404).json({ error: "Offer not found." });
        }

        const ownerTeam = String(existing.from_team || existing.team_name || "").toLowerCase().trim();
        if (ownerTeam !== teamName.toLowerCase()) {
            return res.status(403).json({ error: "You can only withdraw your own team's offers." });
        }

        if (String(existing.status || "PENDING").toUpperCase() !== "PENDING") {
            return res.status(400).json({ error: `Cannot withdraw an offer that is already ${existing.status}.` });
        }

        const { error: deleteErr } = await supabase
            .from("contract_offers")
            .delete()
            .eq("id", offerId);

        if (deleteErr) {
            console.error("❌ Error withdrawing offer:", deleteErr);
            return res.status(500).json({ error: "Failed to withdraw offer." });
        }

        return res.json({ success: true, withdrawnId: offerId });
    } catch (err) {
        console.error("❌ Exception withdrawing offer:", err);
        return res.status(500).json({ error: "Server error withdrawing offer." });
    }
});


function getDiscordClient(req) {
    if (req?.app?.get("discordClient")) return req.app.get("discordClient");
    if (req?.app?.get("client")) return req.app.get("client");
    if (global.discordClient) return global.discordClient;
    if (global.client) return global.client;
    try {
        const idx = require("../index");
        return idx?.client || idx?.discordClient || null;
    } catch {
        return null;
    }
}

const DEF_TO_IDP_GROUP = {
    DE: "DL", DT: "DL", DL: "DL",
    ILB: "LB", OLB: "LB", LB: "LB",
    CB: "DB", S: "DB", FS: "DB", SS: "DB", DB: "DB",
    IDP: "IDP"
};

function resolvePositionAgentId(posMap, rawPos) {
    const cleanPos = String(rawPos || "").toUpperCase().trim();
    if (!cleanPos) return null;
    if (posMap[cleanPos]) return posMap[cleanPos];
    const normalized = DEF_TO_IDP_GROUP[cleanPos];
    if (normalized && posMap[normalized]) return posMap[normalized];
    if (normalized && posMap["IDP"]) return posMap["IDP"];
    return null;
}

// GET /api/league/agents?guildId=...
router.get("/api/league/agents", async (req, res) => {
    try {
        const guildId = (req.query.guildId || "").trim();
        if (!guildId) return res.status(400).json({ error: "guildId is required." });

        const [{ data: cfg }, { data: offerRows }] = await Promise.all([
            supabase
                .from("league_configs")
                .select("agent_role_id, agent_assignment_mode, agent_position_map")
                .eq("guild_id", guildId)
                .maybeSingle(),
            supabase
                .from("contract_offers")
                .select("to_player, agent_assigned, agent_discord_id")
                .eq("guild_id", guildId)
        ]);

        const client = getDiscordClient(req);
        const guild = client?.guilds?.cache?.get(guildId);
        let roles = [];
        let agents = [];

        if (guild) {
            roles = guild.roles.cache
                .filter(r => !r.managed && r.name !== "@everyone")
                .sort((a, b) => b.position - a.position)
                .map(r => ({ id: r.id, name: r.name, color: r.hexColor }));

            if (cfg?.agent_role_id) {
                await guild.members.fetch().catch(() => {});
                agents = guild.members.cache
                    .filter(m => !m.user.bot && m.roles.cache.has(cfg.agent_role_id))
                    .map(m => ({
                        discordId: m.user.id,
                        username: m.displayName || m.user.username,
                        tag: m.user.username
                    }));
            }
        }

        const playerAgents = {};
        (offerRows || []).forEach(row => {
            const pName = String(row.to_player || "").trim();
            if (!pName) return;
            if (!playerAgents[pName]) {
                playerAgents[pName] = {
                    playerName: pName,
                    agentAssigned: row.agent_assigned || "@Commissioner",
                    agentDiscordId: row.agent_discord_id || ""
                };
            } else if (row.agent_discord_id && !playerAgents[pName].agentDiscordId) {
                playerAgents[pName].agentAssigned = row.agent_assigned || "@Commissioner";
                playerAgents[pName].agentDiscordId = row.agent_discord_id;
            }
        });

        return res.json({
            success: true,
            roles,
            agents,
            agentRoleId: cfg?.agent_role_id || "",
            agentAssignmentMode: cfg?.agent_assignment_mode || "manual",
            agentPositionMap: cfg?.agent_position_map || {},
            playerAgents: Object.values(playerAgents)
        });
    } catch (err) {
        console.error("❌ Error loading league agents:", err);
        return res.status(500).json({ error: "Failed to load league agents." });
    }
});

// POST /api/league/agent-settings — Saves config + applies manual per-player assignments
router.post("/api/league/agent-settings", async (req, res) => {
    try {
        const { guildId, agentRoleId, agentAssignmentMode, agentPositionMap, manualAssignments } = req.body;
        if (!guildId) return res.status(400).json({ error: "guildId is required." });

        const { error: cfgErr } = await supabase
            .from("league_configs")
            .upsert({
                guild_id: guildId,
                agent_role_id: agentRoleId || null,
                agent_assignment_mode: agentAssignmentMode || "manual",
                agent_position_map: agentPositionMap || {}
            }, { onConflict: "guild_id" });

        if (cfgErr) {
            console.error("❌ Error saving agent settings:", cfgErr);
            return res.status(500).json({ error: "Failed to save agent settings." });
        }

        if (Array.isArray(manualAssignments)) {
            for (const item of manualAssignments) {
                if (!item?.playerName) continue;
                await supabase
                    .from("contract_offers")
                    .update({
                        agent_assigned: item.agentAssigned || "@Commissioner",
                        agent_discord_id: item.agentDiscordId || null
                    })
                    .eq("guild_id", guildId)
                    .eq("to_player", item.playerName);
            }
        }

        return res.json({ success: true });
    } catch (err) {
        console.error("❌ Exception saving agent settings:", err);
        return res.status(500).json({ error: "Server error saving agent settings." });
    }
});

// POST /api/league/assign-agents — Auto-assigns unassigned players (Random or By Position)
router.post("/api/league/assign-agents", async (req, res) => {
    try {
        const { guildId } = req.body;
        if (!guildId) return res.status(400).json({ error: "guildId is required." });

        const { data: cfg } = await supabase
            .from("league_configs")
            .select("agent_role_id, agent_assignment_mode, agent_position_map")
            .eq("guild_id", guildId)
            .maybeSingle();

        const client = getDiscordClient(req);
        const guild = client?.guilds?.cache?.get(guildId);
        if (!guild || !cfg?.agent_role_id) {
            return res.status(400).json({ error: "Select and save an Agent Discord Role first." });
        }

        await guild.members.fetch().catch(() => {});
        const eligibleAgents = guild.members.cache
            .filter(m => !m.user.bot && m.roles.cache.has(cfg.agent_role_id))
            .map(m => ({
                discordId: m.user.id,
                username: m.displayName || m.user.username
            }));

        if (eligibleAgents.length === 0) {
            return res.status(400).json({ error: "No members found with the selected Agent role." });
        }

        const [{ data: allOffers }, { data: teamLinks }] = await Promise.all([
            supabase
                .from("contract_offers")
                .select("*")
                .eq("guild_id", guildId),
            supabase
                .from("user_team_links")
                .select("discord_id, team_name")
                .eq("guild_id", guildId)
        ]);

        const teamByDiscordId = {};
        (teamLinks || []).forEach(link => {
            if (link.discord_id && link.team_name) {
                teamByDiscordId[String(link.discord_id)] = String(link.team_name).toLowerCase().trim();
            }
        });

        const playerGroups = {};
        (allOffers || []).forEach(o => {
            const pName = String(o.to_player || "").trim();
            if (!pName) return;
            const rawPos = o.position || o.pos || "";
            if (!playerGroups[pName]) {
                playerGroups[pName] = {
                    bidders: new Set(),
                    position: rawPos ? String(rawPos).toUpperCase().trim() : "",
                    alreadyAssigned: Boolean(o.agent_discord_id)
                };
            }
            if (o.from_team) playerGroups[pName].bidders.add(String(o.from_team).toLowerCase().trim());
            if (o.agent_discord_id) playerGroups[pName].alreadyAssigned = true;
        });

        const mode = cfg.agent_assignment_mode || "manual";
        const posMap = cfg.agent_position_map || {};
        let assignedCount = 0;

        for (const [playerName, info] of Object.entries(playerGroups)) {
            if (info.alreadyAssigned) continue;

            const conflictFree = eligibleAgents.filter(agent => {
                const agentTeam = teamByDiscordId[agent.discordId];
                return !agentTeam || !info.bidders.has(agentTeam);
            });

            let chosen = null;
            if (mode === "position") {
                const mappedId = resolvePositionAgentId(posMap, info.position);
                chosen = conflictFree.find(a => a.discordId === mappedId) || null;
            } else if (mode === "random" && conflictFree.length > 0) {
                chosen = conflictFree[Math.floor(Math.random() * conflictFree.length)];
            }

            if (chosen) {
                await supabase
                    .from("contract_offers")
                    .update({
                        agent_assigned: `@${chosen.username}`,
                        agent_discord_id: chosen.discordId
                    })
                    .eq("guild_id", guildId)
                    .eq("to_player", playerName);
                assignedCount++;
            }
        }

        return res.json({ success: true, assignedCount });
    } catch (err) {
        console.error("❌ Error auto-assigning agents:", err);
        return res.status(500).json({ error: "Failed to auto-assign agents." });
    }
});

module.exports = router;