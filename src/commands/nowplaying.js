"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { formatDuration, progressBar }       = require("../utils/helpers");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Show details about the currently playing track"),

  async execute(interaction, client) {
    await interaction.deferReply();

    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player || !player.queue.current)
      return interaction.editReply("Nothing is currently playing.");

    const track    = player.queue.current;
    const position = player.position;
    const duration = track.info.duration;
    const bar      = track.info.isStream ? "🔴 LIVE" : progressBar(position, duration);

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("Now Playing")
      .setDescription(`**[${track.info.title}](${track.info.uri})**`)
      .addFields(
        { name: "Author",       value: track.info.author || "Unknown",                                                             inline: true },
        { name: "Duration",     value: track.info.isStream ? "🔴 LIVE" : `${formatDuration(position)} / ${formatDuration(duration)}`, inline: true },
        { name: "Requested By", value: track.requester?.username || "Unknown",                                                     inline: true },
        { name: "Progress",     value: bar }
      )
      .setThumbnail(track.info.artworkUrl || "");

    await interaction.editReply({ embeds: [embed] });
  },
};
