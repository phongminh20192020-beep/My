"use strict";

const { clearVoiceStatus } = require("../utils/helpers");

module.exports = {
  name: "voiceStateUpdate",
  once: false,
  async execute(oldState, newState, client) {
    const player = client.lavalink.getPlayer(oldState.guild.id);
    if (!player) return;

    // Bot was forcibly disconnected — clean up
    if (oldState.id === client.user.id && !newState.channelId) {
      await clearVoiceStatus(client, player.voiceChannelId);
      await player.destroy();
      return;
    }

    // Auto-leave after 30s if all humans leave
    const voiceChannel = oldState.guild.channels.cache.get(player.voiceChannelId);
    if (!voiceChannel) return;
    if (voiceChannel.members.filter(m => !m.user.bot).size > 0) return;

    setTimeout(async () => {
      const p  = client.lavalink.getPlayer(oldState.guild.id);
      if (!p) return;
      const vc = oldState.guild.channels.cache.get(p.voiceChannelId);
      if (!vc || vc.members.filter(m => !m.user.bot).size > 0) return;

      await clearVoiceStatus(client, p.voiceChannelId);
      await p.destroy();
      client.channels.cache.get(p.textChannelId)
        ?.send("Left the voice channel due to inactivity.").catch(() => {});
    }, 30_000);
  },
};
