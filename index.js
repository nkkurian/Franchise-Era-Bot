const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// 1. RENDER WEB SERVER & MONITORING ENDPOINT
const app = express();
app.get('/', (req, res) => {
  console.log("💓 Heartbeat received from Monitor"); // Tells you the monitor is working
  res.send('Salary Tracker: Active & Monitored');
});
app.listen(process.env.PORT || 10000, () => console.log("✅ Web Port Linked"));

// 2. GOOGLE SHEETS AUTH
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_EMAIL,
  key: process.env.GOOGLE_KEY.replace(/\\n/g, '\n'), 
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SHEET_ID, serviceAccountAuth);

// 3. DISCORD CLIENT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 4. THE SALARY COMMAND
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.split(' ');
  const command = args[0].toLowerCase();

  if (command === '!salary') {
    const playerName = args.slice(1).join(' ');

    if (!playerName) {
      return message.reply("Please provide a name! Example: `!salary LeBron James`");
    }

    try {
      await doc.loadInfo();
      const sheet = doc.sheetsByIndex[0]; 
      const rows = await sheet.getRows();

      const playerRow = rows.find(r => r.get('Name').toLowerCase() === playerName.toLowerCase());

      if (playerRow) {
        const salary = playerRow.get('Salary');
        message.reply(`💰 **${playerName}** | Current Salary: **$${salary}**`);
      } else {
        message.reply(`❌ Player "${playerName}" not found.`);
      }
    } catch (err) {
      console.error("Sheets Error:", err);
      message.reply("⚠️ Error connecting to the salary database.");
    }
  }
});

// 5. LOGIN
client.once('ready', () => {
  console.log(`🚀 SALARY TRACKER ONLINE: ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error("❌ LOGIN FAILED:", err.message);
});
