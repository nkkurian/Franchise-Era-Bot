const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// --- 1. WEB SERVER FOR RENDER ---
const app = express();
app.get('/', (req, res) => res.send('Franchise Bot: Active'));
app.listen(process.env.PORT || 10000);

// --- 2. AUTHENTICATION ---
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_EMAIL,
  key: process.env.GOOGLE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SHEET_ID, serviceAccountAuth);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- 3. COMMAND DEFINITIONS ---
const commands = [
  new SlashCommandBuilder().setName('help').setDescription('Explains bot symbols and rules'),
  new SlashCommandBuilder()
    .setName('salary')
    .setDescription('Shows player contract and restructure info')
    .addStringOption(opt => opt.setName('player').setDescription('Player name').setRequired(true)),
  new SlashCommandBuilder()
    .setName('team')
    .setDescription('Shows cap space and top earners')
    .addStringOption(opt => opt.setName('teamname').setDescription('Team name').setRequired(true)),
  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Calculates trade impact')
    .addStringOption(opt => opt.setName('teama').setRequired(true))
    .addStringOption(opt => opt.setName('p_teama').setRequired(true))
    .addStringOption(opt => opt.setName('teamb').setRequired(true))
    .addStringOption(opt => opt.setName('p_teamb').setRequired(true)),
].map(command => command.toJSON());

// --- 4. STARTUP ---
client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log(`🚀 FRANCHISE BOT READY`);
});

// --- 5. INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply(); // Prevents "Application did not respond"

  try {
    await doc.loadInfo();
    const { commandName, options } = interaction;

    // --- HELP COMMAND ---
    if (commandName === 'help') {
      const help = new EmbedBuilder()
        .setTitle('📚 Franchise Help')
        .setColor(0x5865F2)
        .addFields(
          { name: '💀 Dead Cap', value: 'Guaranteed money remaining.', inline: true },
          { name: '🔄 Restructure', value: 'Modified contract info from logs.', inline: true }
        );
      return await interaction.editReply({ embeds: [help] });
    }

    // --- TEAM COMMAND (FIXED FOR ROW 9 OFFSET) ---
    if (commandName === 'team') {
      const input = options.getString('teamname').toLowerCase();
      const sheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(input));

      if (sheet) {
        // Scan Row 9 (Index 8) to Row 50 for players
        await sheet.loadCells('A1:J50'); 
        
        const capSpace = sheet.getCellByA1('F2').formattedValue || "$0";
        const extensions = sheet.getCellByA1('I2').formattedValue || "0";
        const capVal = parseFloat(capSpace.replace(/[$,]/g, '')) || 0;

        let players = [];
        for (let i = 8; i < 45; i++) { // Starts scanning at Row 9
          const pName = sheet.getCell(i, 0).value; // Column A
          const pHit = sheet.getCell(i, 6).formattedValue; // Column G: Cap hit(This Year)
          
          if (pName && pHit && pHit !== "$0.00") {
            players.push({
              name: pName,
              hit: pHit,
              rawHit: parseFloat(pHit.replace(/[$,]/g, '')) || 0
            });
          }
        }

        const topEarners = players
          .sort((a, b) => b.rawHit - a.rawHit)
          .slice(0, 5)
          .map(p => `\`${p.hit}\` - ${p.name}`)
          .join('\n') || 'No players found';

        const embed = new EmbedBuilder()
          .setTitle(`🏟️ Team Report: ${sheet.title}`)
          .setColor(capVal < 0 ? 0xff0000 : 0x3498db)
          .addFields(
            { name: '💸 Cap Space', value: capVal < 0 ? `🚨 **${capSpace}**` : capSpace, inline: true },
            { name: '📝 Extensions', value: extensions, inline: true },
            { name: '🔝 Top 5 Earners', value: topEarners }
          );

        await interaction.editReply({ embeds: [embed] });
      } else await interaction.editReply(`❌ Team **${input}** not found.`);
    }

    // --- SALARY COMMAND ---
    if (commandName === 'salary') {
      const input = options.getString('player').toLowerCase();
      const pSheet = doc.sheetsByTitle['PlayerList'];
      const tSheet = doc.sheetsByTitle['Transaction Log'];
      
      const rows = await pSheet.getRows();
      const tRows = await tSheet.getRows();
      const row = rows.find(r => r.get('Player Name')?.toLowerCase().includes(input));

      if (row) {
        const name = row.get('Player Name');
        const trans = tRows.find(tr => tr.get('Player Name')?.toLowerCase().includes(name.toLowerCase()));
        const isDead = row.get('Dead Cap') === 'TRUE';

        const embed = new EmbedBuilder()
          .setTitle(`📊 Player Report: ${name}`)
          .setColor(isDead ? 0xff0000 : 0x00ff00)
          .addFields(
            { name: '💰 Salary', value: row.get('Yearly Salary') || "N/A", inline: true },
            { name: '🧢 Cap Hit', value: row.get('Cap Hit') || "N/A", inline: true },
            { name: '💀 Dead Cap', value: isDead ? "⚠️ Yes" : "❌ No", inline: true }
          );
        if (trans) embed.addFields({ name: '✨ Bonus/Note', value: trans.get('Bonus Structure') || 'N/A' });
        await interaction.editReply({ embeds: [embed] });
      } else await interaction.editReply(`❌ Player **${input}** not found.`);
    }

    // --- TRADE COMMAND ---
    if (commandName === 'trade') {
      const tA = options.getString('teama');
      const pA_input = options.getString('p_teama').split(',').map(p => p.trim().toLowerCase());
      const tB = options.getString('teamb');
      const pB_input = options.getString('p_teamb').split(',').map(p => p.trim().toLowerCase());
      
      const pRows = await doc.sheetsByTitle['PlayerList'].getRows();

      const getSide = async (teamName, playersIn) => {
        const sh = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(teamName.toLowerCase()));
        let cap = 0; if (sh) { await sh.loadCells('F2'); cap = parseFloat(sh.getCellByA1('F2').formattedValue.replace(/[$,]/g, '')) || 0; }
        
        let totalSent = 0;
        playersIn.forEach(pn => {
          const r = pRows.find(row => row.get('Player Name')?.toLowerCase().includes(pn));
          if (r) totalSent += parseFloat((r.get('Cap Hit') || "0").replace(/[$,]/g, '')) || 0;
        });
        return { title: sh ? sh.title : teamName, cap, totalSent };
      };

      const sA = await getSide(tA, pA_input);
      const sB = await getSide(tB, pB_input);
      
      const embed = new EmbedBuilder()
        .setTitle('🤝 Trade Analysis')
        .setColor(0xe67e22)
        .addFields(
          { name: `${sA.title} New Cap`, value: `$${(sA.cap + sA.totalSent - sB.totalSent).toLocaleString()}`, inline: true },
          { name: `${sB.title} New Cap`, value: `$${(sB.cap + sB.totalSent - sA.totalSent).toLocaleString()}`, inline: true }
        );
      await interaction.editReply({ embeds: [embed] });
    }

  } catch (err) {
    console.error(err);
    await interaction.editReply("⚠️ Error: Check spreadsheet formatting or permissions.");
  }
});

client.login(process.env.DISCORD_TOKEN);
