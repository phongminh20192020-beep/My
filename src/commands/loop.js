"use strict";

const { SlashCommandBuilder } = require("discord.js");

const MODES  = { off: 0, track: 1, queue: 2 };
const LABELS = { off: "✖ Off", track: "🔂 Track", queue: "🔁 Queue" };

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
    player.repeatMode = MODES[mode];

    if (player.queue?.utils?.setRepeatMode)       player.queue.utils.setRepeatMode(MODES[mode]);
    else if (player.queue?.setRepeatMode)          player.queue.setRepeatMode(MODES[mode]);

    await interaction.editReply(`Loop mode set to **${LABELS[mode]}**.`);
  },
};
