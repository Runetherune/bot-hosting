const { Client, GatewayIntentBits, PermissionsBitField, MessageCollector } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

// Rolle-ID for administratorer
const ADMIN_ROLE_ID = '1320484049898307735'; // Erstat med den rolle, der skal administrere tickets

client.once('ready', async () => {
  console.log(`${client.user.tag} er online og klar!`);

  const channel = client.channels.cache.get('1320476764920610967'); // Udskift med kanalens ID
  if (!channel) return console.error('Kan ikke finde kanalen. Sørg for, at ID er korrekt.');

  // Kontrollér, om der allerede findes en ticket-besked
  const messages = await channel.messages.fetch({ limit: 50 });
  const existingMessage = messages.find(
    (msg) => msg.author.id === client.user.id && msg.content.includes('Reager med 📩 for at oprette en ticket!')
  );

  if (!existingMessage) {
    const message = await channel.send('📩 Reager med 📩 for at oprette en ticket!');
    await message.react('📩'); // Reaktion for at oprette tickets
    console.log('Ticket-besked sendt.');
  } else {
    console.log('Ticket-besked findes allerede.');
  }
});

const ticketData = new Map(); // For at holde styr på claim og lukning

// Opret ticket ved reaktion
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

    await ticketMessage.react('✅'); // Claim
    await ticketMessage.react('❌'); // Luk
    await member.send(`Din ticket er oprettet: ${ticketChannel}`);
  }
});

// Håndter claim og lukning af tickets
client.on('messageReactionAdd', async (reaction, user) => {
  if (reaction.partial) await reaction.fetch();
  if (user.bot) return;

  const { message, emoji } = reaction;
  const member = message.guild.members.cache.get(user.id);

  if (!member.roles.cache.has(ADMIN_ROLE_ID)) return;

  if (emoji.name === '✅' && message.channel.name.startsWith('ticket-')) {
    reaction.users.remove(user.id);

    ticketData.get(message.channel.id).claimedBy = member;

    const claimMessage = await message.channel.send(
      `${member} har claimet denne ticket.`
    );
    setTimeout(() => claimMessage.delete(), 5000);
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

        await message.channel.delete();
        ticketData.delete(message.channel.id);
      });
    });
  }
});

// Login med bot-token
client.login(process.env.DISCORD_TOKEN);