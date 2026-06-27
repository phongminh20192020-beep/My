"use strict";

const { SlashCommandBuilder } = require("discord.js");

// lavalink-client repeat modes: 0 = off, 1 = track, 2 = queue
const MODES = {
  off:   0,
  track: 1,
  queue: 2,
};

const LABELS = {
  0: "Off",
  1: "🔂 Track",
  2: "🔁 Queue",
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Set the loop mode")
    .addStringOption(o =>
      o.setName("mode")
        .setDescription("Loop mode")
        .setRequired(true)
        .addChoices(
          { name: "Off",   value: "off"   },
          { name: "Track", value: "track" },
          { name: "Queue", value: "queue" },
        )
    ),

  async execute(interaction, client) {
    await interaction.deferReply();

    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player || !player.queue.current)
      return interaction.editReply("Nothing is currently playing.");

    const mode = interaction.options.getString("mode");
    await player.setRepeatMode(MODES[mode]);

    await interaction.editReply(`Loop mode set to **${LABELS[MODES[mode]]}**.`);
  },
};
