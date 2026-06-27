"use strict";

const { SlashCommandBuilder } = require("discord.js");
const { clearVoiceStatus }    = require("../utils/helpers");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("afk")
    .setDescription("Stop music and keep the bot in the voice channel indefinitely"),

  async execute(interaction, client) {
    await interaction.deferReply();

    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel)
      return interaction.editReply("You must be in a voice channel.");

    let player = client.lavalink.getPlayer(interaction.guildId);

    if (!player) {
      // Bot isn't in a channel yet — join and just sit there
      player = client.lavalink.createPlayer({
        guildId:        interaction.guildId,
        voiceChannelId: voiceChannel.id,
        textChannelId:  interaction.channelId,
        selfDeaf:       true,
        selfMute:       false,
      });
      await player.connect();
      await interaction.editReply("💤 Joined and going AFK — I'll stay here until you use `/disconnect`.");
      return;
    }

    // Stop playback and clear the queue
    if (player.playing || player.paused) {
      await player.stopPlaying(true).catch(() => {});
    }

    // Clear voice status
    await clearVoiceStatus(client, player.voiceChannelId);

    // Disable autoplay and prevent auto-destroy on empty queue
    player.set("autoplay", false);
    if (player.options) {
      player.options.onEmptyQueue = { destroyAfterMs: 0 };
    }

    await interaction.editReply("💤 Music stopped — staying in the channel. Use `/disconnect` to leave or `/play` to resume.");
  },
};
