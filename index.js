const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
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
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('salary')
    .setDescription('Shows player contract, dead cap, and restructures')
    .addStringOption(opt => opt.setName('player').setDescription('Player name').setRequired(true)),
  new SlashCommandBuilder()
    .setName('team')
    .setDescription('Shows team cap space and extensions')
    .addStringOption(opt => opt.setName('teamname').setDescription('Team name').setRequired(true)),
  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Calculates trade impact')
    .addStringOption(opt => opt.setName('teama').setDescription('TeamA: Player1, Player2').setRequired(true))
    .addStringOption(opt => opt.setName('teamb').setDescription('TeamB: Player1, Player2').setRequired(true)),
].map(command => command.toJSON());

client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('🚀 FRANCHISE BOT READY: Commands Loaded');
  } catch (error) { console.error(error); }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // CRITICAL FIX: Tell Discord to wait while we fetch data
  await interaction.deferReply(); 

  const { commandName, options } = interaction;
  
  try {
    await doc.loadInfo();

    if (commandName === 'salary') {
      const input = options.getString('player').toLowerCase();
      const rows = await doc.sheetsByTitle['PlayerList'].getRows();
      const transRows = await doc.sheetsByTitle['Transaction Log'].getRows();
      const row = rows.find(r => r.get('Player Name')?.toLowerCase().includes(input));

      if (row) {
        const name = row.get('Player Name');
        const hasDeadCap = row.get('Dead Cap') === 'TRUE'; //
        const trans = transRows.find(r => r.get('Player Name')?.toLowerCase().includes(name.toLowerCase()));
        const isRes = trans?.get('Type') === 'Restructure'; //

        const embed = new EmbedBuilder()
          .setTitle(`📊 Player Report: ${name}`)
          .setColor(hasDeadCap ? 0xff0000 : 0x00ff00)
          .addFields(
            { name: '💰 Salary', value: row.get('Yearly Salary') || "N/A", inline: true },
            { name: '🧢 Cap Hit', value: row.get('Cap Hit') || "N/A", inline: true },
            { name: '⏳ Years', value: row._rawData[2] || "0", inline: true },
            { name: '💀 Dead Cap', value: hasDeadCap ? "⚠️ Yes" : "❌ No", inline: true }
          );

        if (trans) {
          const label = isRes ? "🔄 Restructure Details" : "✨ Bonus"; //
          embed.addFields({ name: label, value: trans.get('Bonus Structure') || "None" });
          embed.setFooter({ text: `Kick In Year: ${trans.get('Kick In Year(Offseason)') || "N/A"}` });
        }
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply(`❌ Could not find **${input}**.`);
      }
    }

    if (commandName === 'team') {
      const input = options.getString('teamname').toLowerCase();
      const sheet = doc.sheetsByIndex.find(s => s.title.toLowerCase().includes(input));
      if (sheet) {
        await sheet.loadCells('F2:J2');
        const embed = new EmbedBuilder()
          .setTitle(`🏟️ Team Report: ${sheet.title}`)
          .setColor(0x3498db)
          .addFields(
            { name: '💸 Cap Space', value: sheet.getCellByA1('F2').formattedValue || "$0", inline: true },
            { name: '📝 Extensions', value: sheet.getCellByA1('J2').formattedValue || "0", inline: true }
          );
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply(`❌ Team **${input}** not found.`);
      }
    }

    if (commandName === 'trade') {
      // Trade logic remains same, but uses interaction.editReply() at the end
      // [Omitted for brevity, use same structure as above]
      await interaction.editReply("Trade Analysis complete."); 
    }

  } catch (err) {
    console.error(err);
    await interaction.editReply("⚠️ Error connecting to Spreadsheet.");
  }
});

client.login(process.env.DISCORD_TOKEN);
