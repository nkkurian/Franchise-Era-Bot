const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

console.log("--- BOT STARTING ---");

// 1. WEB SERVER (Prevents Render Port Errors)
const app = express();
app.get('/', (req, res) => res.send('Bot Status: Healthy'));
app.listen(process.env.PORT || 3000, () => console.log("✅ Web Server Live"));

// 2. DISCORD CLIENT SETUP
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent // CRITICAL: Must be enabled in Discord Dev Portal
  ]
});

// 3. MODERN GOOGLE AUTH
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_EMAIL,
  key: (process.env.GOOGLE_KEY || '').replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(process.env.SHEET_ID, serviceAccountAuth);

// 4. COMMAND HANDLER
client.on('messageCreate', async (msg) => {
  // Console logs help you debug in the Render 'Logs' tab
  console.log(`Bot saw: "${msg.content}" from ${msg.author.tag}`);

  if (msg.author.bot || !msg.content.startsWith('!salary')) return;

  const searchInput = msg.content.replace('!salary ', '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (searchInput.length < 2) return; 

  try {
    console.log(`Triggering typing for: ${searchInput}`);
    await msg.channel.sendTyping(); // If this works, the bot is alive!
    
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle['PlayerList'];
    if (!sheet) {
        console.error("❌ Sheet 'PlayerList' not found!");
        return msg.reply("❌ Error: Could not find the 'PlayerList' tab.");
    }

    const rows = await sheet.getRows();
    const matches = rows.filter(row => {
      return row._rawData.some(cell => 
        cell && cell.toString().toLowerCase().replace(/[^a-z0-9]/g, '').includes(searchInput)
      );
    });

    if (matches.length > 0) {
      let response = "";
      matches.slice(0, 3).forEach(m => {
        response += `💰 **${m._rawData[0]}** (${m._rawData[1]})\n**Years:** ${m._rawData[2]}\n**Salary:** ${m._rawData[3]}\n\n`;
      });
      return msg.reply(response);
    } else {
      return msg.reply("❌ No player found.");
    }
  } catch (e) {
    console.error("CRITICAL ERROR:", e.message); //
    return msg.reply(`⚠️ Sheet Error: ${e.message}`);
  }
});

client.once('ready', () => {
  console.log(`✅ SUCCESS: Logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error("❌ LOGIN FAILED:", err.message);
});
