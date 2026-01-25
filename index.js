const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// 1. KEEP-ALIVE SERVER (Critical for UptimeRobot)
const app = express();
app.get('/', (req, res) => res.send('Bot is online!'));
app.listen(process.env.PORT || 3000); 

// 2. CONFIGURATION
const SHEET_ID = process.env.SHEET_ID;
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent
  ]
});

// Helper function to handle Google Auth and fetching with Retry logic
async function getSheetData() {
  const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_EMAIL,
    // Fixes the potential \n formatting issue from Render environment variables
    key: process.env.GOOGLE_KEY.replace(/\\n/g, '\n'),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file'
    ],
  });

  const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
  
  // Retry logic: Attempt to connect 3 times if the server is "cold"
  let attempts = 0;
  while (attempts < 3) {
    try {
      await doc.loadInfo();
      const sheet = doc.sheetsByTitle['PlayerList'];
      return await sheet.getRows();
    } catch (e) {
      attempts++;
      console.log(`Connection attempt ${attempts} failed. Retrying...`);
      if (attempts === 3) throw e;
      // Wait 2 seconds for the connection to warm up
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// 3. COMMAND HANDLER
client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.content.startsWith('!salary')) return;

  const searchInput = msg.content.replace('!salary ', '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (searchInput.length < 2) return msg.reply("⚠️ Search term too short.");

  // Show "is typing..." to bridge the gap during the wake-up
