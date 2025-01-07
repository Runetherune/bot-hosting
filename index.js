<<<<<<< HEAD
const express = require('express');
const path = require('path');
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, MessageCollector } = require('discord.js');
require('dotenv').config();

const app = express();
const PORT = 3000;

// Discord Client Setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

const ADMIN_ROLE_ID = '1320484049898307735'; // Erstat med den rolle, der skal administrere tickets

const ticketData = new Map(); // For at holde styr på tickets

// Start bot og opret ticket-panel
client.once('ready', async () => {
  console.log(`${client.user.tag} er online og klar!`);

  const channel = client.channels.cache.get('1320476764920610967'); // Udskift med kanalens ID
  if (!channel) return console.error('Kan ikke finde kanalen. Sørg for, at ID er korrekt.');

  const messages = await channel.messages.fetch({ limit: 50 });
  const existingEmbed = messages.find(
    (msg) =>
      msg.author.id === client.user.id &&
      msg.embeds.length > 0 &&
      msg.embeds[0].title === '🎟️ Opret en Ticket'
  );

  if (!existingEmbed) {
    const embed = new EmbedBuilder()
      .setTitle('🎟️ Opret en Ticket')
      .setDescription(
        'Klik på 📩 nedenfor for at oprette en ticket.\n\n**Sådan fungerer det:**\n1. En ny kanal oprettes for din supportanmodning.\n2. Administratorer vil hjælpe dig hurtigst muligt.\n3. Du kan lukke ticketen, når problemet er løst.'
      )
      .setColor(0x5865f2)
      .setFooter({ text: 'Administratoren kan til enhver tid lukke ticketen.' });

    const message = await channel.send({ embeds: [embed] });
    await message.react('📩');
    console.log('Ticket-panel sendt.');
  } else {
    console.log('Ticket-panel findes allerede.');
  }
});

// Håndter reaktioner for at oprette tickets
client.on('messageReactionAdd', async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;

  const { message, emoji } = reaction;

  if (message.author.id === client.user.id && emoji.name === '📩') {
    const guild = message.guild;
    const member = guild.members.cache.get(user.id);

    reaction.users.remove(user.id);

    const ticketChannel = await guild.channels.create({
      name: `ticket-${user.username}`,
      type: 0,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: member.id,
          allow: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: ADMIN_ROLE_ID,
          allow: [PermissionsBitField.Flags.ViewChannel],
        },
      ],
    });

    ticketData.set(ticketChannel.id, { owner: member, claimedBy: null, closedBy: null });

    const ticketMessage = await ticketChannel.send(
      `${member}, velkommen til din ticket! 
      Administratorer kan \`claim\` eller \`lukke\` ticketen ved at bruge reaktionerne nedenfor.`
    );

    await ticketMessage.react('✅');
    await ticketMessage.react('❌');
    await member.send(`Din ticket er oprettet: ${ticketChannel}`);
  }
});

// Håndter claim og lukning af tickets
client.on('messageReactionAdd', async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;

  const { message, emoji } = reaction;
  const member = message.guild.members.cache.get(user.id);

  // Tjek om brugeren har administratorrollen
  if (!member.roles.cache.has(ADMIN_ROLE_ID)) return;

  if (emoji.name === '✅' && message.channel.name.startsWith('ticket-')) {
    reaction.users.remove(user.id); // Fjern reaktionen fra brugeren

    const ticket = ticketData.get(message.channel.id);

    if (ticket.claimedBy) {
      return message.channel.send('Denne ticket er allerede blevet claimet.');
    }

    ticket.claimedBy = member;

    // Opdater dashboard API med nye værdier
    app.locals.ticketData = [...ticketData.values()];

    const claimMessage = await message.channel.send(
      `${member} har claimet denne ticket.`
    );

    setTimeout(() => claimMessage.delete().catch(() => {}), 5000); // Fjern claim-beskeden efter 5 sekunder
  }

  if (emoji.name === '❌' && message.channel.name.startsWith('ticket-')) {
    reaction.users.remove(user.id);

    const confirmationMessage = await message.channel.send(
      `${member}, er du sikker på, at du vil lukke denne ticket? Reager med ✅ for at bekræfte.`
    );

    await confirmationMessage.react('✅');

    const filter = (reaction, user) =>
      reaction.emoji.name === '✅' && user.id === member.id;
    const collector = confirmationMessage.createReactionCollector({
      filter,
      max: 1,
      time: 60000,
    });

    collector.on('collect', async () => {
      collector.stop();

      const reasonMessage = await message.channel.send(
        `${member}, skriv en kort begrundelse for, hvorfor ticketen lukkes:`
      );

      const reasonCollector = new MessageCollector(message.channel, {
        filter: (msg) => msg.author.id === member.id,
        max: 1,
        time: 60000,
      });

      reasonCollector.on('collect', async (msg) => {
        const reason = msg.content;
        reasonCollector.stop();

        ticketData.get(message.channel.id).closedBy = member;
        ticketData.get(message.channel.id).closedAt = new Date(); // Sørg for, at lukketidspunktet gemmes

        // Opdater dashboard API med nye værdier
        app.locals.ticketData = [...ticketData.values()];

        const logCategory =
          message.guild.channels.cache.find(
            (channel) => channel.name === 'Lukkede Tickets' && channel.type === 4
          ) ||
          (await message.guild.channels.create({
            name: 'Lukkede Tickets',
            type: 4,
          }));

        const transcript = (await message.channel.messages.fetch({ limit: 100 }))
          .map((msg) => `${msg.author.tag}: ${msg.content}`)
          .reverse()
          .join('\n');

        const logChannel = await message.guild.channels.create({
          name: `log-${message.channel.name}`,
          type: 0,
          parent: logCategory.id,
          permissionOverwrites: [
            {
              id: message.guild.roles.everyone.id,
              deny: [PermissionsBitField.Flags.ViewChannel],
            },
          ],
        });

        const { owner, claimedBy, closedBy } = ticketData.get(message.channel.id);

        await logChannel.send(
          `Referat af ticket:\n\`\`\`${transcript}\`\`\`
          **Claimed af:** ${claimedBy ? `${claimedBy.user.tag} (${claimedBy.roles.highest.name})` : 'Ingen'}
          **Lukket af:** ${closedBy.user.tag} (${closedBy.roles.highest.name})
          **Lukket med begrundelse:** ${reason}`
        );

        if (owner) {
          owner.send(
            `Din ticket "${message.channel.name}" er blevet lukket af ${closedBy.user.tag} (${closedBy.roles.highest.name}) med følgende begrundelse:\n${reason}`
          );
        }

        ticketData.delete(message.channel.id);
        await message.channel.delete().catch(() => {});
      });
    });
  }
});

// Dashboard API
app.use(express.static(path.join(__dirname, 'dashboard')));

app.get('/tickets', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
});

app.get('/api/tickets', (req, res) => {
  const openTickets = [...ticketData.values()].filter(ticket => !ticket.closedBy);
  const closedTickets = [...ticketData.values()].filter(ticket => ticket.closedBy);

  res.json({
    open: openTickets.length,
    closed: closedTickets.length,
    pending: openTickets.length, // Alle åbne anses som ventende her
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Dashboard tilgængeligt på http://localhost:${PORT}`);
});

// Login bot
client.login(process.env.DISCORD_TOKEN);
=======
const express = require('express');
const path = require('path');
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, MessageCollector } = require('discord.js');
require('dotenv').config();

const app = express();
const PORT = 3000;

// Discord Client Setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

const ADMIN_ROLE_ID = '1320484049898307735'; // Erstat med den rolle, der skal administrere tickets

const ticketData = new Map(); // For at holde styr på tickets

// Start bot og opret ticket-panel
client.once('ready', async () => {
  console.log(`${client.user.tag} er online og klar!`);

  const channel = client.channels.cache.get('1320476764920610967'); // Udskift med kanalens ID
  if (!channel) return console.error('Kan ikke finde kanalen. Sørg for, at ID er korrekt.');

  const messages = await channel.messages.fetch({ limit: 50 });
  const existingEmbed = messages.find(
    (msg) =>
      msg.author.id === client.user.id &&
      msg.embeds.length > 0 &&
      msg.embeds[0].title === '🎟️ Opret en Ticket'
  );

  if (!existingEmbed) {
    const embed = new EmbedBuilder()
      .setTitle('🎟️ Opret en Ticket')
      .setDescription(
        'Klik på 📩 nedenfor for at oprette en ticket.\n\n**Sådan fungerer det:**\n1. En ny kanal oprettes for din supportanmodning.\n2. Administratorer vil hjælpe dig hurtigst muligt.\n3. Du kan lukke ticketen, når problemet er løst.'
      )
      .setColor(0x5865f2)
      .setFooter({ text: 'Administratoren kan til enhver tid lukke ticketen.' });

    const message = await channel.send({ embeds: [embed] });
    await message.react('📩');
    console.log('Ticket-panel sendt.');
  } else {
    console.log('Ticket-panel findes allerede.');
  }
});

// Håndter reaktioner for at oprette tickets
client.on('messageReactionAdd', async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;

  const { message, emoji } = reaction;

  if (message.author.id === client.user.id && emoji.name === '📩') {
    const guild = message.guild;
    const member = guild.members.cache.get(user.id);

    reaction.users.remove(user.id);

    const ticketChannel = await guild.channels.create({
      name: `ticket-${user.username}`,
      type: 0,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: member.id,
          allow: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: ADMIN_ROLE_ID,
          allow: [PermissionsBitField.Flags.ViewChannel],
        },
      ],
    });

    ticketData.set(ticketChannel.id, { owner: member, claimedBy: null, closedBy: null });

    const ticketMessage = await ticketChannel.send(
      `${member}, velkommen til din ticket! 
      Administratorer kan \`claim\` eller \`lukke\` ticketen ved at bruge reaktionerne nedenfor.`
    );

    await ticketMessage.react('✅');
    await ticketMessage.react('❌');
    await member.send(`Din ticket er oprettet: ${ticketChannel}`);
  }
});

// Håndter claim og lukning af tickets
client.on('messageReactionAdd', async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;

  const { message, emoji } = reaction;
  const member = message.guild.members.cache.get(user.id);

  // Tjek om brugeren har administratorrollen
  if (!member.roles.cache.has(ADMIN_ROLE_ID)) return;

  if (emoji.name === '✅' && message.channel.name.startsWith('ticket-')) {
    reaction.users.remove(user.id); // Fjern reaktionen fra brugeren

    const ticket = ticketData.get(message.channel.id);

    if (ticket.claimedBy) {
      return message.channel.send('Denne ticket er allerede blevet claimet.');
    }

    ticket.claimedBy = member;

    // Opdater dashboard API med nye værdier
    app.locals.ticketData = [...ticketData.values()];

    const claimMessage = await message.channel.send(
      `${member} har claimet denne ticket.`
    );

    setTimeout(() => claimMessage.delete().catch(() => {}), 5000); // Fjern claim-beskeden efter 5 sekunder
  }

  if (emoji.name === '❌' && message.channel.name.startsWith('ticket-')) {
    reaction.users.remove(user.id);

    const confirmationMessage = await message.channel.send(
      `${member}, er du sikker på, at du vil lukke denne ticket? Reager med ✅ for at bekræfte.`
    );

    await confirmationMessage.react('✅');

    const filter = (reaction, user) =>
      reaction.emoji.name === '✅' && user.id === member.id;
    const collector = confirmationMessage.createReactionCollector({
      filter,
      max: 1,
      time: 60000,
    });

    collector.on('collect', async () => {
      collector.stop();

      const reasonMessage = await message.channel.send(
        `${member}, skriv en kort begrundelse for, hvorfor ticketen lukkes:`
      );

      const reasonCollector = new MessageCollector(message.channel, {
        filter: (msg) => msg.author.id === member.id,
        max: 1,
        time: 60000,
      });

      reasonCollector.on('collect', async (msg) => {
        const reason = msg.content;
        reasonCollector.stop();

        ticketData.get(message.channel.id).closedBy = member;
        ticketData.get(message.channel.id).closedAt = new Date(); // Sørg for, at lukketidspunktet gemmes

        // Opdater dashboard API med nye værdier
        app.locals.ticketData = [...ticketData.values()];

        const logCategory =
          message.guild.channels.cache.find(
            (channel) => channel.name === 'Lukkede Tickets' && channel.type === 4
          ) ||
          (await message.guild.channels.create({
            name: 'Lukkede Tickets',
            type: 4,
          }));

        const transcript = (await message.channel.messages.fetch({ limit: 100 }))
          .map((msg) => `${msg.author.tag}: ${msg.content}`)
          .reverse()
          .join('\n');

        const logChannel = await message.guild.channels.create({
          name: `log-${message.channel.name}`,
          type: 0,
          parent: logCategory.id,
          permissionOverwrites: [
            {
              id: message.guild.roles.everyone.id,
              deny: [PermissionsBitField.Flags.ViewChannel],
            },
          ],
        });

        const { owner, claimedBy, closedBy } = ticketData.get(message.channel.id);

        await logChannel.send(
          `Referat af ticket:\n\`\`\`${transcript}\`\`\`
          **Claimed af:** ${claimedBy ? `${claimedBy.user.tag} (${claimedBy.roles.highest.name})` : 'Ingen'}
          **Lukket af:** ${closedBy.user.tag} (${closedBy.roles.highest.name})
          **Lukket med begrundelse:** ${reason}`
        );

        if (owner) {
          owner.send(
            `Din ticket "${message.channel.name}" er blevet lukket af ${closedBy.user.tag} (${closedBy.roles.highest.name}) med følgende begrundelse:\n${reason}`
          );
        }

        ticketData.delete(message.channel.id);
        await message.channel.delete().catch(() => {});
      });
    });
  }
});

// Dashboard API
app.use(express.static(path.join(__dirname, 'dashboard')));

app.get('/tickets', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
});

app.get('/api/tickets', (req, res) => {
  const openTickets = [...ticketData.values()].filter(ticket => !ticket.closedBy);
  const closedTickets = [...ticketData.values()].filter(ticket => ticket.closedBy);

  res.json({
    open: openTickets.length,
    closed: closedTickets.length,
    pending: openTickets.length, // Alle åbne anses som ventende her
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Dashboard tilgængeligt på http://localhost:${PORT}`);
});

// Login bot
client.login(process.env.DISCORD_TOKEN);
>>>>>>> 9ef7792853b54b406b8386da981efd1cd4972307
