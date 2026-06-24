"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { formatDuration, resolveSpotify } = require("../utils/helpers");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Search or play a track, YouTube URL, or Spotify link")
    .addStringOption(o =>
      o.setName("query").setDescription("Song name, YouTube URL, or Spotify URL").setRequired(true)
    ),

  async execute(interaction, client) {
    await interaction.deferReply();

    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) return interaction.editReply("You must be in a voice channel.");

    const perms = voiceChannel.permissionsFor(interaction.guild.members.me);
    if (!perms.has("Connect") || !perms.has("Speak"))
      return interaction.editReply("I need permission to join and speak in your channel.");

    let player = client.lavalink.getPlayer(interaction.guildId);
    const isNew = !player;

    if (!player) {
      player = client.lavalink.createPlayer({
        guildId:        interaction.guildId,
        voiceChannelId: voiceChannel.id,
        textChannelId:  interaction.channelId,
        selfDeaf:  true,
        selfMute: false,
      });
    }

    if (!player.connected) {
      await player.connect();
      if (isNew) await new Promise(r => setTimeout(r, 1000));
    }

    const query     = interaction.options.getString("query");
    const isSpotify = /spotify\.com\/(track|playlist|album)\//.test(query);
    const isUrl     = /^https?:\/\//.test(query);

    // ── Spotify ───────────────────────────────────────────────────────────────
    if (isSpotify) {
      if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET)
        return interaction.editReply("❌ Spotify credentials are not configured (`SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`).");

      let spotifyData;
      try { spotifyData = await resolveSpotify(query); }
      catch (err) {
        console.error("[Play] Spotify resolve error:", err.message);
        return interaction.editReply("❌ Failed to fetch Spotify data. Try again later.");
      }

      if (!spotifyData?.tracks?.length)
        return interaction.editReply("❌ No tracks found in that Spotify link.");

      // Single track
      if (spotifyData.type === "track") {
        const { query: ytQuery, title, artist } = spotifyData.tracks[0];
        const res = await player.search({ query: ytQuery, source: "ytmsearch" }, interaction.user).catch(() => null);
        if (!res?.tracks?.length) return interaction.editReply(`❌ Couldn't find **${title}** on YouTube Music.`);

        const track = res.tracks[0];
        player.queue.add(track);

        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0x1db954)
            .setTitle("Added to Queue (via Spotify)")
            .setDescription(`**[${track.info.title}](${track.info.uri})**`)
            .addFields(
              { name: "Author",   value: track.info.author || artist || "Unknown", inline: true },
              { name: "Duration", value: track.info.isStream ? "🔴 LIVE" : formatDuration(track.info.duration), inline: true }
            )
            .setThumbnail(track.info.artworkUrl || "")],
        });

      // Playlist / album
      } else {
        const { name, tracks } = spotifyData;
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0x1db954)
            .setTitle("Loading Spotify Playlist...")
            .setDescription(`Found **${tracks.length}** tracks in **${name}**. Adding to queue...`)],
        });

        let added = 0;
        for (const { query: ytQuery } of tracks) {
          try {
            const res = await player.search({ query: ytQuery, source: "ytmsearch" }, interaction.user);
            if (res?.tracks?.[0]) {
              player.queue.add(res.tracks[0]);
              added++;
              if (added === 1 && !player.playing && !player.paused) await player.play().catch(() => {});
            }
          } catch { /* skip failed tracks */ }
        }

        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0x1db954)
            .setTitle("Playlist Added")
            .setDescription(`Added **${added}/${tracks.length}** tracks from **${name}** to the queue.`)],
        });
      }

      if (!player.playing && !player.paused) await player.play().catch(err => console.error("[Play] play() error:", err.message));
      return;
    }

    // ── Normal search / URL ───────────────────────────────────────────────────
    const res = await player
      .search(isUrl ? { query } : { query, source: "ytmsearch" }, interaction.user)
      .catch(err => { console.error("[Play] search error:", err.message); return null; });

    if (!res || res.loadType === "empty" || res.loadType === "error")
      return interaction.editReply(`❌ No results found for \`${query}\`.`);

    if (res.loadType === "playlist") {
      for (const track of res.tracks) player.queue.add(track);
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle("Playlist Added")
          .setDescription(`Added **${res.tracks.length}** tracks from **${res.playlist?.name || "playlist"}** to the queue.`)],
      });
    } else {
      const track = res.tracks[0];
      player.queue.add(track);
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle("Added to Queue")
          .setDescription(`**[${track.info.title}](${track.info.uri})**`)
          .addFields(
            { name: "Author",   value: track.info.author || "Unknown", inline: true },
            { name: "Duration", value: track.info.isStream ? "🔴 LIVE" : formatDuration(track.info.duration), inline: true }
          )
          .setThumbnail(track.info.artworkUrl || "")],
      });
    }

    if (!player.playing && !player.paused) await player.play().catch(err => console.error("[Play] play() error:", err.message));
  },
};
