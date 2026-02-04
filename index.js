const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Franchise Bot: Active'));
app.listen(process.env.PORT || 10000);

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_EMAIL,
  key: process.env.GOOGLE_KEY.replace(/\\n/g, '\n'), 
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SHEET_ID, serviceAccountAuth);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.split(' ');
  const command = args[0].toLowerCase();

  // --- SALARY & BONUS COMMAND (WITH READABILITY SPACE) ---
  if (command === '!salary') {
    const playerNameInput = args.slice(1).join(' ').trim().toLowerCase();
    if (!playerNameInput) return message.reply("Please provide a name!");

    try {
      await doc.loadInfo();
      const playerSheet = doc.sheetsByTitle['PlayerList']; 
      const transactionSheet = doc.sheetsByTitle['Transaction Log']; 
      
      const playerRows = await playerSheet.getRows();
      const transRows = await transactionSheet.getRows();

      const playerRow = playerRows.find(r => {
        const fullName = r.get('Player Name') ? r.get('Player Name').toLowerCase() : "";
        return fullName.includes(playerNameInput); 
      });

      if (playerRow) {
        const name = playerRow.get('Player Name');
        const salary = playerRow.get('Yearly Salary') || "N/A";
        const capHit = playerRow.get('Cap Hit') || "N/A";
        const years = playerRow._rawData[2] || "0";
        const extended = playerRow.get('Extended') === 'TRUE';

        // LOOKUP BONUS IN TRANSACTION LOG
        const bonusInfo = transRows.find(r => 
          r.get('Player Name') && r.get('Player Name').toLowerCase().includes(name.toLowerCase())
        );

        let response = `📊 **Player Report: ${name}**\n`;
        response += `💰 **Yearly Salary:** ${salary}\n`;
        response += `🧢 **Cap Hit:** ${capHit}\n`;
        response += `⏳ **Years Remaining:** ${years}\n`;
        response += `📝 **Extended:** ${extended ? "✅ Yes" : "❌ No"}\n`;

        // Check if bonus info exists to add the space and the details [cite: 1.
