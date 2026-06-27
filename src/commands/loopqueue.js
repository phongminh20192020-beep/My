"use strict";

const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("loopqueue")
    .setDescription("Toggle queue loop on or off"),

  async execute(interaction, client) {
    await interaction.deferReply();

    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player || !player.queue.current)
      return interaction.editReply("Nothing is currently playing.");

    // repeatMode: 0 = off, 1 = track, 2 = queue
    const isQueueLoop = player.repeatMode === 2;
    await player.setRepeatMode(isQueueLoop ? 0 : 2);

    await interaction.editReply(
      isQueueLoop
        ? "🔁 Queue loop **disabled**."
        : "🔁 Queue loop **enabled** — the queue will repeat when it ends."
    );
  },
};
