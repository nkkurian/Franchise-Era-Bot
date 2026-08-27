let offers = [];
let selectedOffer = null;

const $ = (id) => document.getElementById(id);

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

const getOfferId = (offer) => offer.id ?? offer.offer_id;

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
    return `<span class="px-2 py-0.5 rounded font-bold border ${styles[normalized] || styles.PENDING}">${escapeHtml(normalized)}</span>`;
}

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
    const today = new Date().toISOString().slice(0, 10);
    const processed = offers.filter((offer) => {
        const status = String(offer.status).toUpperCase();
        const date = String(offer.updated_at || offer.created_at || "").slice(0, 10);
        return date === today && ["ACCEPTED", "DECLINED", "EXPIRED"].includes(status);
    });
    const activeValue = offers
        .filter((offer) => String(offer.status).toUpperCase() === "PENDING")
        .reduce((sum, offer) => sum + (Number(offer.total_value) || Number(offer.aav) || 0), 0);

    setText("metric-pending", pending.length);
    setText("metric-awaiting", awaiting.length);
    setText("metric-processed", processed.length);
    setText("metric-avg", `${formatCurrency(activeValue / 1_000_000)}M`);
}

function renderOffers() {
    const tbody = $("offers-table-body");
    if (!tbody) return;

    const query = ($("search-input")?.value || "").trim().toLowerCase();
    const visibleOffers = offers.filter((offer) =>
        [
            offer.offer_id,
            offer.id,
            offer.to_player,
            offer.player_name,
            offer.from_team,
            offer.team_name,
            offer.status,
        ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query)),
    );

    if (visibleOffers.length === 0) {
        tbody.innerHTML =
            '<tr><td colspan="6" class="p-6 text-center text-slate-500">No offers found.</td></tr>';
        return;
    }

    tbody.innerHTML = visibleOffers
        .map((offer) => {
            const id = getOfferId(offer);
            const player = offer.to_player || offer.player_name || "Unknown player";
            const team = offer.from_team || offer.team_name || "Unknown team";
            const agent =
                offer.agent ||
                offer.assigned_agent ||
                offer.agent_assigned ||
                offer.agent_name ||
                "Unassigned";
            const years = offer.years ?? offer.contract_years ?? "—";
            const aav = formatCurrency(offer.aav);
            return `
                <tr data-offer-id="${escapeHtml(id)}" class="offer-row cursor-pointer hover:bg-slate-800/60 transition-colors">
                    <td class="p-3 font-mono text-slate-400">${escapeHtml(offer.offer_id || id || "—")}</td>
                    <td class="p-3 font-bold text-white">${escapeHtml(player)}</td>
                    <td class="p-3">${escapeHtml(team)}</td>
                    <td class="p-3 font-mono">${escapeHtml(years)} yr · ${escapeHtml(aav)} AAV</td>
                    <td class="p-3 text-cyan-400">${escapeHtml(agent)}</td>
                    <td class="p-3">${statusBadge(offer.status)}</td>
                </tr>
            `;
        })
        .join("");

    tbody.querySelectorAll(".offer-row").forEach((row) => {
        row.addEventListener("click", () => {
            const id = row.dataset.offerId;
            selectOffer(offers.find((offer) => String(getOfferId(offer)) === String(id)));
        });
    });
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
    setText("audit-total", formatCurrency(selectedOffer.total_value));
    setText("audit-agent", agent);
    setText("audit-notes", selectedOffer.notes || selectedOffer.agent_notes || "No custom requirements or notes submitted.");

    const badge = $("audit-status-badge");
    if (badge) {
        badge.outerHTML = statusBadge(selectedOffer.status).replace(
            "<span ",
            '<span id="audit-status-badge" ',
        );
    }
}

async function loadOffers() {
    const response = await fetch("/api/offers");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `Offer service returned ${response.status}`);
    }

    offers = Array.isArray(payload.offers) ? payload.offers : [];
    updateMetrics();
    renderOffers();
    if (selectedOffer) {
        selectOffer(offers.find((offer) => String(getOfferId(offer)) === String(getOfferId(selectedOffer))));
    }
}

async function updateStatus(status) {
    if (!selectedOffer) return;
    const id = getOfferId(selectedOffer);
    if (id === undefined || id === null) return;

    const response = await fetch(`/api/offers/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `Status update returned ${response.status}`);
    }

    await loadOffers();
}

function showLoadError(error) {
    const tbody = $("offers-table-body");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-rose-400">Unable to load offers: ${escapeHtml(error.message)}</td></tr>`;
    }
    console.error("Unable to load offers:", error);
}

async function initializeApp() {
    $("search-input")?.addEventListener("input", renderOffers);

    $("btn-approve")?.addEventListener("click", () =>
        updateStatus("ACCEPTED").catch(showLoadError),
    );
    $("btn-reject")?.addEventListener("click", () =>
        updateStatus("DECLINED").catch(showLoadError),
    );
    $("btn-expire")?.addEventListener("click", () =>
        updateStatus("EXPIRED").catch(showLoadError),
    );

    try {
        await loadOffers();
    } catch (error) {
        showLoadError(error);
    }
}

initializeApp();