
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

function renderGroupedOffers(offersToRender) {
  const container = document.getElementById("offers-table-body");
  if (!container) return;

  if (!offersToRender || offersToRender.length === 0) {
    container.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-500">No active offers found.</td></tr>`;
    return;
  }

  // Group bids by Player Name (handles fallback database keys)
  const grouped = offersToRender.reduce((acc, offer) => {
    const player = offer.player_name || offer.to_player || offer.player || "Unknown Player";
    if (!acc[player]) acc[player] = [];
    acc[player].push(offer);
    return acc;
  }, {});

  let html = "";

  for (const [player, bids] of Object.entries(grouped)) {
    // Group Header Line
    html += `
      <tr class="bg-slate-800/80 font-semibold text-slate-200 border-t border-b border-slate-700">
        <td colspan="6" class="px-4 py-2 text-xs">
          Player Name: <span class="text-cyan-400 font-bold">${escapeHtml(player)}</span> 
          <span class="ml-2 text-slate-400 font-normal">(Bids: ${bids.length})</span>
        </td>
      </tr>
    `;

    // Sub-rows
    bids.forEach((bid) => {
      const playerName = bid.player_name || bid.to_player || bid.player || "—";
      const teamName = bid.team_name || bid.from_team || bid.team || "—";
      const timestamp = bid.timestamp || bid.created_at || "—";

      html += `
        <tr class="border-b border-slate-800/40 hover:bg-slate-800/30 text-sm text-slate-300">
          <td class="pl-6 pr-4 py-2 text-xs text-slate-400">${escapeHtml(timestamp)}</td>
          <td class="px-4 py-2 font-medium">${escapeHtml(teamName)}</td>
          <td class="px-4 py-2 text-slate-400">${escapeHtml(playerName)}</td>
          <td class="px-4 py-2 font-mono text-emerald-400">${formatCurrency(bid.aav)}</td>
          <td class="px-4 py-2 font-mono">${bid.years || bid.length || 1} ${Number(bid.years || bid.length) === 1 ? 'yr' : 'yrs'}</td>
          
          <td class="px-4 py-2">
            ${statusBadge(bid.status)}
          </td>
        </tr>
      `;
    });
  }

  container.innerHTML = html;
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
    renderGroupedOffers(offers);
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
    $("search-input")?.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = offers.filter(o => 
            (o.player_name || '').toLowerCase().includes(query) || 
            (o.team_name || o.from_team || '').toLowerCase().includes(query)
        );
        renderGroupedOffers(filtered);
    });

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

initializeApp();let offers = [];
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

function renderGroupedOffers(offersToRender) {
  const container = document.getElementById("offers-table-body");
  if (!container) return;

  if (!offersToRender || offersToRender.length === 0) {
    container.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-500">No active offers found.</td></tr>`;
    return;
  }

  // Group bids by Player Name (handles fallback database keys)
  const grouped = offersToRender.reduce((acc, offer) => {
    const player = offer.player_name || offer.to_player || offer.player || "Unknown Player";
    if (!acc[player]) acc[player] = [];
    acc[player].push(offer);
    return acc;
  }, {});

  let html = "";

  for (const [player, bids] of Object.entries(grouped)) {
    // Group Header Line
    html += `
      <tr class="bg-slate-800/80 font-semibold text-slate-200 border-t border-b border-slate-700">
        <td colspan="6" class="px-4 py-2 text-xs">
          Player Name: <span class="text-cyan-400 font-bold">${escapeHtml(player)}</span> 
          <span class="ml-2 text-slate-400 font-normal">(Bids: ${bids.length})</span>
        </td>
      </tr>
    `;

    // Sub-rows
    bids.forEach((bid) => {
      const playerName = bid.player_name || bid.to_player || bid.player || "—";
      const teamName = bid.team_name || bid.from_team || bid.team || "—";
      const timestamp = bid.timestamp || bid.created_at || "—";

      html += `
        <tr class="border-b border-slate-800/40 hover:bg-slate-800/30 text-sm text-slate-300">
          <td class="pl-6 pr-4 py-2 text-xs text-slate-400">${escapeHtml(timestamp)}</td>
          <td class="px-4 py-2 font-medium">${escapeHtml(teamName)}</td>
          <td class="px-4 py-2 text-slate-400">${escapeHtml(playerName)}</td>
          <td class="px-4 py-2 font-mono text-emerald-400">${formatCurrency(bid.aav)}</td>
          <td class="px-4 py-2 font-mono">${bid.years || bid.length || 1} ${Number(bid.years || bid.length) === 1 ? 'yr' : 'yrs'}</td>
          
          <td class="px-4 py-2">
            ${statusBadge(bid.status)}
          </td>
        </tr>
      `;
    });
  }

  container.innerHTML = html;
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
    renderGroupedOffers(offers);
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
    $("search-input")?.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = offers.filter(o => 
            (o.player_name || '').toLowerCase().includes(query) || 
            (o.team_name || o.from_team || '').toLowerCase().includes(query)
        );
        renderGroupedOffers(filtered);
    });

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

initializeApp();let offers = [];
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

function renderGroupedOffers(offersToRender) {
  const container = document.getElementById("offers-table-body");
  if (!container) return;

  if (!offersToRender || offersToRender.length === 0) {
    container.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-500">No active offers found.</td></tr>`;
    return;
  }

  // Group bids by Player Name (handles fallback database keys)
  const grouped = offersToRender.reduce((acc, offer) => {
    const player = offer.player_name || offer.to_player || offer.player || "Unknown Player";
    if (!acc[player]) acc[player] = [];
    acc[player].push(offer);
    return acc;
  }, {});

  let html = "";

  for (const [player, bids] of Object.entries(grouped)) {
    // Group Header Line
    html += `
      <tr class="bg-slate-800/80 font-semibold text-slate-200 border-t border-b border-slate-700">
        <td colspan="6" class="px-4 py-2 text-xs">
          Player Name: <span class="text-cyan-400 font-bold">${escapeHtml(player)}</span> 
          <span class="ml-2 text-slate-400 font-normal">(Bids: ${bids.length})</span>
        </td>
      </tr>
    `;

    // Sub-rows
    bids.forEach((bid) => {
      const playerName = bid.player_name || bid.to_player || bid.player || "—";
      const teamName = bid.team_name || bid.from_team || bid.team || "—";
      const timestamp = bid.timestamp || bid.created_at || "—";

      html += `
        <tr class="border-b border-slate-800/40 hover:bg-slate-800/30 text-sm text-slate-300">
          <td class="pl-6 pr-4 py-2 text-xs text-slate-400">${escapeHtml(timestamp)}</td>
          <td class="px-4 py-2 font-medium">${escapeHtml(teamName)}</td>
          <td class="px-4 py-2 text-slate-400">${escapeHtml(playerName)}</td>
          <td class="px-4 py-2 font-mono text-emerald-400">${formatCurrency(bid.aav)}</td>
          <td class="px-4 py-2 font-mono">${bid.years || bid.length || 1} ${Number(bid.years || bid.length) === 1 ? 'yr' : 'yrs'}</td>
          
          <td class="px-4 py-2">
            ${statusBadge(bid.status)}
          </td>
        </tr>
      `;
    });
  }

  container.innerHTML = html;
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
    renderGroupedOffers(offers);
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
    $("search-input")?.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = offers.filter(o => 
            (o.player_name || '').toLowerCase().includes(query) || 
            (o.team_name || o.from_team || '').toLowerCase().includes(query)
        );
        renderGroupedOffers(filtered);
    });

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

initializeApp();let offers = [];
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

function renderGroupedOffers(offersToRender) {
  const container = document.getElementById("offers-table-body");
  if (!container) return;

  if (!offersToRender || offersToRender.length === 0) {
    container.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-500">No active offers found.</td></tr>`;
    return;
  }

  // Group bids by Player Name (handles fallback database keys)
  const grouped = offersToRender.reduce((acc, offer) => {
    const player = offer.player_name || offer.to_player || offer.player || "Unknown Player";
    if (!acc[player]) acc[player] = [];
    acc[player].push(offer);
    return acc;
  }, {});

  let html = "";

  for (const [player, bids] of Object.entries(grouped)) {
    // Group Header Line
    html += `
      <tr class="bg-slate-800/80 font-semibold text-slate-200 border-t border-b border-slate-700">
        <td colspan="6" class="px-4 py-2 text-xs">
          Player Name: <span class="text-cyan-400 font-bold">${escapeHtml(player)}</span> 
          <span class="ml-2 text-slate-400 font-normal">(Bids: ${bids.length})</span>
        </td>
      </tr>
    `;

    // Sub-rows
    bids.forEach((bid) => {
      const playerName = bid.player_name || bid.to_player || bid.player || "—";
      const teamName = bid.team_name || bid.from_team || bid.team || "—";
      const timestamp = bid.timestamp || bid.created_at || "—";

      html += `
        <tr class="border-b border-slate-800/40 hover:bg-slate-800/30 text-sm text-slate-300">
          <td class="pl-6 pr-4 py-2 text-xs text-slate-400">${escapeHtml(timestamp)}</td>
          <td class="px-4 py-2 font-medium">${escapeHtml(teamName)}</td>
          <td class="px-4 py-2 text-slate-400">${escapeHtml(playerName)}</td>
          <td class="px-4 py-2 font-mono text-emerald-400">${formatCurrency(bid.aav)}</td>
          <td class="px-4 py-2 font-mono">${bid.years || bid.length || 1} ${Number(bid.years || bid.length) === 1 ? 'yr' : 'yrs'}</td>
          
          <td class="px-4 py-2">
            ${statusBadge(bid.status)}
          </td>
        </tr>
      `;
    });
  }

  container.innerHTML = html;
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
    renderGroupedOffers(offers);
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
    $("search-input")?.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = offers.filter(o => 
            (o.player_name || '').toLowerCase().includes(query) || 
            (o.team_name || o.from_team || '').toLowerCase().includes(query)
        );
        renderGroupedOffers(filtered);
    });

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

initializeApp();let offers = [];
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

function renderGroupedOffers(offersToRender) {
  const container = document.getElementById("offers-table-body");
  if (!container) return;

  if (!offersToRender || offersToRender.length === 0) {
    container.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-500">No active offers found.</td></tr>`;
    return;
  }

  // Group bids by Player Name (handles fallback database keys)
  const grouped = offersToRender.reduce((acc, offer) => {
    const player = offer.player_name || offer.to_player || offer.player || "Unknown Player";
    if (!acc[player]) acc[player] = [];
    acc[player].push(offer);
    return acc;
  }, {});

  let html = "";

  for (const [player, bids] of Object.entries(grouped)) {
    // Group Header Line
    html += `
      <tr class="bg-slate-800/80 font-semibold text-slate-200 border-t border-b border-slate-700">
        <td colspan="6" class="px-4 py-2 text-xs">
          Player Name: <span class="text-cyan-400 font-bold">${escapeHtml(player)}</span> 
          <span class="ml-2 text-slate-400 font-normal">(Bids: ${bids.length})</span>
        </td>
      </tr>
    `;

    // Sub-rows
    bids.forEach((bid) => {
      const playerName = bid.player_name || bid.to_player || bid.player || "—";
      const teamName = bid.team_name || bid.from_team || bid.team || "—";
      const timestamp = bid.timestamp || bid.created_at || "—";

      html += `
        <tr class="border-b border-slate-800/40 hover:bg-slate-800/30 text-sm text-slate-300">
          <td class="pl-6 pr-4 py-2 text-xs text-slate-400">${escapeHtml(timestamp)}</td>
          <td class="px-4 py-2 font-medium">${escapeHtml(teamName)}</td>
          <td class="px-4 py-2 text-slate-400">${escapeHtml(playerName)}</td>
          <td class="px-4 py-2 font-mono text-emerald-400">${formatCurrency(bid.aav)}</td>
          <td class="px-4 py-2 font-mono">${bid.years || bid.length || 1} ${Number(bid.years || bid.length) === 1 ? 'yr' : 'yrs'}</td>
          
          <td class="px-4 py-2">
            ${statusBadge(bid.status)}
          </td>
        </tr>
      `;
    });
  }

  container.innerHTML = html;
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
    renderGroupedOffers(offers);
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
    $("search-input")?.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = offers.filter(o => 
            (o.player_name || '').toLowerCase().includes(query) || 
            (o.team_name || o.from_team || '').toLowerCase().includes(query)
        );
        renderGroupedOffers(filtered);
    });

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

initializeApp();let offers = [];
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

function renderGroupedOffers(offersToRender) {
  const container = document.getElementById("offers-table-body");
  if (!container) return;

  if (!offersToRender || offersToRender.length === 0) {
    container.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-500">No active offers found.</td></tr>`;
    return;
  }

  // Group bids by Player Name (handles fallback database keys)
  const grouped = offersToRender.reduce((acc, offer) => {
    const player = offer.player_name || offer.to_player || offer.player || "Unknown Player";
    if (!acc[player]) acc[player] = [];
    acc[player].push(offer);
    return acc;
  }, {});

  let html = "";

  for (const [player, bids] of Object.entries(grouped)) {
    // Group Header Line
    html += `
      <tr class="bg-slate-800/80 font-semibold text-slate-200 border-t border-b border-slate-700">
        <td colspan="6" class="px-4 py-2 text-xs">
          Player Name: <span class="text-cyan-400 font-bold">${escapeHtml(player)}</span> 
          <span class="ml-2 text-slate-400 font-normal">(Bids: ${bids.length})</span>
        </td>
      </tr>
    `;

    // Sub-rows
    bids.forEach((bid) => {
      const playerName = bid.player_name || bid.to_player || bid.player || "—";
      const teamName = bid.team_name || bid.from_team || bid.team || "—";
      const timestamp = bid.timestamp || bid.created_at || "—";

      html += `
        <tr class="border-b border-slate-800/40 hover:bg-slate-800/30 text-sm text-slate-300">
          <td class="pl-6 pr-4 py-2 text-xs text-slate-400">${escapeHtml(timestamp)}</td>
          <td class="px-4 py-2 font-medium">${escapeHtml(teamName)}</td>
          <td class="px-4 py-2 text-slate-400">${escapeHtml(playerName)}</td>
          <td class="px-4 py-2 font-mono text-emerald-400">${formatCurrency(bid.aav)}</td>
          <td class="px-4 py-2 font-mono">${bid.years || bid.length || 1} ${Number(bid.years || bid.length) === 1 ? 'yr' : 'yrs'}</td>
          
          <td class="px-4 py-2">
            ${statusBadge(bid.status)}
          </td>
        </tr>
      `;
    });
  }

  container.innerHTML = html;
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
    renderGroupedOffers(offers);
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
    $("search-input")?.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = offers.filter(o => 
            (o.player_name || '').toLowerCase().includes(query) || 
            (o.team_name || o.from_team || '').toLowerCase().includes(query)
        );
        renderGroupedOffers(filtered);
    });

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

initializeApp();let offers = [];
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

function renderGroupedOffers(offersToRender) {
  const container = document.getElementById("offers-table-body");
  if (!container) return;

  if (!offersToRender || offersToRender.length === 0) {
    container.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-500">No active offers found.</td></tr>`;
    return;
  }

  // Group bids by Player Name (handles fallback database keys)
  const grouped = offersToRender.reduce((acc, offer) => {
    const player = offer.player_name || offer.to_player || offer.player || "Unknown Player";
    if (!acc[player]) acc[player] = [];
    acc[player].push(offer);
    return acc;
  }, {});

  let html = "";

  for (const [player, bids] of Object.entries(grouped)) {
    // Group Header Line
    html += `
      <tr class="bg-slate-800/80 font-semibold text-slate-200 border-t border-b border-slate-700">
        <td colspan="6" class="px-4 py-2 text-xs">
          Player Name: <span class="text-cyan-400 font-bold">${escapeHtml(player)}</span> 
          <span class="ml-2 text-slate-400 font-normal">(Bids: ${bids.length})</span>
        </td>
      </tr>
    `;

    // Sub-rows
    bids.forEach((bid) => {
      const playerName = bid.player_name || bid.to_player || bid.player || "—";
      const teamName = bid.team_name || bid.from_team || bid.team || "—";
      const timestamp = bid.timestamp || bid.created_at || "—";

      html += `
        <tr class="border-b border-slate-800/40 hover:bg-slate-800/30 text-sm text-slate-300">
          <td class="pl-6 pr-4 py-2 text-xs text-slate-400">${escapeHtml(timestamp)}</td>
          <td class="px-4 py-2 font-medium">${escapeHtml(teamName)}</td>
          <td class="px-4 py-2 text-slate-400">${escapeHtml(playerName)}</td>
          <td class="px-4 py-2 font-mono text-emerald-400">${formatCurrency(bid.aav)}</td>
          <td class="px-4 py-2 font-mono">${bid.years || bid.length || 1} ${Number(bid.years || bid.length) === 1 ? 'yr' : 'yrs'}</td>
          
          <td class="px-4 py-2">
            ${statusBadge(bid.status)}
          </td>
        </tr>
      `;
    });
  }

  container.innerHTML = html;
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
    renderGroupedOffers(offers);
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
    $("search-input")?.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = offers.filter(o => 
            (o.player_name || '').toLowerCase().includes(query) || 
            (o.team_name || o.from_team || '').toLowerCase().includes(query)
        );
        renderGroupedOffers(filtered);
    });

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

initializeApp();let offers = [];
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

function renderGroupedOffers(offersToRender) {
  const container = document.getElementById("offers-table-body");
  if (!container) return;

  if (!offersToRender || offersToRender.length === 0) {
    container.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-500">No active offers found.</td></tr>`;
    return;
  }

  // Group bids by Player Name (handles fallback database keys)
  const grouped = offersToRender.reduce((acc, offer) => {
    const player = offer.player_name || offer.to_player || offer.player || "Unknown Player";
    if (!acc[player]) acc[player] = [];
    acc[player].push(offer);
    return acc;
  }, {});

  let html = "";

  for (const [player, bids] of Object.entries(grouped)) {
    // Group Header Line
    html += `
      <tr class="bg-slate-800/80 font-semibold text-slate-200 border-t border-b border-slate-700">
        <td colspan="6" class="px-4 py-2 text-xs">
          Player Name: <span class="text-cyan-400 font-bold">${escapeHtml(player)}</span> 
          <span class="ml-2 text-slate-400 font-normal">(Bids: ${bids.length})</span>
        </td>
      </tr>
    `;

    // Sub-rows
    bids.forEach((bid) => {
      const playerName = bid.player_name || bid.to_player || bid.player || "—";
      const teamName = bid.team_name || bid.from_team || bid.team || "—";
      const timestamp = bid.timestamp || bid.created_at || "—";

      html += `
        <tr class="border-b border-slate-800/40 hover:bg-slate-800/30 text-sm text-slate-300">
          <td class="pl-6 pr-4 py-2 text-xs text-slate-400">${escapeHtml(timestamp)}</td>
          <td class="px-4 py-2 font-medium">${escapeHtml(teamName)}</td>
          <td class="px-4 py-2 text-slate-400">${escapeHtml(playerName)}</td>
          <td class="px-4 py-2 font-mono text-emerald-400">${formatCurrency(bid.aav)}</td>
          <td class="px-4 py-2 font-mono">${bid.years || bid.length || 1} ${Number(bid.years || bid.length) === 1 ? 'yr' : 'yrs'}</td>
          
          <td class="px-4 py-2">
            ${statusBadge(bid.status)}
          </td>
        </tr>
      `;
    });
  }

  container.innerHTML = html;
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
    renderGroupedOffers(offers);
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
    $("search-input")?.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = offers.filter(o => 
            (o.player_name || '').toLowerCase().includes(query) || 
            (o.team_name || o.from_team || '').toLowerCase().includes(query)
        );
        renderGroupedOffers(filtered);
    });

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
=======
// The Supabase CDN exposes a global named `supabase`. Keep the initialized
// client under a different name so this classic script does not redeclare that
// global with `let`, which causes a browser syntax error.
let supabaseClient;

// 1. Fetch backend environment config
async function initApp() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();

        if (!config.supabaseUrl || !config.supabaseKey) {
            console.error('❌ Supabase environment variables missing from server environment.');
            return;
        }

        // 2. Initialize Supabase Client dynamically
        supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);

        // 3. Kick off fetching and realtime listeners
        fetchOffers();
        listenToRealtime();
    } catch (err) {
        console.error('Failed to load application config:', err.message);
    }
}

// Format numbers as currency ($15,000,000)
const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
};

// Fetch initial contract offers
async function fetchOffers() {
    if (!supabaseClient) return;

    const { data: offers, error } = await supabaseClient
        .from('contract_offers')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error loading offers:', error.message);
        return;
    }

    renderOffers(offers || []);
    updateSummaryStats(offers || []);
}

// Render rows to table
function renderOffers(offers) {
    const tbody = document.getElementById('offers-table-body');
    tbody.innerHTML = '';

    if (offers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-slate-500">No active contract offers found.</td></tr>`;
        return;
    }

    offers.forEach(offer => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-800/50 transition-colors';

        let statusBadge = `<span class="px-2 py-0.5 rounded font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">PENDING</span>`;
        if (offer.status === 'ACCEPTED') {
            statusBadge = `<span class="px-2 py-0.5 rounded font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">ACCEPTED</span>`;
        } else if (offer.status === 'DECLINED') {
            statusBadge = `<span class="px-2 py-0.5 rounded font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">DECLINED</span>`;
        }

        tr.innerHTML = `
            <td class="p-3 font-mono text-slate-400">${offer.offer_id || 'OFF-001'}</td>
            <td class="p-3 font-semibold">${offer.from_team}</td>
            <td class="p-3 font-bold text-white">${offer.to_player}</td>
            <td class="p-3 text-slate-400">${offer.pos}</td>
            <td class="p-3">${offer.years} yr</td>
            <td class="p-3 font-mono">${formatCurrency(offer.aav)}</td>
            <td class="p-3 font-mono font-bold text-emerald-400">${formatCurrency(offer.total_value)}</td>
            <td class="p-3">${statusBadge}</td>
            <td class="p-3 text-right space-x-1">
                ${offer.status === 'PENDING' ? `
                    <button onclick="updateStatus('${offer.id}', 'ACCEPTED')" class="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded text-[10px] font-bold">Approve</button>
                    <button onclick="updateStatus('${offer.id}', 'DECLINED')" class="bg-rose-600 hover:bg-rose-500 text-white px-2 py-1 rounded text-[10px] font-bold">Reject</button>
                ` : '<span class="text-slate-500 text-[10px]">Resolved</span>'}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Update status directly from UI
async function updateStatus(id, newStatus) {
    if (!supabaseClient) return;

    const { error } = await supabaseClient
        .from('contract_offers')
        .update({ status: newStatus })
        .eq('id', id);

    if (error) {
        alert('Failed to update status: ' + error.message);
    }
}

// Update summary stats
function updateSummaryStats(offers) {
    const pending = offers.filter(o => o.status === 'PENDING').length;
    const accepted = offers.filter(o => o.status === 'ACCEPTED').length;

    document.getElementById('stat-pending').innerText = pending;
    document.getElementById('stat-accepted').innerText = accepted;
}

// Subscribe to Supabase Realtime changes
function listenToRealtime() {
    if (!supabaseClient) return;

    supabaseClient
        .channel('schema-db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'contract_offers' }, () => {
            fetchOffers();
        })
        .subscribe();
}

// Initialize application
initApp();
