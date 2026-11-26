// State
let offers = [];
let cachedLeagueTeams = [];
let isLeagueFaOpen = true;
let selectedOffer = null;
let pinnedOfferId = null;
let topOfferIds = new Set();
let masterLogMode = "agent"; 
let isUserCommish = false;

// Utility Helpers
const $ = (id) => document.getElementById(id);

// LocalStorage Session Keys
const SESSION_KEY_USER = "fop_user_session";
const SESSION_KEY_LEAGUE = "fop_active_league_id";

// 1. Session Persistence Helper
function saveUserSession(userData) {
    localStorage.setItem(SESSION_KEY_USER, JSON.stringify(userData));
}

function getStoredUserSession() {
    try {
        const stored = localStorage.getItem(SESSION_KEY_USER);
        return stored ? JSON.parse(stored) : null;
    } catch {
        return null;
    }
}

function clearUserSession() {
    localStorage.removeItem(SESSION_KEY_USER);
}

// 2. Render Top Right Profile Header
function renderTopProfileBar(user) {
    const authBtn = document.getElementById("topAuthBtn");
    const profileCard = document.getElementById("userProfileCard");
    const userAvatar = document.getElementById("userAvatar");
    const userName = document.getElementById("userDiscordName");
    const userTeam = document.getElementById("userTeamLabel");

    const userProfileMobile = document.getElementById("userProfileMobile");
    const userAvatarMobile = document.getElementById("userAvatarMobile");

    if (user && user.discordId) {
        // Construct Discord Avatar URL
        const avatarUrl = user.avatar 
            ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png`
            : "https://cdn.discordapp.com/embed/avatars/0.png";

        if (userAvatar) userAvatar.src = avatarUrl;
        if (userAvatarMobile) userAvatarMobile.src = avatarUrl;
        if (userName) userName.textContent = user.username || "Discord User";
        if (userTeam) userTeam.textContent = user.teamName || "Unlinked GM";

        authBtn?.classList.add("hidden");
        profileCard?.classList.remove("hidden");
        userProfileMobile?.classList.remove("hidden");
    } else {
        authBtn?.classList.remove("hidden");
        profileCard?.classList.add("hidden");
        userProfileMobile?.classList.add("hidden");
    }
}

const escapeHtml = (value) =>
    String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

const formatCurrency = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "$0";
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(amount);
};

const formatDate = (isoString) => {
    if (!isoString || isoString === "—") return "—";
    try {
        const date = new Date(isoString);
        return date.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    } catch {
        return isoString;
    }
};

const getOfferId = (offer) => offer?.id ?? offer?.offer_id;

function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
}

function statusBadge(status) {
    const normalized = String(status || "PENDING").toUpperCase();
    const styles = {
        ACCEPTED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        DECLINED: "bg-rose-500/10 text-rose-400 border-rose-500/20",
        EXPIRED: "bg-slate-800 text-slate-400 border-slate-700",
        PENDING: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    };
    return `<span class="px-2 py-0.5 rounded font-bold border text-xs ${styles[normalized] || styles.PENDING}">${escapeHtml(normalized)}</span>`;
}

// Navigation Tab Management
function switchTab(activeTab) {
    const views = {
        'master-log': $('view-master-log'),
        'team-view': $('view-team-view'),
        'submit-bid': $('view-submit-bid'),
        'settings': $('view-settings'),
        'my-team': $('view-my-team'),
        'my-team-fa': $('view-my-team-fa')
    };

    const buttons = {
        'master-log': $('nav-master-log'),
        'team-view': $('nav-team-view'),
        'submit-bid': $('nav-submit-bid'),
        'settings': $('nav-settings'),
        'my-team': $('nav-my-team'),
        'my-team-fa': $('nav-my-team-fa')
    };

    // Only show Free Agency KPI cards on Master Offers Log
        const faMetricsRow = $('fa-metrics-row');
        if (faMetricsRow) {
            if (activeTab === 'master-log') {
                faMetricsRow.classList.remove('hidden');
            } else {
                faMetricsRow.classList.add('hidden');
            }
        }

        Object.keys(views).forEach(key => {
            if (key === activeTab) {
                views[key]?.classList.remove('hidden');
                buttons[key]?.classList.add('bg-cyan-500/10', 'text-cyan-400', 'border', 'border-cyan-500/20', 'font-bold');
                buttons[key]?.classList.remove('text-slate-400', 'font-medium');
            } else {
                views[key]?.classList.add('hidden');
                buttons[key]?.classList.remove('bg-cyan-500/10', 'text-cyan-400', 'border', 'border-cyan-500/20', 'font-bold');
                buttons[key]?.classList.add('text-slate-400', 'font-medium');
            }
        });

        $('sidebarNav')?.classList.add("-translate-x-full");
        $('mobileBackdrop')?.classList.add("hidden");

        if (activeTab === 'team-view') renderTeamSummaries();
        if (activeTab === 'submit-bid') initSubmitBidView();
        if (activeTab === 'settings') initFaSettingsView(); initAgentSettingsUI();
        if (activeTab === 'my-team-fa') renderMyTeamFa(); 
}


// Data Processing & UI Updating
function updateMetrics() {
    const pending = offers.filter((offer) => String(offer.status).toUpperCase() === "PENDING");

    const awaiting = offers.filter(
        (offer) =>
            !offer.agent &&
            !offer.assigned_agent &&
            !offer.agent_assigned &&
            !offer.agent_name &&
            String(offer.status).toUpperCase() === "PENDING",
    );

    setText("metric-total", offers.length);
    setText("metric-pending", pending.length);
    setText("metric-awaiting", awaiting.length);
}

function renderGroupedOffers(offersToRender) {
    const container = $("offers-table-body");
    if (!container) return;

    const visibleOffers = getVisibleMasterOffers(offersToRender);

    if (!visibleOffers || visibleOffers.length === 0) {
        const emptyMsg = masterLogMode === "agent"
            ? "No offers currently assigned to you (or hidden due to a team bid conflict)."
            : masterLogMode === "unassigned"
            ? "No unassigned offers found."
            : "No active offers found.";
        container.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-500">${emptyMsg}</td></tr>`;
        return;
    }

    // Group bids by Player Name
    const grouped = visibleOffers.reduce((acc, offer) => {
        const player = offer.player_name || offer.to_player || offer.player || "Unknown Player";
        if (!acc[player]) acc[player] = [];
        acc[player].push(offer);
        return acc;
    }, {});

    let html = "";

    for (const [player, bids] of Object.entries(grouped)) {
        // Sort bids
        const sortedBids = [...bids].sort((a, b) => {
            const statusA = String(a.status || "PENDING").toUpperCase();
            const statusB = String(b.status || "PENDING").toUpperCase();

            const isPendingA = statusA === "PENDING";
            const isPendingB = statusB === "PENDING";

            if (isPendingA && !isPendingB) return -1;
            if (!isPendingA && isPendingB) return 1;

            const isTopA = topOfferIds.has(String(getOfferId(a)));
            const isTopB = topOfferIds.has(String(getOfferId(b)));

            if (isTopA && !isTopB) return -1;
            if (!isTopA && isTopB) return 1;

            const valA = Number(a.total_value) || (Number(a.aav) * Number(a.years || a.length || 1)) || 0;
            const valB = Number(b.total_value) || (Number(b.aav) * Number(b.years || b.length || 1)) || 0;
            return valB - valA;
        });

        // Player Header Line
        html += `
            <tr class="bg-slate-800/80 font-semibold text-slate-200 border-t border-b border-slate-700">
                <td colspan="6" class="px-4 py-2 text-xs">
                    Player Name: <span class="text-cyan-400 font-bold">${escapeHtml(player)}</span> 
                    <span class="ml-2 text-slate-400 font-normal">(Bids: ${sortedBids.length})</span>
                </td>
            </tr>
        `;

        // Render sorted bids
        sortedBids.forEach((bid) => {
            const bidId = String(getOfferId(bid));
            const isSelected = selectedOffer && String(getOfferId(selectedOffer)) === bidId;
            const status = String(bid.status || "PENDING").toUpperCase();
            const isTopOffer = topOfferIds.has(bidId);

            const playerName = bid.player_name || bid.to_player || bid.player || "—";
            const teamName = bid.team_name || bid.from_team || bid.team || "—";
            const rawTimestamp = bid.timestamp || bid.created_at || "—";
            const formattedTime = formatDate(rawTimestamp);
            const years = bid.years || bid.length || 1;

            html += `
                <tr data-offer-id="${escapeHtml(bidId)}" class="offer-row border-b border-slate-800/40 cursor-pointer transition-colors ${isTopOffer ? 'bg-amber-950/20 ring-1 ring-amber-500/40' : isSelected ? 'bg-cyan-950/40 ring-1 ring-cyan-500/50' : 'hover:bg-slate-800/30'} ${status !== 'PENDING' ? 'opacity-60 bg-slate-950/40' : ''} text-sm text-slate-300">
                    <td class="pl-6 pr-4 py-2.5 text-xs text-slate-400 font-mono">${escapeHtml(formattedTime)}</td>
                    <td class="px-4 py-2.5 font-medium flex items-center gap-1.5">
                        ${isTopOffer ? '<span class="text-xs text-amber-400 font-bold" title="Flagged Top Offer">⭐</span>' : ''}
                        <span>${escapeHtml(teamName)}</span>
                    </td>
                    <td class="px-4 py-2.5 text-slate-400">${escapeHtml(playerName)}</td>
                    <td class="px-4 py-2.5 font-mono text-emerald-400 font-bold">${formatCurrency(bid.aav)}</td>
                    <td class="px-4 py-2.5 font-mono">${years} ${Number(years) === 1 ? 'yr' : 'yrs'}</td>
                    <td class="px-4 py-2.5">${statusBadge(bid.status)}</td>
                </tr>
            `;
        });
    }

    container.innerHTML = html;

    container.querySelectorAll(".offer-row").forEach((row) => {
        row.addEventListener("click", () => {
            const id = row.getAttribute("data-offer-id");
            const offer = offers.find((o) => String(getOfferId(o)) === String(id));
            selectOffer(offer);
            renderGroupedOffers(offersToRender);
        });
    });
}

// DOM Element References
const bidModal = document.getElementById('bidModal');
const openBidModalBtn = document.getElementById('openBidModalBtn');
const closeBidModalBtn = document.getElementById('closeBidModalBtn');
const cancelBidBtn = document.getElementById('cancelBidBtn');
const webBidForm = document.getElementById('webBidForm');

// Toggle Modal
if (openBidModalBtn) {
    openBidModalBtn.addEventListener('click', () => {
        bidModal.style.display = 'flex';
    });
}

function closeModal() {
    if (bidModal) bidModal.style.display = 'none';
    if (webBidForm) webBidForm.reset();
}

if (closeBidModalBtn) closeBidModalBtn.addEventListener('click', closeModal);
if (cancelBidBtn) cancelBidBtn.addEventListener('click', closeModal);

// Handle Web Bid Submission
if (webBidForm) {
    webBidForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const payload = {
            teamName: document.getElementById('webTeamName').value.trim(),
            playerName: document.getElementById('webPlayerName').value.trim(),
            pos: document.getElementById('webPos').value,
            aav: document.getElementById('webAAV').value.trim(),
            years: parseInt(document.getElementById('webYears').value, 10),
            bonuses: document.getElementById('webBonuses').value.trim() || 'N/A',
            notes: document.getElementById('webNotes').value.trim() || 'None'
        };

        try {
            const res = await fetch('/api/offers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (!data.success) {
                alert(`❌ Error: ${data.error}`);
                return;
            }

            alert(`✅ ${data.message}`);
            closeModal();

            // Refresh offers log and counters dynamically
            if (typeof loadMasterOffers === 'function') {
                loadMasterOffers();
            }

        } catch (err) {
            console.error('Failed to submit offer:', err);
            alert('❌ Network error submitting offer. Please try again.');
        }
    });
}

async function renderTeamSummaries(forceRefresh = false) {
    const grid = $("team-summary-grid");
    const titleEl = $("league-cap-title");
    if (!grid) return;

    const session = typeof getStoredUserSession === "function" ? getStoredUserSession() : null;
    const activeGuildId = session?.guildId || localStorage.getItem(SESSION_KEY_LEAGUE) || "";

    if (!session || !activeGuildId) {
        if (typeof cachedLeagueTeams !== "undefined") cachedLeagueTeams = [];
        if (titleEl) titleEl.textContent = "League Financials";
        grid.innerHTML = `
            <div class="col-span-full bg-slate-950/60 border border-slate-800 rounded-xl p-8 text-center space-y-2">
                <div class="text-2xl">🔒</div>
                <h3 class="text-sm font-bold text-white">Discord Login Required</h3>
                <p class="text-xs text-slate-400">Log in with Discord in the top right to view your league's team cap summaries.</p>
            </div>
        `;
        return;
    }

    // Ensure the sort dropdown triggers re-render on change
    const sortSelect = $("cap-sort-select");
    if (sortSelect && !sortSelect.dataset.listenerBound) {
        sortSelect.addEventListener("change", () => renderTeamSummaries(false));
        sortSelect.dataset.listenerBound = "true";
    }

    if (cachedLeagueTeams.length === 0 || forceRefresh) {
        grid.innerHTML = `<p class="text-slate-400 col-span-full py-8 text-center animate-pulse">Syncing live cap figures from Google Sheets...</p>`;
        try {
            const session = getStoredUserSession();
            const guildQuery = session?.guildId ? `?guildId=${encodeURIComponent(session.guildId)}` : "";
            const res = await fetch(`/api/league/cap-summaries${guildQuery}`);
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || "Unable to load cap summaries");
            }

            cachedLeagueTeams = data.teams || [];
            if (typeof data.faEnabled === "boolean") {
                isLeagueFaOpen = data.faEnabled;
            }
            if (data.leagueName) {
                setText("league-cap-title", `${data.leagueName} — Team Financials`);
            }
        } catch (err) {
            grid.innerHTML = `<p class="text-rose-400 col-span-full py-6 text-center">Failed to load Google Sheets cap data: ${escapeHtml(err.message)}</p>`;
            return;
        }
    }

    const parseCapNum = (team) => {
        if (typeof team.capSpace === "number" && !Number.isNaN(team.capSpace)) {
            return team.capSpace;
        }
        return parseFloat(String(team.capSpaceFormatted || team.capSpace || "0").replace(/[^0-9.-]/g, "")) || 0;
    };

    const sortMode = sortSelect?.value || "cap-desc";
    const sortedTeams = [...cachedLeagueTeams].sort((a, b) => {
        if (sortMode === "cap-asc") return parseCapNum(a) - parseCapNum(b);
        if (sortMode === "name-asc") return String(a.teamName || "").localeCompare(String(b.teamName || ""));
        return parseCapNum(b) - parseCapNum(a);
    });

    const userTeam = (getStoredUserSession()?.teamName || "").toLowerCase().trim();

    grid.innerHTML = sortedTeams.map(team => {
        const capNum = parseCapNum(team);
        const isMyTeam = userTeam && team.teamName.toLowerCase().trim() === userTeam;
        const isOverCap = capNum < 0;
        const capColor = isOverCap ? "text-rose-400" : capNum < 15000000 ? "text-amber-400" : "text-emerald-400";

        return `
            <div class="bg-slate-950 border ${isMyTeam ? 'border-cyan-500/60 ring-1 ring-cyan-500/20' : 'border-slate-800'} p-4 rounded-xl flex flex-col justify-between space-y-3 hover:border-slate-700 transition-colors">
                <div class="flex justify-between items-start gap-2">
                    <div>
                        <div class="flex items-center gap-2">
                            <h3 class="font-bold text-white text-sm">${escapeHtml(team.teamName)}</h3>
                            ${isMyTeam ? '<span class="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">Your Team</span>' : ''}
                        </div>
                        <span class="text-[11px] text-slate-400">${team.rosterCount} Active Players</span>
                    </div>
                    <a href="${escapeHtml(team.sheetUrl)}" target="_blank" rel="noopener noreferrer" class="text-[11px] text-cyan-400 hover:text-cyan-300 font-semibold shrink-0">
                        Sheet ↗
                    </a>
                </div>

                <div class="space-y-1.5 border-t border-slate-800/80 pt-2.5">
                    <div class="flex justify-between items-center">
                        <span class="text-slate-400">Available Cap Space:</span>
                        <span class="font-black text-sm font-mono ${capColor}">${escapeHtml(team.capSpaceFormatted)}</span>
                    </div>
                    ${team.extensionsLeft !== null && team.extensionsLeft !== "" ? `
                    <div class="flex justify-between items-center">
                        <span class="text-slate-400">Extensions Remaining:</span>
                        <span class="font-bold text-slate-200">${escapeHtml(team.extensionsLeft)}</span>
                    </div>` : ""}
                </div>
            </div>
        `;
    }).join("") || '<p class="text-slate-500 col-span-full text-center py-6">No franchise tabs found in spreadsheet.</p>';
}

function selectOffer(offer) {
    selectedOffer = offer || null;
    const placeholder = $("audit-placeholder");
    const content = $("audit-content");

    if (!selectedOffer) {
        placeholder?.classList.remove("hidden");
        content?.classList.add("hidden");
        return;
    }

    placeholder?.classList.add("hidden");
    content?.classList.remove("hidden");

    const player = selectedOffer.to_player || selectedOffer.player_name || "Unknown player";
    const team = selectedOffer.from_team || selectedOffer.team_name || "Unknown team";
    const agent =
        selectedOffer.agent ||
        selectedOffer.assigned_agent ||
        selectedOffer.agent_assigned ||
        selectedOffer.agent_name ||
        "Unassigned";

    setText("audit-player-name", player);
    setText("audit-player-sub", `${team} · ${selectedOffer.pos || selectedOffer.position || "—"}`);
    setText("audit-aav", formatCurrency(selectedOffer.aav));
    setText("audit-total", formatCurrency(selectedOffer.total_value || Number(selectedOffer.aav) * Number(selectedOffer.years || selectedOffer.length || 1)));
    setText("audit-agent", agent);
    setText("audit-notes", selectedOffer.notes || selectedOffer.agent_notes || "No custom requirements or notes submitted.");

    const badge = $("audit-status-badge");
    if (badge) {
        badge.outerHTML = statusBadge(selectedOffer.status).replace(
            "<span ",
            '<span id="audit-status-badge" '
        );
    }
}

// API Calls
async function loadOffers() {
    const response = await fetch("/api/offers");
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(payload.error || `Offer service returned ${response.status}`);
    }

    offers = Array.isArray(payload.offers) ? payload.offers : [];
    updateMetrics();
    renderGroupedOffers(offers);

    if (selectedOffer) {
        selectOffer(offers.find((offer) => String(getOfferId(offer)) === String(getOfferId(selectedOffer))));
    }
}

async function updateStatus(status) {
    console.log("------------------------------------------");
    console.log("📌 [CLIENT] 1. updateStatus triggered with status:", status);
    console.log("📌 [CLIENT] 2. Selected offer state:", selectedOffer);

    if (!selectedOffer) {
        console.warn("⚠️ [CLIENT] No selectedOffer defined!");
        alert("Please select an offer from the log table first.");
        return;
    }

    const offerId = getOfferId(selectedOffer);
    console.log("📌 [CLIENT] 3. Resolved Offer ID:", offerId);

    const payload = {
        offerId: offerId,
        action: status,
        commissionerName: "Commissioner"
    };

    console.log("📌 [CLIENT] 4. Sending POST /api/admin/bids/action with body:", payload);

    try {
        const response = await fetch("/api/admin/bids/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        console.log("📌 [CLIENT] 5. HTTP Response status:", response.status, response.statusText);

        const result = await response.json();
        console.log("📌 [CLIENT] 6. Response payload received:", result);

        if (result.success) {
            console.log("✅ [CLIENT] Action completed successfully!");
            await loadOffers();
        } else {
            console.error("❌ [CLIENT] Backend returned error:", result.error);
            alert("Error: " + (result.error || "Failed to update offer"));
        }
    } catch (err) {
        console.error("❌ [CLIENT] Fetch request failed completely:", err);
        alert("Network error updating bid status.");
    }
}

function showLoadError(error) {
    const tbody = $("offers-table-body");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-rose-400">Unable to load offers: ${escapeHtml(error.message)}</td></tr>`;
    }
    console.error("Unable to load offers:", error);
}

// Initialization
    // Initialization
    async function initializeApp() {
        // Nav Events
        $('nav-master-log')?.addEventListener('click', () => switchTab('master-log'));
        $('nav-team-view')?.addEventListener('click', () => switchTab('team-view'));
        $('nav-settings')?.addEventListener('click', () => switchTab('settings'));
        $('nav-my-team')?.addEventListener('click', () => switchTab('my-team'));
        $('nav-my-team-fa')?.addEventListener('click', () => switchTab('my-team-fa'));

    // Search Event
    $("search-input")?.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = offers.filter(o => 
            (o.player_name || o.to_player || o.player || '').toLowerCase().includes(query) || 
            (o.team_name || o.from_team || o.team || '').toLowerCase().includes(query)
        );
        renderGroupedOffers(filtered);
    });

        let pendingModalAction = null;

        // Unified Action + Direct Team Message Modal Handler
        function openActionMessageModal(mode) {
            if (!selectedOffer) {
                alert("Please select an offer from the table log first.");
                return;
            }

            const team = selectedOffer.team_name || selectedOffer.from_team || "Franchise";
            const player = selectedOffer.player_name || selectedOffer.to_player || "Player";
            const bidId = String(getOfferId(selectedOffer));
            const isAlreadyTopOffer = topOfferIds.has(bidId);

            const configs = {
                APPROVE: {
                    header: `✅ Approve & Sign: ${team}`,
                    statusAction: "ACCEPTED",
                    toggleTopOffer: false,
                    placeholder: `Congratulations! Your offer for ${player} has been accepted and signed.`,
                    submitHtml: `<span>Approve &amp; Send Alert</span> ✅`
                },
                DECLINE: {
                    header: `❌ Decline Offer: ${team}`,
                    statusAction: "DECLINED",
                    toggleTopOffer: false,
                    placeholder: `Your offer for ${player} was declined by the player's agent.`,
                    submitHtml: `<span>Decline &amp; Send Alert</span> ❌`
                },
                EXPIRE: {
                    header: `⏳ Expire Bid: ${team}`,
                    statusAction: "EXPIRED",
                    toggleTopOffer: false,
                    placeholder: `Your pending bid for ${player} has expired.`,
                    submitHtml: `<span>Expire &amp; Send Alert</span> ⏳`
                },
                MESSAGE: {
                    header: `💬 Direct Alert to: ${team}`,
                    statusAction: null,
                    toggleTopOffer: false,
                    placeholder: `Enter custom message or requirements for this franchise...`,
                    submitHtml: `<span>Send Discord Alert</span> 🚀`
                },
                TOP_OFFERS: {
                    header: isAlreadyTopOffer
                        ? `⭐ Remove Top Offer Status: ${team}`
                        : `⭐ Top Offer Alert: ${team}`,
                    statusAction: null,
                    toggleTopOffer: true,
                    placeholder: isAlreadyTopOffer
                        ? `Update on ${player}: Another franchise has moved ahead with a higher offer.`
                        : `You are now a top offer for ${player}. The current top offer is...`,
                    submitHtml: isAlreadyTopOffer
                        ? `<span>Update &amp; Send Alert</span> ⭐`
                        : `<span>Mark Top Offer &amp; Alert</span> ⭐`
                }
            };

            const cfg = configs[mode];
            if (!cfg) return;

            pendingModalAction = cfg;

            // Contract figures
            const aavNum = Number(selectedOffer.aav) || 0;
            const yearsNum = Number(selectedOffer.years) || 1;
            const totalNum = aavNum * yearsNum;

            // Populate Modal Fields
            document.getElementById("msgModalTeamName").textContent = cfg.header;
            document.getElementById("msgModalPlayer").value = player;
            document.getElementById("msgModalAav").textContent = `$${aavNum.toLocaleString()} / yr`;
            document.getElementById("msgModalYears").textContent = `${yearsNum} yr${yearsNum > 1 ? 's' : ''}`;
            document.getElementById("msgModalTotal").textContent = `$${totalNum.toLocaleString()}`;

            const textArea = document.getElementById("msgModalText");
            if (textArea) {
                textArea.value = "";
                textArea.placeholder = cfg.placeholder;
            }

            const submitBtn = document.querySelector("#messageTeamForm button[type='submit']");
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = cfg.submitHtml;
            }

            document.getElementById("messageTeamModal")?.classList.remove("hidden");
            setTimeout(() => textArea?.focus(), 50);
        }

        function closeActionMessageModal() {
            document.getElementById("messageTeamModal")?.classList.add("hidden");
            pendingModalAction = null;
        }

        // Bind all 5 Admin Action buttons to open the popup
        $("btn-approve")?.addEventListener("click", () => openActionMessageModal("APPROVE"));
        $("btn-reject")?.addEventListener("click", () => openActionMessageModal("DECLINE"));
        $("btn-expire")?.addEventListener("click", () => openActionMessageModal("EXPIRE"));
        $("btn-message-team")?.addEventListener("click", () => openActionMessageModal("MESSAGE"));
        $("btn-top-offers")?.addEventListener("click", () => openActionMessageModal("TOP_OFFERS"));

        // Close / Cancel Modal Buttons
        document.getElementById("closeMsgModalBtn")?.addEventListener("click", closeActionMessageModal);
        document.getElementById("cancelMsgBtn")?.addEventListener("click", closeActionMessageModal);

        // Unified Modal Form Submission
        document.getElementById("messageTeamForm")?.addEventListener("submit", async (e) => {
            e.preventDefault();

            const messageText = document.getElementById("msgModalText").value.trim();
            if (!messageText || !selectedOffer || !pendingModalAction) return;

            const offerId = getOfferId(selectedOffer);
            const { statusAction, toggleTopOffer, submitHtml } = pendingModalAction;

            const submitBtn = e.target.querySelector("button[type='submit']");
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = "Sending...";
            }

            try {
                // 1. Run status update if Approve / Decline / Expire was clicked
                if (statusAction) {
                    await updateStatus(statusAction);
                }

                // 2. Toggle Top Offer star in the table if Top Offers was clicked
                if (toggleTopOffer) {
                    const bidId = String(offerId);
                    if (topOfferIds.has(bidId)) {
                        topOfferIds.delete(bidId);
                    } else {
                        topOfferIds.add(bidId);
                    }
                    renderGroupedOffers(offers);
                }

                // 3. Send the custom message to the team's Discord channel
                const response = await fetch("/api/admin/bids/message", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        offerId: offerId,
                        message: messageText,
                        commissionerName: "Commissioner"
                    })
                });

                const data = await response.json();

            } catch (err) {
                console.error("Action/Message error:", err);
                showLoadError(err);
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = submitHtml;
                }
            }
        });

    try {
        const profileCardBtn = document.getElementById("userProfileCard");
        const profileDropdown = document.getElementById("profileDropdownMenu");

        profileCardBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            profileDropdown?.classList.toggle("hidden");
        });

        // Close dropdown when clicking anywhere outside
        document.addEventListener("click", (e) => {
            if (!profileDropdown?.contains(e.target) && !profileCardBtn?.contains(e.target)) {
                profileDropdown?.classList.add("hidden");
            }
        });

        document.getElementById("logoutBtn")?.addEventListener("click", () => {
            profileDropdown?.classList.add("hidden");
            clearUserSession();
            renderTopProfileBar(null);
            updateFranchiseCard({ linked: false });
        });

        document.getElementById("headerLeagueSelect")?.addEventListener("change", (e) => {
            const selectedLeagueId = e.target.value;
            localStorage.setItem(SESSION_KEY_LEAGUE, selectedLeagueId);
            console.log("⚡ Active League Context set to:", selectedLeagueId);
            loadOffers();
        });

        document.getElementById("cap-sort-select")?.addEventListener("change", () => {
            renderTeamSummaries(false);
        });

        // Handle OAuth Callback Params & Session Persistence
        const existingSession = getStoredUserSession();
        const urlParams = new URLSearchParams(window.location.search);
        const discordId = urlParams.get("discordId");
        const username = urlParams.get("username");
        const avatar = urlParams.get("avatar");
        const teamName = urlParams.get("teamName");
        const guildId = urlParams.get("guildId");

        if (discordId) {
            // Save fresh OAuth login session (including guildId) to localStorage
            const newSession = { discordId, username, avatar, teamName, guildId };
            saveUserSession(newSession);
            if (guildId) {
                localStorage.setItem(SESSION_KEY_LEAGUE, guildId);
            }
            renderTopProfileBar(newSession);

            window.history.replaceState({}, document.title, window.location.pathname);
        } else if (existingSession) {
            if (existingSession.guildId && !localStorage.getItem(SESSION_KEY_LEAGUE)) {
                localStorage.setItem(SESSION_KEY_LEAGUE, existingSession.guildId);
            }
            renderTopProfileBar(existingSession);
        }
        switchTab('team-view');
        await loadOffers();
    } catch (error) {
        showLoadError(error);
    }
}

async function loadFranchiseIdentity(discordId, guildId = '') {
    try {
        const response = await fetch(`/api/user/franchise-identity?discordId=${encodeURIComponent(discordId)}&guildId=${encodeURIComponent(guildId || '')}`);
        const data = await response.json();

        // Target UI Elements
        const identityBadge = document.querySelector('.franchise-badge') || document.getElementById('identity-badge');
        const teamNameEl = document.getElementById('franchise-team-name');
        const usernameEl = document.getElementById('franchise-username');
        const capStatusEl = document.getElementById('franchise-cap-status');

        if (data.linked) {
            if (identityBadge) {
                identityBadge.textContent = "LINKED";
                identityBadge.classList.remove('unlinked');
                identityBadge.classList.add('linked');
                identityBadge.style.color = "#34D399";
            }
            if (teamNameEl) teamNameEl.textContent = data.teamName;
            if (usernameEl) usernameEl.textContent = data.username;
            if (capStatusEl) capStatusEl.textContent = data.capStatus;
        } else {
            if (identityBadge) {
                identityBadge.textContent = "UNLINKED";
                identityBadge.classList.remove('linked');
                identityBadge.classList.add('unlinked');
                identityBadge.style.color = "#EF4444";
            }
            if (teamNameEl) teamNameEl.textContent = "No Team Linked";
            if (usernameEl) usernameEl.textContent = "Guest / Unknown";
            if (capStatusEl) capStatusEl.textContent = "Pending Auth";
        }
    } catch (err) {
        console.error("Failed to load franchise identity:", err);
    }
}

window.loginWithDiscord = async function() {
    try {
        const configRes = await fetch('/api/config');
        const configData = await configRes.json().catch(() => ({}));
        const clientId = configData.clientId;

        if (!clientId) {
            alert("Client ID is missing from server configuration.");
            return;
        }

        const rawOrigin = window.location.origin;
        const cleanOrigin = rawOrigin.replace(/:5000$/, '');
        const cleanRedirectUri = `${cleanOrigin}/auth/discord/callback`;

        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: cleanRedirectUri,
            response_type: "code",
            scope: "identify guilds.members.read",
            state: window.location.pathname
        });

        window.location.href = `https://discord.com/oauth2/authorize?${params.toString()}`;
    } catch (err) {
        console.error("Failed to start Discord authentication:", err);
    }
};

function parseMoneyInput(val) {
    if (!val) return 0;
    const str = String(val).trim().toUpperCase().replace(/[$,\s]/g, "");
    if (str.endsWith("M")) return (parseFloat(str.slice(0, -1)) || 0) * 1_000_000;
    if (str.endsWith("K")) return (parseFloat(str.slice(0, -1)) || 0) * 1_000;
    return parseFloat(str) || 0;
}

async function initSubmitBidView() {
    const session = typeof getStoredUserSession === "function" ? getStoredUserSession() : null;
    const guildId = session?.guildId || localStorage.getItem(SESSION_KEY_LEAGUE) || "";
    const teamEl = document.getElementById("bidIdentityTeamName");
    const badgeEl = document.getElementById("bidIdentityStatusBadge");

    if (session?.teamName) {
        if (teamEl) teamEl.textContent = session.teamName;
        if (badgeEl) {
            badgeEl.textContent = "LINKED";
            badgeEl.className = "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
        }
    } else {
        if (teamEl) teamEl.textContent = "Login Required";
        if (badgeEl) {
            badgeEl.textContent = "UNLINKED";
            badgeEl.className = "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-rose-500/10 text-rose-400 border border-rose-500/30";
        }
    }

    // Ensure league cap cache is populated so we can show this team's real cap space
    if (cachedLeagueTeams.length === 0) {
        await renderTeamSummaries(true);
    }

    // Lock & fade Contract Offer Details if FA bidding is closed
    const formEl = document.getElementById("faSubmitBidForm");
    const closedBanner = document.getElementById("faClosedBanner");
    const statusBadge = document.getElementById("faBiddingStatusBadge");
    const statusDot = document.getElementById("faBiddingStatusDot");
    const statusText = document.getElementById("faBiddingStatusText");

    if (!isLeagueFaOpen) {
        closedBanner?.classList.remove("hidden");
        formEl?.classList.add("opacity-40", "pointer-events-none", "select-none");
        formEl?.querySelectorAll("input, select, textarea, button").forEach(el => {
            el.disabled = true;
        });

        if (statusBadge) {
            statusBadge.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/30";
        }
        if (statusDot) {
            statusDot.className = "w-1.5 h-1.5 rounded-full bg-rose-400";
        }
        if (statusText) {
            statusText.textContent = "Bidding Closed";
        }
    } else {
        closedBanner?.classList.add("hidden");
        formEl?.classList.remove("opacity-40", "pointer-events-none", "select-none");
        formEl?.querySelectorAll("input, select, textarea, button").forEach(el => {
            el.disabled = false;
        });

        if (statusBadge) {
            statusBadge.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
        }
        if (statusDot) {
            statusDot.className = "w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse";
        }
        if (statusText) {
            statusText.textContent = "Bidding Open";
        }
    }

    const myTeamData = session?.teamName
        ? cachedLeagueTeams.find(t => t.teamName.toLowerCase().trim() === session.teamName.toLowerCase().trim())
        : null;

    const currentCap = myTeamData ? Number(myTeamData.capSpace) || 0 : 0;

    // Count active pending bids for this team from loaded offers
    const myPendingOffers = session?.teamName
        ? offers.filter(o =>
            String(o.from_team || o.team_name || "").toLowerCase().trim() === session.teamName.toLowerCase().trim() &&
            String(o.status || "PENDING").toUpperCase() === "PENDING"
        )
        : [];
    const activeBidsCount = myPendingOffers.length;
    let maxBidsPerTeam = null;
    if (guildId) {
        try {
            const cfgRes = await fetch(`/api/league/fa-settings?guildId=${encodeURIComponent(guildId)}`);
            const cfgData = await cfgRes.json();
            if (cfgRes.ok && cfgData.success) {
                maxBidsPerTeam = cfgData.maxBidsPerTeam;
            }
        } catch {}
    }

    const activeBidEl = $("bidActiveCount");
    const submitBtn = $("submitFaOfferBtn");

    if (activeBidEl) {
        if (maxBidsPerTeam && maxBidsPerTeam > 0) {
            const remaining = Math.max(0, maxBidsPerTeam - activeBidsCount);
            activeBidEl.textContent = `${activeBidsCount} / ${maxBidsPerTeam} (${remaining} Left)`;

            if (remaining === 0) {
                activeBidEl.className = "text-xs font-black text-rose-400 mt-1";
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.classList.add("opacity-50", "cursor-not-allowed");
                    submitBtn.innerHTML = `<span>🚫</span><span>Bid Limit Reached (${activeBidsCount}/${maxBidsPerTeam} Active)</span>`;
                }
                const feedback = document.getElementById("bidSubmitFeedback");
                if (feedback) {
                    feedback.textContent = `🚫 You have ${activeBidsCount} active bids (league max: ${maxBidsPerTeam}). Withdraw an offer to continue`;
                    feedback.className = "text-xs font-semibold px-3.5 py-2.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/30";
                    feedback.classList.remove("hidden");
                }
            } else {
                activeBidEl.className = "text-xs font-black text-purple-400 mt-1";
                if (submitBtn && isLeagueFaOpen) {
                    submitBtn.disabled = false;
                    submitBtn.classList.remove("opacity-50", "cursor-not-allowed");
                    submitBtn.innerHTML = `<span>⚡</span><span>Submit Free Agency Offer</span>`;
                }
            }
        } else {
            activeBidEl.textContent = `${activeBidsCount} Bid${activeBidsCount === 1 ? "" : "s"}`;
            activeBidEl.className = "text-xs font-black text-purple-400 mt-1";
            if (submitBtn && isLeagueFaOpen) {
                submitBtn.disabled = false;
                submitBtn.classList.remove("opacity-50", "cursor-not-allowed");
                submitBtn.innerHTML = `<span>⚡</span><span>Submit Free Agency Offer</span>`;
            }
        }
    }

    const pendingCapHold = myPendingOffers.reduce((sum, o) => sum + (Number(o.aav) || 0), 0);
    const projectedCap = currentCap - pendingCapHold;

    const fmt = (n) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    document.getElementById("bidCapAvailable").textContent = fmt(currentCap);
    document.getElementById("bidProjectedCap").textContent = fmt(projectedCap);
    const updateLivePreview = () => {
        const pName = document.getElementById("bidPlayerName")?.value.trim() || "Select Player";
        const aavNum = parseMoneyInput(document.getElementById("bidBaseSalary")?.value);
        const capAfter = projectedCap - aavNum;

        document.getElementById("bidPreviewPlayer").textContent = pName;
        document.getElementById("bidPreviewAav").textContent = fmt(aavNum);

        const afterEl = document.getElementById("bidPreviewCapAfter");
        if (afterEl) {
            afterEl.textContent = fmt(capAfter);
            afterEl.className = `text-sm font-black font-mono mt-1 ${capAfter < 0 ? "text-rose-400" : "text-amber-400"}`;
        }
    };

    const form = document.getElementById("faSubmitBidForm");
    if (form && !form.dataset.bound) {
        form.dataset.bound = "true";

        document.getElementById("bidPlayerName")?.addEventListener("input", updateLivePreview);
        document.getElementById("bidBaseSalary")?.addEventListener("input", updateLivePreview);

        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const feedback = document.getElementById("bidSubmitFeedback");
            const submitBtn = document.getElementById("submitFaOfferBtn");
            const activeSession = typeof getStoredUserSession === "function" ? getStoredUserSession() : null;

            if (!activeSession?.teamName) {
                feedback.textContent = "Please log in with Discord first so your offer is linked to your franchise.";
                feedback.className = "text-xs font-semibold px-3.5 py-2.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/30";
                feedback.classList.remove("hidden");
                return;
            }

            const playerName = document.getElementById("bidPlayerName").value.trim();
            const aav = parseMoneyInput(document.getElementById("bidBaseSalary").value);
            const years = parseInt(document.getElementById("bidYears").value, 10) || 1;
            const guaranteed = parseMoneyInput(document.getElementById("bidGuaranteed").value);
            const signingBonus = parseMoneyInput(document.getElementById("bidSigningBonus").value);
            const notes = document.getElementById("bidNotes").value.trim();

            if (!playerName || aav <= 0) {
                feedback.textContent = "Enter a valid player name and base salary / AAV.";
                feedback.className = "text-xs font-semibold px-3.5 py-2.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/30";
                feedback.classList.remove("hidden");
                return;
            }

            submitBtn.disabled = true;
            submitBtn.innerHTML = `<span>⏳</span><span>Submitting Offer...</span>`;

            try {
                const res = await fetch("/api/offers", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        playerName,
                        teamName: activeSession.teamName,
                        discordId: activeSession.discordId,
                        guildId: activeSession.guildId,
                        aav,
                        years,
                        guaranteed,
                        bonuses: signingBonus,
                        notes
                    })
                });

const result = await res.json();
                if (!res.ok) throw new Error(result.error || "Failed to submit offer");

                feedback.textContent = `✅ Offer submitted for ${playerName} ($${aav.toLocaleString()} AAV / ${years} yr${years > 1 ? "s" : ""})!`;
                feedback.className = "text-xs font-semibold px-3.5 py-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
                feedback.classList.remove("hidden");

                form.reset();
                submitBtn.innerHTML = `<span>⚡</span><span>Submit Free Agency Offer</span>`;
                if (typeof loadOffers === "function") await loadOffers();
                await initSubmitBidView();
            } catch (err) {
                feedback.textContent = `❌ ${err.message}`;
                feedback.className = "text-xs font-semibold px-3.5 py-2.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/30";
                feedback.classList.remove("hidden");
                submitBtn.disabled = false;
                submitBtn.innerHTML = `<span>⚡</span><span>Submit Free Agency Offer</span>`;
            }
        });
    }

    updateLivePreview();
}

document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const discordId = urlParams.get("discordId");
    const guildId = urlParams.get("guildId") || urlParams.get("guild_id") || "";

    // 🛠️ FIX: Fire identity lookup whenever discordId is present (guildId is optional)
    if (discordId) {
        loadFranchiseIdentity(discordId, guildId);
    }
});

let teamMetrics = { capAvailable: 0, committedBidsAAV: 0, activeBidCount: 0 };

// 1. Update Franchise Card details dynamically
function updateFranchiseCard(userData) {
    const teamNameEl = document.getElementById("cardTeamName");

    if (userData && userData.team_name) {
        teamNameEl.textContent = userData.team_name;
        // Load real financial data from backend API
        loadTeamFinancials(userData.team_name, userData.guild_id);
    } else {
        teamNameEl.textContent = "Free Agent";
    }
}

// 2. Fetch metrics for team
async function loadTeamFinancials(teamName, guildId) {
    try {
        const res = await fetch(`/api/team-financials?teamName=${encodeURIComponent(teamName)}&guildId=${guildId}`);
        if (!res.ok) return;
        const data = await res.json();

        teamMetrics.capAvailable = data.capAvailable || 0;
        teamMetrics.committedBidsAAV = data.committedBidsAAV || 0;
        teamMetrics.activeBidCount = data.activeBidCount || 0;

        renderFinancialSummary();
    } catch (err) {
        console.error("Failed to load team financials:", err);
    }
}

// 3. Render and calculate live values
function renderFinancialSummary(currentOfferAAV = 0) {
    const projectedRemaining = teamMetrics.capAvailable - teamMetrics.committedBidsAAV;
    const capAfterDeal = projectedRemaining - currentOfferAAV;

    const fmt = (val) => `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    if (document.getElementById("statCapAvailable")) document.getElementById("statCapAvailable").textContent = fmt(teamMetrics.capAvailable);
    if (document.getElementById("statProjectedCap")) document.getElementById("statProjectedCap").textContent = fmt(projectedRemaining);
    if (document.getElementById("statActiveBids")) document.getElementById("statActiveBids").textContent = `${teamMetrics.activeBidCount} Active`;

    const capAfterEl = document.getElementById("statCapAfterCurrentDeal");
    if (capAfterEl) {
        capAfterEl.textContent = fmt(capAfterDeal);
        capAfterEl.className = capAfterDeal < 0 ? "text-base font-extrabold text-rose-500" : "text-base font-extrabold text-amber-400";
    }
}


// Auto-check identity on page load
document.addEventListener("DOMContentLoaded", async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const discordId = urlParams.get("discordId");
    const guildId = urlParams.get("guildId") || urlParams.get("guild_id") || "";
    const storedSession = getStoredUserSession();

    if (discordId) {
        loadFranchiseIdentity(discordId, guildId);
    } else if (storedSession?.discordId) {
        loadFranchiseIdentity(storedSession.discordId);
    } else {
        updateFranchiseCard({ linked: false });
    }
});

async function renderMyTeamFa() {
    const tbody = $("my-team-fa-tbody");
    if (!tbody) return;

    const filterSelect = $("my-fa-status-filter");
    if (filterSelect && !filterSelect.dataset.listenerBound) {
        filterSelect.addEventListener("change", () => renderMyTeamFa());
        filterSelect.dataset.listenerBound = "true";
    }

    const refreshBtn = $("refresh-my-fa-btn");
    if (refreshBtn && !refreshBtn.dataset.listenerBound) {
        refreshBtn.addEventListener("click", () => renderMyTeamFa());
        refreshBtn.dataset.listenerBound = "true";
    }

    const session = typeof getStoredUserSession === "function" ? getStoredUserSession() : null;
    const teamName = (session?.teamName || "").trim();

    if (!teamName) {
        setText("my-fa-team-title", "My Team Free Agency");
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="px-4 py-8 text-center text-amber-400">
                    Log in with Discord and link your franchise to view your team's Free Agency bids.
                </td>
            </tr>`;
        return;
    }

    setText("my-fa-team-title", `${teamName}`);
    tbody.innerHTML = `
        <tr>
            <td colspan="7" class="px-4 py-8 text-center text-slate-400 animate-pulse">
                Fetching submitted offers for ${escapeHtml(teamName)}...
            </td>
        </tr>`;

    try {
        // Ensure cap cache is populated so Available Cap Space card displays accurately
        if (typeof cachedLeagueTeams !== "undefined" && cachedLeagueTeams.length === 0 && typeof renderTeamSummaries === "function") {
            await renderTeamSummaries(false);
        }

        const myCapObj = (typeof cachedLeagueTeams !== "undefined" ? cachedLeagueTeams : []).find(
            t => t.teamName.toLowerCase().trim() === teamName.toLowerCase()
        );
        if (myCapObj) {
            setText("my-fa-cap-space", myCapObj.capSpaceFormatted || "$0");
        }

        const params = new URLSearchParams({ teamName });
        if (session?.guildId) params.set("guildId", session.guildId);

        const res = await fetch(`/api/offers/my-team?${params.toString()}`);
        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(data.error || "Failed to load team offers.");
        }

        const allOffers = data.offers || [];

        // Calculate KPI metrics across all team bids
        const pendingOffers = allOffers.filter(o => (o.status || "PENDING").toUpperCase() === "PENDING");
        const signedOffers = allOffers.filter(o => ["ACCEPTED", "SIGNED"].includes((o.status || "").toUpperCase()));
        const pendingAavTotal = pendingOffers.reduce((sum, o) => sum + (Number(o.aav) || 0), 0);

        setText("my-fa-pending-count", String(pendingOffers.length));
        setText("my-fa-pending-aav", `$${pendingAavTotal.toLocaleString("en-US")}`);
        setText("my-fa-signed-count", String(signedOffers.length));

        // Apply dropdown status filter
        const statusFilter = (filterSelect?.value || "ALL").toUpperCase();
        const filteredOffers = allOffers.filter(o => {
            const st = (o.status || "PENDING").toUpperCase();
            if (statusFilter === "ALL") return true;
            if (statusFilter === "ACCEPTED") return st === "ACCEPTED" || st === "SIGNED";
            if (statusFilter === "OUTBID") return st === "OUTBID" || st === "EXPIRED";
            return st === statusFilter;
        });

        if (filteredOffers.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="px-4 py-8 text-center text-slate-500">
                        No ${statusFilter === "ALL" ? "" : statusFilter.toLowerCase() + " "}offers found for ${escapeHtml(teamName)}.
                    </td>
                </tr>`;
            return;
        }

        const statusBadge = (rawStatus) => {
            const st = (rawStatus || "PENDING").toUpperCase();
            if (st === "ACCEPTED" || st === "SIGNED") {
                return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">${escapeHtml(st)}</span>`;
            }
            if (st === "DECLINED" || st === "REJECTED") {
                return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">${escapeHtml(st)}</span>`;
            }
            if (st === "OUTBID" || st === "EXPIRED") {
                return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">${escapeHtml(st)}</span>`;
            }
            return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">${escapeHtml(st)}</span>`;
        };

    tbody.innerHTML = filteredOffers.map(offer => {
        const aavNum = Number(offer.aav) || 0;
        const yearsNum = Number(offer.years) || 1;
        const totalVal = aavNum * yearsNum;
        const dateStr = offer.created_at
            ? new Date(offer.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
            : "--";
        const metaText = [offer.bonuses, offer.notes].filter(Boolean).join(" • ") || "—";

        const statusUpper = String(offer.status || "PENDING").toUpperCase();
        const isPending = statusUpper === "PENDING";
        const offerId = getOfferId(offer);
        const playerName = offer.to_player || "Unknown";

        const actionsHtml = isPending
            ? `<div class="inline-flex items-center justify-end gap-2">
                   <button type="button"
                           onclick="openReviseOfferModal('${escapeHtml(offerId)}')"
                           class="px-2.5 py-1 rounded-md text-[11px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors">
                       Revise
                   </button>
                   <button type="button"
                           onclick="withdrawTeamOffer('${escapeHtml(offerId)}', '${escapeHtml(playerName)}')"
                           class="px-2.5 py-1 rounded-md text-[11px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20 transition-colors">
                       Withdraw
                   </button>
               </div>`
            : `<span class="text-xs text-slate-600">—</span>`;

        return `
            <tr class="hover:bg-slate-800/40 transition-colors">
                <td class="px-4 py-3 text-slate-400 whitespace-nowrap">${escapeHtml(dateStr)}</td>
                <td class="px-4 py-3 font-bold text-white whitespace-nowrap">${escapeHtml(playerName)}</td>
                <td class="px-4 py-3 font-mono font-bold text-emerald-400 whitespace-nowrap">$${aavNum.toLocaleString("en-US")}</td>
                <td class="px-4 py-3 text-slate-300 whitespace-nowrap">${yearsNum} yr${yearsNum === 1 ? "" : "s"}</td>
                <td class="px-4 py-3 font-mono text-slate-200 whitespace-nowrap">$${totalVal.toLocaleString("en-US")}</td>
                <td class="px-4 py-3 text-slate-400 max-w-xs truncate" title="${escapeHtml(metaText)}">${escapeHtml(metaText)}</td>
                <td class="px-4 py-3 whitespace-nowrap">${statusBadge(offer.status)}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">${actionsHtml}</td>
            </tr>
        `;
    }).join("");
    } catch (err) {
    tbody.innerHTML = `
        <tr>
            <td colspan="8" class="px-4 py-6 text-center text-rose-400">
                Failed to load team offers: ${escapeHtml(err.message)}
            </td>
        </tr>`;
    }
}

async function initFaSettingsView() {
    const input = $("setting-max-bids");
    const form = $("faSettingsForm");
    const feedback = $("faSettingsFeedback");
    if (!input || !form) return;

    const session = getStoredUserSession();
    const guildId = session?.guildId || localStorage.getItem(SESSION_KEY_LEAGUE) || "";

    if (feedback) feedback.classList.add("hidden");

    if (guildId) {
        try {
            const res = await fetch(`/api/league/fa-settings?guildId=${encodeURIComponent(guildId)}`);
            const data = await res.json();
            if (res.ok && data.success) {
                input.value = data.maxBidsPerTeam !== null ? String(data.maxBidsPerTeam) : "";
            }
        } catch (err) {
            console.warn("Failed to load FA settings:", err);
        }
    }

    if (!form.dataset.listenerBound) {
        form.dataset.listenerBound = "true";
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const currentSession = getStoredUserSession();
            const activeGuildId = currentSession?.guildId || localStorage.getItem(SESSION_KEY_LEAGUE) || "";
            if (!activeGuildId) {
                alert("Please log in with Discord first.");
                return;
            }

            const saveBtn = $("saveFaSettingsBtn");
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = "Saving...";
            }

            try {
                const res = await fetch("/api/league/fa-settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        guildId: activeGuildId,
                        maxBidsPerTeam: input.value.trim() === "" ? null : Number(input.value)
                    })
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || "Failed to save FA settings.");
                }

                if (feedback) {
                    feedback.textContent = data.maxBidsPerTeam
                        ? `✓ Saved! Teams are now capped at ${data.maxBidsPerTeam} active bids.`
                        : "✓ Saved! Bid limit disabled (unlimited active bids).";
                    feedback.className = "text-xs font-semibold px-3 py-2 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30";
                    feedback.classList.remove("hidden");
                }
            } catch (err) {
                if (feedback) {
                    feedback.textContent = `✕ ${err.message}`;
                    feedback.className = "text-xs font-semibold px-3 py-2 rounded-lg bg-rose-500/15 text-rose-400 border border-rose-500/30";
                    feedback.classList.remove("hidden");
                }
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = "Save FA Settings";
                }
            }
        });
    }
}

function openReviseOfferModal(offerId) {
    const offer = offers.find(o => String(getOfferId(o)) === String(offerId));
    if (!offer) return;

    $("reviseOfferId").value = offerId;
    $("reviseModalPlayer").textContent = offer.player_name || offer.player || "Free Agent";
    $("reviseOfferAav").value = offer.aav || "";
    $("reviseOfferYears").value = String(offer.years || 1);
    $("reviseOfferGuaranteed").value = offer.guaranteed || "";
    $("reviseOfferBonus").value = offer.bonuses || offer.signing_bonus || "";
    $("reviseOfferNotes").value = offer.notes || "";

    const feedback = $("reviseOfferFeedback");
    if (feedback) feedback.classList.add("hidden");

    $("reviseOfferModal")?.classList.remove("hidden");
}

function closeReviseOfferModal() {
    $("reviseOfferModal")?.classList.add("hidden");
}

async function withdrawTeamOffer(offerId, playerName) {
    const session = getStoredUserSession();
    if (!session?.teamName) return;

    if (!confirm(`Withdraw your pending offer for ${playerName}? This will free up your bid slot and cap hold.`)) {
        return;
    }

    try {
        const res = await fetch(`/api/offers/${encodeURIComponent(offerId)}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ teamName: session.teamName })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.error || "Failed to withdraw offer.");
        }

        if (typeof loadOffers === "function") await loadOffers();
        await renderMyTeamFa();
    } catch (err) {
        alert(`Error withdrawing offer: ${err.message}`);
    }
}

// Bind Revise Offer form submit once on DOM load
document.getElementById("reviseOfferForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const session = getStoredUserSession();
    const feedback = $("reviseOfferFeedback");
    const saveBtn = $("saveRevisedOfferBtn");

    if (!session?.teamName) return;

    const offerId = $("reviseOfferId").value;
    const aav = parseMoneyInput($("reviseOfferAav").value);
    const years = parseInt($("reviseOfferYears").value, 10) || 1;
    const guaranteed = parseMoneyInput($("reviseOfferGuaranteed").value);
    const bonuses = parseMoneyInput($("reviseOfferBonus").value);
    const notes = $("reviseOfferNotes").value.trim();

    if (aav <= 0) {
        if (feedback) {
            feedback.textContent = "Enter a valid AAV greater than $0.";
            feedback.className = "text-xs font-semibold px-3 py-2 rounded-lg bg-rose-500/15 text-rose-400 border border-rose-500/30";
            feedback.classList.remove("hidden");
        }
        return;
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
    }

    try {
        const res = await fetch(`/api/offers/${encodeURIComponent(offerId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                teamName: session.teamName,
                guildId: session.guildId || localStorage.getItem(SESSION_KEY_LEAGUE) || "",
                aav,
                years,
                guaranteed,
                bonuses,
                notes
            })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.error || "Failed to revise offer.");
        }

        closeReviseOfferModal();
        if (typeof loadOffers === "function") await loadOffers();
        await renderMyTeamFa();
    } catch (err) {
        if (feedback) {
            feedback.textContent = `✕ ${err.message}`;
            feedback.className = "text-xs font-semibold px-3 py-2 rounded-lg bg-rose-500/15 text-rose-400 border border-rose-500/30";
            feedback.classList.remove("hidden");
        }
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = "Save Revised Offer";
        }
    }
});


function switchMasterLogMode(mode) {
    masterLogMode = mode;

    const tabs = {
        agent: $("tabAgentOffers"),
        unassigned: $("tabUnassignedOffers"),
        all: $("tabAllOffers")
    };

    const activeClasses = ["bg-cyan-500/15", "text-cyan-400", "border", "border-cyan-500/30"];
    const inactiveClasses = ["text-slate-400", "hover:text-white", "hover:bg-slate-800"];

    Object.entries(tabs).forEach(([key, el]) => {
        if (!el) return;
        if (key === mode) {
            el.classList.add(...activeClasses);
            el.classList.remove(...inactiveClasses);
        } else {
            el.classList.remove(...activeClasses);
            el.classList.add(...inactiveClasses);
        }
    });

    const searchInput = $("search-input");
    if (searchInput && searchInput.value.trim()) {
        searchInput.dispatchEvent(new Event("input"));
    } else {
        renderGroupedOffers(offers);
    }
}

function getVisibleMasterOffers(allOffers) {
    const list = Array.isArray(allOffers) ? allOffers : [];

    // 1. ALL OFFERS
    if (masterLogMode === "all") {
        return list;
    }

    // 2. UNASSIGNED OFFERS (No agent assigned yet)
    if (masterLogMode === "unassigned") {
        return list.filter(o => {
            const agentId = String(o.agent_discord_id || o.agentDiscordId || "").trim();
            const agentLabel = String(o.agent_assigned || o.agentAssigned || "").trim();
            return !agentId && (!agentLabel || agentLabel === "@Commissioner" || agentLabel === "--");
        });
    }

    // 3. AGENT OFFERS (Default: only players assigned to logged-in user, excluding own team's targets)
    const session = typeof getStoredUserSession === "function" ? getStoredUserSession() : null;
    const myDiscordId = String(session?.discordId || session?.id || "").trim();
    const myTeam = String(session?.teamName || "").toLowerCase().trim();

    if (!myDiscordId) return [];

    // Find every player where the logged-in user's own franchise has an offer
    const myBiddedPlayers = new Set();
    if (myTeam) {
        list.forEach(o => {
            const team = String(o.from_team || o.team_name || o.team || "").toLowerCase().trim();
            const player = String(o.to_player || o.player_name || o.playerName || "").toLowerCase().trim();
            if (team && player && team === myTeam) {
                myBiddedPlayers.add(player);
            }
        });
    }

    return list.filter(o => {
        const assignedId = String(o.agent_discord_id || o.agentDiscordId || "").trim();
        const player = String(o.to_player || o.player_name || o.playerName || "").toLowerCase().trim();
        if (!assignedId || assignedId !== myDiscordId) return false;
        if (player && myBiddedPlayers.has(player)) return false;
        return true;
    });
}

const AGENT_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB", "IDP"];
function toggleAgentModePanels() {
    const mode = $("setting-agent-mode")?.value || "manual";
    const posPanel = $("agentPositionPanel");
    if (posPanel) {
        if (mode === "position") posPanel.classList.remove("hidden");
        else posPanel.classList.add("hidden");
    }
}

async function initAgentSettingsUI() {
    const session = typeof getStoredUserSession === "function" ? getStoredUserSession() : null;
    const guildId = session?.guildId || localStorage.getItem(SESSION_KEY_LEAGUE) || "";
    if (!guildId) return;

    try {
        const res = await fetch(`/api/league/agents?guildId=${encodeURIComponent(guildId)}`);
        const data = await res.json();
        if (!res.ok || !data.success) return;

        const roleSelect = $("setting-agent-role");
        if (roleSelect) {
            roleSelect.innerHTML = `<option value="">Select Discord Role...</option>` +
                (data.roles || []).map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join("");
            roleSelect.value = data.agentRoleId || "";
        }

        const modeSelect = $("setting-agent-mode");
        if (modeSelect) {
            modeSelect.value = data.agentAssignmentMode || "manual";
            toggleAgentModePanels();
        }

        const agentOptionsHtml = `<option value="">Unassigned</option>` +
            (data.agents || []).map(a => `<option value="${escapeHtml(a.discordId)}" data-name="${escapeHtml(a.username)}">@${escapeHtml(a.username)}</option>`).join("");

        // Populate Position -> Agent dropdowns
        const posGrid = $("agentPositionGrid");
        if (posGrid) {
            const savedPosMap = data.agentPositionMap || {};
            posGrid.innerHTML = AGENT_POSITIONS.map(pos => `
                <div class="bg-slate-900 border border-slate-800 rounded-lg p-2">
                    <label class="block text-[10px] font-bold text-slate-400 mb-1">${pos}</label>
                    <select data-pos-agent="${pos}" class="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-100">
                        ${agentOptionsHtml}
                    </select>
                </div>
            `).join("");

            AGENT_POSITIONS.forEach(pos => {
                const sel = posGrid.querySelector(`select[data-pos-agent="${pos}"]`);
                if (sel && savedPosMap[pos]) sel.value = savedPosMap[pos];
            });
        }

        // Populate Per-Player Manual Assignment rows
        const playerList = $("agentPlayerAssignList");
        if (playerList) {
            const players = data.playerAgents || [];
            if (players.length === 0) {
                playerList.innerHTML = `<p class="text-[11px] text-slate-500">No active players with bids yet.</p>`;
            } else {
                playerList.innerHTML = players.map(p => `
                    <div class="flex items-center justify-between gap-2 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5">
                        <span class="font-semibold text-slate-200 truncate">${escapeHtml(p.playerName)}</span>
                        <select data-player-agent="${escapeHtml(p.playerName)}" class="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-100 max-w-[160px]">
                            ${agentOptionsHtml}
                        </select>
                    </div>
                `).join("");

                players.forEach(p => {
                    const sel = playerList.querySelector(`select[data-player-agent="${CSS.escape(p.playerName)}"]`);
                    if (sel && p.agentDiscordId) sel.value = p.agentDiscordId;
                });
            }
        }
    } catch (err) {
        console.error("Failed to load agent settings UI:", err);
    }
}

async function saveAgentSettings() {
    const session = typeof getStoredUserSession === "function" ? getStoredUserSession() : null;
    const guildId = session?.guildId || localStorage.getItem(SESSION_KEY_LEAGUE) || "";
    const feedback = $("agentSettingsFeedback");
    if (!guildId) return;

    const agentRoleId = $("setting-agent-role")?.value || "";
    const agentAssignmentMode = $("setting-agent-mode")?.value || "manual";

    const agentPositionMap = {};
    document.querySelectorAll("select[data-pos-agent]").forEach(sel => {
        if (sel.value) agentPositionMap[sel.dataset.posAgent] = sel.value;
    });

    const manualAssignments = [];
    document.querySelectorAll("select[data-player-agent]").forEach(sel => {
        const selectedOpt = sel.options[sel.selectedIndex];
        const username = selectedOpt?.dataset?.name || "";
        manualAssignments.push({
            playerName: sel.dataset.playerAgent,
            agentDiscordId: sel.value || null,
            agentAssigned: sel.value && username ? `@${username}` : "@Commissioner"
        });
    });

    try {
        const res = await fetch("/api/league/agent-settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guildId, agentRoleId, agentAssignmentMode, agentPositionMap, manualAssignments })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "Failed to save agent settings.");

        if (feedback) {
            feedback.textContent = "✅ Agent settings & player assignments saved!";
            feedback.className = "text-xs font-semibold px-3 py-2 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30";
            feedback.classList.remove("hidden");
        }
        await initAgentSettingsUI();
        if (typeof loadOffers === "function") await loadOffers();
    } catch (err) {
        if (feedback) {
            feedback.textContent = `✕ ${err.message}`;
            feedback.className = "text-xs font-semibold px-3 py-2 rounded-lg bg-rose-500/15 text-rose-400 border border-rose-500/30";
            feedback.classList.remove("hidden");
        }
    }
}

async function runAutoAssignAgents() {
    const session = typeof getStoredUserSession === "function" ? getStoredUserSession() : null;
    const guildId = session?.guildId || localStorage.getItem(SESSION_KEY_LEAGUE) || "";
    const feedback = $("agentSettingsFeedback");
    if (!guildId) return;

    try {
        const res = await fetch("/api/league/assign-agents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guildId })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "Auto-assign failed.");

        if (feedback) {
            feedback.textContent = `⚡ Auto-assigned ${data.assignedCount} unassigned player(s)!`;
            feedback.className = "text-xs font-semibold px-3 py-2 rounded-lg bg-cyan-500/15 text-cyan-400 border border-cyan-500/30";
            feedback.classList.remove("hidden");
        }
        await initAgentSettingsUI();
        if (typeof loadOffers === "function") await loadOffers();
    } catch (err) {
        if (feedback) {
            feedback.textContent = `✕ ${err.message}`;
            feedback.className = "text-xs font-semibold px-3 py-2 rounded-lg bg-rose-500/15 text-rose-400 border border-rose-500/30";
            feedback.classList.remove("hidden");
        }
    }
}


initializeApp();