const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// --- 1. WEB SERVER FOR RENDER ---
const app = express();
app.get('/', (req, res) => res.send('Franchise Bot: Active'));
app.listen(process.env.PORT || 10000);

// --- 2. AUTHENTICATION & CLIENT SETUP ---
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

// --- 3. DEFINE SLASH COMMANDS ---
const commands = [
  new SlashCommandBuilder()
    .setName('salary')
    .setDescription('Shows player contract details, dead cap, and restructure info')
    .addStringOption(option => 
      option.setName('player').setDescription('Enter the player name').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('team')
    .setDescription('Shows team cap space and available extensions')
    .addStringOption(option => 
      option.setName('teamname').setDescription('Enter the team name').setRequired(true)),

  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Calculates trade impact between two teams')
    .addStringOption(option => 
      option.setName('teama').setDescription('Name of the first team').setRequired(true))
    .addStringOption(option => 
      option.setName('teama_players').setDescription('Players from Team A (comma separated)').setRequired(true))
    .addStringOption(option => 
      option.setName('teamb').setDescription('Name of the second team').setRequired(true))
    .addStringOption(option => 
      option.setName('teamb_players').setDescription('Players from Team B (comma separated)').setRequired(true)),
].map(command => command.toJSON());

// --- 4. REGISTER COMMANDS ON STARTUP ---
client.once('ready', async () => {
  console.log(`🚀 FRANCHISE BOT READY as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
});

// --- 5. PREFIX REDIRECT (Handles ! commands) ---
client.on('messageCreate', (message) => {
  if (
