"use strict";

const { SlashCommandBuilder } = require("discord.js");
const { clearVoiceStatus }    = require("../utils/helpers");

// Silent audio track — keeps the voice connection alive.
// Discord disconnects bots after ~5 min of silence.
const SILENT_TRACK_URL = "https://www.youtube.com/watch?v=wu2djWZzmz0";

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
      player = client.lavalink.createPlayer({
        guildId:        interaction.guildId,
        voiceChannelId: voiceChannel.id,
        textChannelId:  interaction.channelId,
        selfDeaf:       true,
        selfMute:       false,
      });
      await player.connect();
    }

    // Stop any current playback
    if (player.playing || player.paused)
      await player.stopPlaying(true).catch(() => {});

    await clearVoiceStatus(client, player.voiceChannelId);

    // Set AFK flag so queueEnd doesn't destroy the player
    player.set("afk", true);
    player.set("autoplay", false);

    // Play a silent track on loop to prevent Discord's inactivity kick
    const res = await player
      .search({ query: SILENT_TRACK_URL }, interaction.user)
      .catch(() => null);

    if (res?.tracks?.[0]) {
      const silentTrack = res.tracks[0];
      player.queue.add(silentTrack);
      await player.setRepeatMode("track");
      await player.play().catch(() => {});
      await player.setVolume(0).catch(() => {});
    } else {
      console.warn("[AFK] Could not load silent track — bot may still be kicked by Discord.");
    }

    await interaction.editReply("💤 AFK mode active — staying in the channel silently. Use `/disconnect` to leave or `/play` to resume music.");
  },
};
