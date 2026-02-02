const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// 1. Render Web Server
const app = express();
app.get('/', (req, res) => res.send('Salary Tracker is Online'));
app.listen(process.env.PORT || 10000);

// 2. Google Sheets Authentication Setup
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_EMAIL,
  key: process.env.GOOGLE_KEY.replace(/\\n/g, '\n'), // Fixes private key formatting
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SHEET_ID, serviceAccountAuth);

// 3. Discord Bot Setup
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// 4. THE SALARY LOGIC
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.split(' ');
  const command = args[0].toLowerCase();

  if (command === '!salary') {
    const playerName = args.slice(1).join(' '); // Grabs everything after !salary
    
    if (!playerName) return message.reply("Please provide a player name! (e.g., `!salary LeBron James`)");

    try {
      await doc.loadInfo(); 
      const sheet = doc.sheetsByIndex[0]; // Assumes salary is in the first tab
      const rows = await sheet.getRows();
      
      // Look for the player (Assumes column 1 is 'Name' and column 2 is 'Salary')
      const playerRow = rows.find(r => r.get('Name').toLowerCase() === playerName.toLowerCase());

      if (playerRow) {
        message.reply(`💰 **${playerName}** earns **$${playerRow.get('Salary')}** this season.`);
      } else {
        message.reply(`❌ Player "${playerName}" not found in the records.`);
      }
    } catch (err) {
      console.error(err);
      message.reply("⚠️ Error accessing the salary database.");
    }
  }
});

client.once('ready', () => console.log(`🚀 New Bot Ready: ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);
