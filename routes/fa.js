// routes/fa.js
const express = require("express");
const router = express.Router();
const { processFreeAgencyBid } = require("../utils/faEngine");

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
            <style>
                :root {
                    --bg-main: #0B0E14;
                    --glass-bg: rgba(22, 27, 34, 0.75);
                    --glass-border: rgba(255, 255, 255, 0.08);
                    --accent-blue: #2563EB;
                    --accent-gradient: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%);
                    --text-main: #F3F4F6;
                    --text-muted: #9CA3AF;
                    --input-bg: #111827;
                }

                * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }

                body {
                    background-color: var(--bg-main);
                    background-image: 
                        radial-gradient(at 0% 0%, rgba(37, 99, 235, 0.12) 0px, transparent 50%),
                        radial-gradient(at 100% 100%, rgba(16, 185, 129, 0.08) 0px, transparent 50%);
                    color: var(--text-main);
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    padding: 16px;
                }

                .hub-container {
                    width: 100%;
                    max-width: 480px;
                    background: var(--glass-bg);
                    backdrop-filter: blur(16px);
                    -webkit-backdrop-filter: blur(16px);
                    border: 1px solid var(--glass-border);
                    border-radius: 20px;
                    padding: 24px;
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
                }

                /* Header & Status Indicator */
                .header-strip {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                }

                .badge-status {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    background: rgba(16, 185, 129, 0.1);
                    border: 1px solid rgba(16, 185, 129, 0.2);
                    color: #10B981;
                    padding: 4px 10px;
                    border-radius: 99px;
                    font-size: 12px;
                    font-weight: 600;
                }

                .status-dot {
                    width: 6px;
                    height: 6px;
                    background-color: #10B981;
                    border-radius: 50%;
                    box-shadow: 0 0 8px #10B981;
                }

                .badge-league {
                    color: var(--text-muted);
                    font-size: 12px;
                    font-weight: 600;
                }

                h1 {
                    font-size: 22px;
                    font-weight: 800;
                    letter-spacing: -0.5px;
                    margin-bottom: 20px;
                    text-align: center;
                }

                /* Form Sections */
                .form-section-title {
                    font-size: 11px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.8px;
                    color: var(--text-muted);
                    margin: 16px 0 8px 4px;
                }

                .field-group {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .input-wrapper {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }

                label {
                    font-size: 13px;
                    font-weight: 600;
                    color: #D1D5DB;
                }

                input, select {
                    width: 100%;
                    height: 48px;
                    background: var(--input-bg);
                    border: 1px solid var(--glass-border);
                    border-radius: 10px;
                    padding: 0 14px;
                    color: #FFF;
                    font-size: 15px;
                    outline: none;
                    transition: all 0.2s ease;
                }

                input:focus, select:focus {
                    border-color: var(--accent-blue);
                    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
                }

                input::placeholder { color: #4B5563; }

                /* Live Projection Card */
                .projection-card {
                    background: rgba(31, 41, 55, 0.5);
                    border: 1px solid rgba(255, 255, 255, 0.05);
                    border-radius: 12px;
                    padding: 16px;
                    margin: 20px 0;
                }

                .projection-header {
                    font-size: 12px;
                    font-weight: 700;
                    color: var(--text-muted);
                    margin-bottom: 10px;
                    display: flex;
                    justify-content: space-between;
                }

                .projection-player {
                    font-size: 16px;
                    font-weight: 700;
                    color: #FFF;
                    margin-bottom: 10px;
                }

                .projection-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 10px;
                    background: rgba(0, 0, 0, 0.2);
                    padding: 10px;
                    border-radius: 8px;
                }

                .stat-box { display: flex; flex-direction: column; gap: 2px; }
                .stat-label { font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; }
                .stat-val { font-size: 15px; font-weight: 700; color: #10B981; }

                /* Submit Button */
                button[type="submit"] {
                    width: 100%;
                    height: 52px;
                    background: var(--accent-gradient);
                    border: none;
                    border-radius: 12px;
                    color: #FFF;
                    font-size: 15px;
                    font-weight: 700;
                    cursor: pointer;
                    box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
                    transition: transform 0.1s ease, box-shadow 0.2s ease;
                }

                button[type="submit"]:active { transform: scale(0.98); }
            </style>
        </head>
        <body>

            <div class="hub-container">
                <div class="header-strip">
                    <div class="badge-status">
                        <span class="status-dot"></span> BIDDING OPEN
                    </div>
                    <div class="badge-league">Franchise Pro</div>
                </div>

                <h1>🏈 Free Agency Portal</h1>

                <form action="/api/fa/bid" method="POST">

                    <div class="form-section-title">Manager Identity</div>
                    <div class="field-group">
                        <div class="input-wrapper">
                            <label for="teamName">Team Name</label>
                            <input type="text" id="teamName" name="teamName" placeholder="e.g. Urumqi Uncs" required />
                        </div>
                        <div class="input-wrapper">
                            <label for="userId">Discord User ID / Username</label>
                            <input type="text" id="userId" name="userId" placeholder="e.g. 123456789" required />
                        </div>
                    </div>

                    <div class="form-section-title">Contract Terms</div>
                    <div class="field-group">
                        <div class="input-wrapper">
                            <label for="playerName">Target Player Name</label>
                            <input type="text" id="playerName" name="playerName" placeholder="e.g. Tee Higgins" required />
                        </div>
                        <div class="input-wrapper">
                            <label for="salary">Annual Salary ($)</label>
                            <input type="text" id="salary" name="salary" inputmode="decimal" placeholder="e.g. 12.5M or 12500000" required />
                        </div>
                        <div class="input-wrapper">
                            <label for="years">Contract Duration</label>
                            <select id="years" name="years" required>
                                <option value="1">1 Year</option>
                                <option value="2">2 Years</option>
                                <option value="3">3 Years</option>
                                <option value="4">4 Years</option>
                            </select>
                        </div>
                    </div>

                    <!-- Live Dynamic Preview Card -->
                    <div class="projection-card">
                        <div class="projection-header">
                            <span>CONTRACT PROJECTION</span>
                            <span>LIVE PREVIEW</span>
                        </div>
                        <div class="projection-player" id="previewPlayer">Select Player</div>
                        <div class="projection-grid">
                            <div class="stat-box">
                                <span class="stat-label">ANNUAL AAV</span>
                                <span class="stat-val" id="previewAAV">$0.00</span>
                            </div>
                            <div class="stat-box">
                                <span class="stat-label">EST. TOTAL VALUE</span>
                                <span class="stat-val" id="previewTotal">$0.00</span>
                            </div>
                        </div>
                    </div>

                    <button type="submit">⚡ Submit Free Agency Offer</button>
                </form>
            </div>

            <!-- JavaScript for Live Calculation -->
            <script>
                const pNameInput = document.getElementById('playerName');
                const salaryInput = document.getElementById('salary');
                const yearsInput = document.getElementById('years');

                const pNamePreview = document.getElementById('previewPlayer');
                const aavPreview = document.getElementById('previewAAV');
                const totalPreview = document.getElementById('previewTotal');

                function updatePreview() {
                    const rawName = pNameInput.value.trim();
                    const rawSalary = salaryInput.value.trim();
                    const years = parseInt(yearsInput.value, 10) || 1;

                    pNamePreview.textContent = rawName.length > 0 ? rawName : "Select Player";

                    // Parse Salary
                    let numSalary = parseFloat(rawSalary.replace(/[$,]/g, "")) || 0;
                    if (rawSalary.toLowerCase().endsWith("m")) {
                        numSalary = parseFloat(rawSalary) * 1000000;
                    }

                    const totalValue = numSalary * years;

                    aavPreview.textContent = numSalary > 0 
                        ? "$" + numSalary.toLocaleString('en-US', { maximumFractionDigits: 2 })
                        : "$0.00";

                    totalPreview.textContent = totalValue > 0 
                        ? "$" + totalValue.toLocaleString('en-US', { maximumFractionDigits: 2 })
                        : "$0.00";
                }

                pNameInput.addEventListener('input', updatePreview);
                salaryInput.addEventListener('input', updatePreview);
                yearsInput.addEventListener('change', updatePreview);
            </script>
        </body>
        </html>
    `);
});

// POST: Process Web Form Submission
router.post("/api/fa/bid", async (req, res) => {
    try {
        const { teamName, userId, playerName, salary, years } = req.body;
        const getSheetData = req.app.get("getSheetData");

        const result = await processFreeAgencyBid({
            guildId: process.env.GUILD_ID || "DEFAULT_GUILD", 
            userId,
            teamName,
            rawPlayerName: playerName,
            rawSalary: salary,
            rawYears: years,
        }, getSheetData);

        if (result.success) {
            res.send(`
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
                        <div class="icon">${result.isUpdate ? "🔄" : "✅"}</div>
                        <h2>${result.isUpdate ? "Bid Updated!" : "Offer Submitted!"}</h2>
                        <p>Your contract offer for <strong>${result.data.playerName}</strong> has been logged to the spreadsheet.</p>

                        <div class="details">
                            <div class="row"><span class="label">Annual Salary:</span><span class="val">$${(result.data.salary).toLocaleString()}</span></div>
                            <div class="row"><span class="label">Contract Length:</span><span class="val">${result.data.years} Year(s)</span></div>
                            <div class="row"><span class="label">Total Contract:</span><span class="val" style="color:#10B981;">$${(result.data.totalValue).toLocaleString()}</span></div>
                        </div>

                        <a href="/fa">Submit Another Offer</a>
                    </div>
                </body>
                </html>
            `);
        } else {
            res.status(400).send(`
                <body style="background:#0B0E14; color:#FFF; font-family:sans-serif; text-align:center; padding-top:50px;">
                    <h2 style="color:#EF4444;">❌ Error Processing Bid</h2>
                    <p style="color:#9CA3AF;">${result.message}</p>
                    <br><a href="/fa" style="color:#3B82F6;">Back to Form</a>
                </body>
            `);
        }
    } catch (err) {
        console.error("Web FA Bid Error:", err);
        res.status(500).send("<h3>❌ Server Error submitting bid.</h3>");
    }
});

module.exports = router;