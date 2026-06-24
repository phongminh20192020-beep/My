const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

async function getSpotifyToken() {
  const res = await fetch("https://open.spotify.com/get_access_token?reason=transport&productType=web_player");
  const data = await res.json();
  return data.accessToken;
}

async function resolveSpotifyTrack(url) {
  const token = await getSpotifyToken();
  const headers = { Authorization: `Bearer ${token}` };
  const match = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
  if (!match) return null;
  const data = await fetch(`https://api.spotify.com/v1/tracks/${match[1]}`, { headers }).then(r => r.json());
  return `${data.artists?.[0]?.name || ""} ${data.name}`.trim();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("playnow")
    .setDescription("Immediately play a track, skipping the current one")
    .addStringOption((o) =>
      o.setName("query").setDescription("Song name, YouTube URL, or Spotify track URL").setRequired(true)
    ),

  async execute(interaction, client) {
    await interaction.deferReply();

    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel)
      return interaction.editReply("You must be in a voice channel.");

    const perms = voiceChannel.permissionsFor(interaction.guild.members.me);
    if (!perms.has("Connect") || !perms.has("Speak"))
      return interaction.editReply("I need permission to join and speak in your channel.");

    let player = client.lavalink.getPlayer(interaction.guildId);
    const isNew = !player;

    if (!player) {
      player = client.lavalink.createPlayer({
        guildId: interaction.guildId,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
        selfDeaf: true,
        selfMute: false,
      });
    }

    if (!player.connected) {
      await player.connect();
      if (isNew) await new Promise((r) => setTimeout(r, 1000));
    }

    let query = interaction.options.getString("query");
    const isSpotifyTrack = /spotify\.com\/track\//.test(query);
    const isUrl = /^https?:\/\//.test(query);

    // Spotify track → resolve to "artist name" for YTM search
    if (isSpotifyTrack) {
      try {
        const resolved = await resolveSpotifyTrack(query);
        if (!resolved) return interaction.editReply("❌ Couldn't resolve that Spotify track.");
        console.log(`[PlayNow] Spotify → YTM search: "${resolved}"`);
        query = resolved;
      } catch (err) {
        console.error("[PlayNow] Spotify resolve error:", err.message);
        return interaction.editReply("❌ Failed to fetch Spotify data. Try again later.");
      }
    }

    const searchPayload = isUrl && !isSpotifyTrack
      ? { query }
      : { query, source: "ytmsearch" };

    console.log(`[PlayNow] Searching: "${query}"`);
    const res = await player
      .search(searchPayload, interaction.user)
      .catch((err) => { console.error("[PlayNow] Search error:", err.message); return null; });

    if (!res?.tracks?.length || res.loadType === "empty" || res.loadType === "error")
      return interaction.editReply("❌ No results found.");

    const track = res.tracks[0];

    // Insert at front of queue and skip current track
    player.queue.tracks.unshift(track);

    if (player.playing || player.paused) {
      await player.skip(0, false).catch((err) =>
        console.error("[PlayNow] skip failed:", err.message)
      );
    } else {
      await player.play().catch((err) =>
        console.error("[PlayNow] play failed:", err.message)
      );
    }

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle("▶ Playing Now")
          .setDescription(`**[${track.info.title}](${track.info.uri})**`)
          .addFields(
            { name: "Author", value: track.info.author || "Unknown", inline: true },
            {
              name: "Duration",
              value: track.info.isStream ? "🔴 LIVE" : formatDuration(track.info.duration),
              inline: true,
            }
          )
          .setThumbnail(track.info.artworkUrl || ""),
      ],
    });
  },
};

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
