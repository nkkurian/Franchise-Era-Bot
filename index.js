const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const axios = require("axios");
const express = require("express");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
const { JWT } = require("google-auth-library");

// --- CONFIGURATION ---
const SHEET_ID = "1-G39QNK9o0qbgBp3nKjjXHGuuSH4bx_xqNsR51jABM8";
const LEAGUE_ID = process.env.LEAGUE_ID;
let lastTradeId = null;

// Keep-Alive Server (Prevents Replit from sleeping)
const app = express();
app.get("/", (req, res) => res.send("Bot is active!"));
app.listen(3000);

// 1. CONNECT TO GOOGLE SHEET
async function getSheet() {
  // Initialize the Auth client
  const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_EMAIL,
    key: process.env.GOOGLE_KEY.replace(/\\n/g, "\n"),
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
  });

  // Create the doc instance with the auth client already inside
  const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);

  await doc.loadInfo(); // Loads document properties and worksheets
  return doc.sheetsByTitle["PlayerList"];
}

// 2. INSTANT TRADE CHECKER (Checks Sleeper every 30 seconds)
async function checkTrades() {
  try {
    const res = await axios.get(
      `https://api.sleeper.app/v1/league/${LEAGUE_ID}/transactions/2025`,
    );
    const trades = res.data.filter((tx) => tx.type === "trade");

    if (trades.length > 0 && trades[0].transaction_id !== lastTradeId) {
      lastTradeId = trades[0].transaction_id;
      // Replace 'trades' with the name of your Discord channel
      const channel = client.channels.cache.find((c) => c.name === "trades");
      if (!channel) return;

      const embed = new EmbedBuilder()
        .setTitle("🚨 NEW TRADE PROPOSED 🚨")
        .setDescription(
          "A trade was detected on Sleeper! Use the buttons below to vote. (17 Vetoes to Block)",
        )
        .setColor(0x00ff00);

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("pass")
          .setLabel("✅ PASS")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("veto")
          .setLabel("❌ VETO")
          .setStyle(ButtonStyle.Danger),
      );

      await channel.send({ embeds: [embed], components: [buttons] });
    }
  } catch (err) {
    console.error("Sleeper Sync Error:", err);
  }
}

// 3. COMMAND HANDLER (Real-time Salary Lookups)
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith("!salary")) return;

  const searchInput = msg.content
    .replace("!salary ", "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (searchInput.length < 2) return msg.reply("⚠️ Search term too short.");

  msg.channel.sendTyping();

  try {
    const sheet = await getSheet();
    const rows = await sheet.getRows();

    // LOG ALL HEADERS TO CONSOLE (This helps us debug if it still fails)
    console.log("Headers found:", sheet.headerValues);

    const matches = rows.filter((row) => {
      // We check EVERY cell in the row to see if it contains the name
      // This bypasses the "column name" issue entirely
      return row._rawData.some((cellValue) => {
        if (!cellValue) return false;
        const cleanCellValue = cellValue
          .toString()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        return cleanCellValue.includes(searchInput);
      });
    });

    if (matches.length > 0) {
      matches.slice(0, 5).forEach((m) => {
        // Safe data retrieval using index positions if names fail
        // Assuming: Col 1 = Name, Col 2 = Pos, Col 3 = Salary, Col 4 = Years
        const name = m._rawData[0] || "Unknown";
        const pos = m._rawData[1] || "N/A";
        const salary = m._rawData[3] || "0";
        const years = m._rawData[2] || "0";

        msg.reply(
          `💰 **${name}** (${pos})\n**Salary:** $${salary}\n**Years:** ${years}`,
        );
      });
    } else {
      msg.reply(
        `❌ No results for **"${msg.content.replace("!salary ", "")}"**. Check spelling on the sheet!`,
      );
    }
  } catch (e) {
    console.error("Search Error:", e);
    msg.reply("⚠️ Internal error. Check Replit console.");
  }
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}! Monitoring trades...`);
  setInterval(checkTrades, 30000);
});

client.login(process.env.DISCORD_TOKEN);

const { Client, GatewayIntentBits } = require("discord.js");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const express = require("express");

// 1. KEEP-ALIVE SERVER (Required for Render Free Tier)
const app = express();
app.get("/", (req, res) => res.send("Bot is online!"));
app.listen(process.env.PORT || 3000);

// 2. CONFIGURATION
const SHEET_ID = process.env.SHEET_ID;
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function getSheet() {
  const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_EMAIL,
    key: process.env.GOOGLE_KEY.replace(/\\n/g, "\n"),
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
  });
  const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  return doc.sheetsByTitle["PlayerList"];
}

// 3. COMMAND HANDLER (Global/Partial Search)
client.on("messageCreate", async (msg) => {
  if (msg.author.bot || !msg.content.startsWith("!salary")) return;

  const searchInput = msg.content
    .replace("!salary ", "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (searchInput.length < 2) return msg.reply("⚠️ Search term too short.");

  try {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    const matches = rows.filter((row) => {
      return row._rawData.some(
        (cell) =>
          cell &&
          cell
            .toString()
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "")
            .includes(searchInput),
      );
    });

    if (matches.length > 0) {
      matches.slice(0, 5).forEach((m) => {
        const name = m._rawData[0] || "Unknown";
        const pos = m._rawData[1] || "N/A";
        const years = m._rawData[2] || "0";
        const salary = m._rawData[3] || "0";
        msg.reply(
          `💰 **${name}** (${pos})\n**Years:** ${years}\n**Salary:** $${salary}`,
        );
      });
    } else {
      msg.reply(
        `❌ No results found for "${msg.content.replace("!salary ", "")}".`,
      );
    }
  } catch (e) {
    console.error(e);
    msg.reply("⚠️ Error connecting to sheet.");
  }
});

client.login(process.env.DISCORD_TOKEN);
