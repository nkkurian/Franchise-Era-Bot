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