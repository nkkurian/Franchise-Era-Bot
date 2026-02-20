const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const express = require('express');

// --- 1. WEB SERVER ---
const app = express();
app.get('/', (req, res) => res.send('Franchise Bot: Active'));
app.listen(process.env.PORT || 10000);

// --- 2. AUTH & CLIENT ---
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_EMAIL,
  key: process.env.GOOGLE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SHEET_ID, serviceAccountAuth);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- 3. SLASH COMMAND DEFINITIONS ---
const commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Explains bot symbols, commands, and league rules'),
    
  new SlashCommandBuilder()
    .setName('salary')
    .setDescription('Shows player contract, dead cap, and restructure info')
    .addStringOption(opt => opt.setName('player').setDescription('Player name').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('team')
    .setDescription('Shows cap space, extensions, and top earners')
    .addStringOption(opt => opt.setName('teamname').setDescription('Team name').setRequired(true)),

  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Calculates trade impact between two teams')
    .addStringOption(opt => opt.setName('teama').setDescription('Team A').setRequired(true))
    .addStringOption(opt => opt.setName('teama_players').setDescription('Team A Players (comma separated)').setRequired(true))
    .addStringOption(opt => opt.setName('teamb').setDescription('Team B').setRequired(true))
    .addStringOption(opt => opt.setName('teamb_players').setDescription('Team B Players (comma separated)').setRequired(true)),
].map(command => command.toJSON());

// --- 4. STARTUP ---
client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log(`🚀 FRANCHISE BOT READY`);
});

// --- 5. SILENT PREFIX REDIRECT ---
client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  const content = message.content.toLowerCase();
  const oldCommands = ['!salary', '!team', '!trade', '!help'];
  if (oldCommands.some(cmd => content.startsWith(cmd))) {
    message.reply("⚠️ **Please use / commands!** Type `/` to see the menu.");
  }
});

// --- 6. INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply(); 

  const { commandName, options } = interaction;
  try {
    await doc.loadInfo();
    const playerSheet = doc.sheetsByTitle['PlayerList'];
    const transSheet = doc.sheetsByTitle['Transaction Log'];

    // --- HELP COMMAND ---
    if (commandName === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setTitle('📚 Franchise League Help Guide')
        .setColor(0x5865F2)
        .setDescription('Welcome to the Franchise Bot! Here is a guide to the symbols and tools used in our salary tracking.')
        .addFields(
          { name: '🛠️ Commands', value: '`/salary`: Check a player contract\n`/team`: Check cap space & top earners\n`/trade`: Analyze trade impact' },
          { name: '💀 Dead Cap', value: 'Indicates a player has guaranteed money that stays on your books if cut or traded.' },
          { name: '🔄 Restructure', value: 'Details from the Transaction Log showing modified contracts.' },
          { name: '✨ Bonus', value: 'Specific signing or performance bonuses noted in the log.' }
        )
        .setFooter({ text: 'Always use the / popup menu for accuracy!' });
      return await interaction.editReply({ embeds: [helpEmbed] });
    }

    // --- SALARY COMMAND ---
    if (commandName === 'salary') {
      const input = options.getString('player').toLowerCase();
      const rows = await playerSheet.getRows();
      const transRows = await transSheet.getRows();
      const row = rows.find(r => r.get('Player Name')?.toLowerCase().includes(input));

      if (row) {
        const name = row.get('Player Name');
        const hasDeadCap = row.get('Dead Cap') === 'TRUE';
        const trans = transRows.find(r => r.get('Player Name')?.toLowerCase().includes(name.toLowerCase()));
        
        const embed = new EmbedBuilder()
          .setTitle(`📊 Player Report: ${name}`)
          .setColor(hasDeadCap ? 0xff0000 : 0x00ff00)
          .addFields(
            { name: '💰 Salary', value: row.get('Yearly Salary') || "N/A", inline: true },
            { name: '🧢 Cap Hit', value: row.get('Cap Hit') || "N/A", inline: true },
            { name: '💀 Dead Cap', value: hasDeadCap ? "⚠️ Yes" : "❌ No", inline: true }
          );
        if (trans) embed.addFields({ name: trans.get('Type') === 'Restructure' ? '🔄 Restructure' : '✨ Bonus', value: trans.get('Bonus Structure') || 'N/A' });
        await interaction.editReply({ embeds: [embed] });
      } else await interaction.editReply(`❌ Player **${input}** not found.`);
    }

    // --- TEAM COMMAND (SMART CARD) ---
    if (commandName === 'team') {
      const input = options.getString('teamname').toLowerCase();
      const sheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(input));
      if (sheet) {
        await sheet.loadCells('F2:J2');
        const capRaw = sheet.getCellByA1('F2').formattedValue || "$0";
        const capValue = parseFloat(capRaw.replace(/[$,]/g, ''));
        const isNegative = capValue < 0;

        // Fetch Top 5 Earners 
        const playerRows = await playerSheet.getRows();
        const teamPlayers = playerRows
          .filter(r => r.get('Team')?.toLowerCase() === sheet.title.toLowerCase())
          .sort((a, b) => {
            const hitA = parseFloat((a.get('Cap Hit') || "0").replace(/[$,]/g, ''));
            const hitB = parseFloat((b.get('Cap Hit') || "0").replace(/[$,]/g, ''));
            return hitB - hitA;
          })
          .slice(0, 5);

        const topEarners = teamPlayers.map(p => `\`${p.get('Cap Hit')}\` - ${p.get('Player Name')}`).join('\n') || 'No players found';

        const embed = new EmbedBuilder()
          .setTitle(`🏟️ Team Report: ${sheet.title}`)
          .setColor(isNegative ? 0xff0000 : 0x3498db)
          .addFields(
            { name: '💸 Cap Space', value: isNegative ? `⚠️ **${capRaw}**` : capRaw, inline: true },
            { name: '📝 Extensions', value: sheet.getCellByA1('J2').formattedValue || "0", inline: true },
            { name: '🔝 Top 5 Cap Hits', value: topEarners }
          );
        
        if (isNegative) embed.setDescription('🚨 **WARNING:** This team is currently over the salary cap!');
        await interaction.editReply({ embeds: [embed] });
      } else await interaction.editReply(`❌ Team **${input}** not found.`);
    }

    // --- TRADE COMMAND ---
    if (commandName === 'trade') {
      const tA = options.getString('teama');
      const pA = options.getString('teama_players').split(',').map(p => p.trim().toLowerCase());
      const tB = options.getString('teamb');
      const pB = options.getString('teamb_players').split(',').map(p => p.trim().toLowerCase());
      
      const playerRows = await playerSheet.getRows();
      const transRows = await transSheet.getRows();

      const processSide = async (name, playerNames) => {
        let total = 0; let details = [];
        const tSheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(name.toLowerCase()));
        let cap = 0;
        if (tSheet) { await tSheet.loadCells('F2'); cap = parseFloat(tSheet.getCellByA1('F2').formattedValue.replace(/[$,]/g, '')) || 0; }

        playerNames.forEach(pn => {
          const r = playerRows.find(row => row.get('Player Name')?.toLowerCase().includes(pn));
          if (r) {
            const hit = parseFloat((r.get('Cap Hit') || "0").replace(/[$,]/g, ''));
            total += hit;
            const tr = transRows.find(t => t.get('Player Name')?.toLowerCase().includes(r.get('Player Name').toLowerCase()));
            let str = `- **${r.get('Player Name')}** ($${hit.toLocaleString()})${r.get('Dead Cap') === 'TRUE' ? " 💀" : ""}`;
            if (tr) str += `\n   └ *${tr.get('Type')}: ${tr.get('Bonus Structure')}*`;
            details.push(str);
          }
        });
        return { title: tSheet ? tSheet.title : name, total, details, cap };
      };

      const sA = await processSide(tA, pA);
      const sB = await processSide(tB, pB);
      
      const nA = sA.cap + sA.total - sB.total;
      const nB = sB.cap + sB.total - sA.total;

      const embed = new EmbedBuilder()
        .setTitle('🤝 Detailed Trade Analysis')
        .setColor(0xe67e22)
        .addFields(
          { name: `📤 ${sA.title} Sends`, value: sA.details.join('\n') || 'None' },
          { name: `📥 ${sB.title} Sends`, value: sB.details.join('\n') || 'None' },
          { name: `💰 ${sA.title} New Cap`, value: nA < 0 ? `🚨 $${nA.toLocaleString()}` : `$${nA.toLocaleString()}`, inline: true },
          { name: `💰 ${sB.title} New Cap`, value: nB < 0 ? `🚨 $${nB.toLocaleString()}` : `$${nB.toLocaleString()}`, inline: true }
        );
      await interaction.editReply({ embeds: [embed] });
    }
  } catch (err) { console.error(err); await interaction.editReply("⚠️ Error processing request."); }
});

client.login(process.env.DISCORD_TOKEN);
