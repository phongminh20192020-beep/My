const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

// Uses your real Spotify API credentials (from env vars) instead of the
// unreliable public token endpoint that returns HTML errors when rate-limited.
async function getSpotifyToken() {
  const creds = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function resolveSpotify(url) {
  const token = await getSpotifyToken();
  const headers = { Authorization: `Bearer ${token}` };

  const trackMatch = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
  const playlistMatch = url.match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
  const albumMatch = url.match(/spotify\.com\/album\/([a-zA-Z0-9]+)/);

  if (trackMatch) {
    const res = await fetch(`https://api.spotify.com/v1/tracks/${trackMatch[1]}`, { headers });
    if (!res.ok) throw new Error(`Spotify track fetch failed: ${res.status}`);
    const data = await res.json();
    const name = data.name;
    const artist = data.artists?.[0]?.name || "";
    return { type: "track", tracks: [{ query: `${artist} ${name}`, title: name, artist }] };
  }

  if (playlistMatch) {
    const res = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistMatch[1]}?fields=name,tracks.items(track(name,artists))`,
      { headers }
    );
    if (!res.ok) throw new Error(`Spotify playlist fetch failed: ${res.status}`);
    const data = await res.json();
    const tracks = (data.tracks?.items || [])
      .map((i) => i.track)
      .filter(Boolean)
      .map((t) => ({
        query: `${t.artists?.[0]?.name || ""} ${t.name}`,
        title: t.name,
        artist: t.artists?.[0]?.name || "",
      }));
    return { type: "playlist", name: data.name, tracks };
  }

  if (albumMatch) {
    const res = await fetch(
      `https://api.spotify.com/v1/albums/${albumMatch[1]}?market=US`,
      { headers }
    );
    if (!res.ok) throw new Error(`Spotify album fetch failed: ${res.status}`);
    const data = await res.json();
    const tracks = (data.tracks?.items || []).map((t) => ({
      query: `${t.artists?.[0]?.name || ""} ${t.name}`,
      title: t.name,
      artist: t.artists?.[0]?.name || "",
    }));
    return { type: "playlist", name: data.name, tracks };
  }

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Search or play a track / Spotify link / playlist")
    .addStringOption((o) =>
      o.setName("query").setDescription("Song name, YouTube URL, or Spotify URL").setRequired(true)
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
      console.log(`[Play] Connected to voice for guild ${interaction.guildId} (new=${isNew})`);
      if (isNew) await new Promise((r) => setTimeout(r, 1000));
    }

    const query = interaction.options.getString("query");
    const isSpotify = /spotify\.com\/(track|playlist|album)\//.test(query);
    const isUrl = /^https?:\/\//.test(query);

    // ── Spotify: resolve metadata → search YTM for each track ────────────────
    if (isSpotify) {
      if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
        return interaction.editReply("❌ Spotify credentials are not configured. Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in your environment.");
      }

      let spotifyData;
      try {
        spotifyData = await resolveSpotify(query);
      } catch (err) {
        console.error("[Play] Spotify resolve error:", err.message);
        return interaction.editReply("❌ Failed to fetch Spotify data. Try again later.");
      }

      if (!spotifyData || !spotifyData.tracks.length)
        return interaction.editReply("❌ No tracks found in that Spotify link.");

      if (spotifyData.type === "track") {
        const { query: ytmQuery, title, artist } = spotifyData.tracks[0];
        console.log(`[Play] Spotify track → YTM search: "${ytmQuery}"`);
        const res = await player.search({ query: ytmQuery, source: "ytmsearch" }, interaction.user).catch(() => null);
        if (!res?.tracks?.length) return interaction.editReply(`❌ Couldn't find **${title}** on YouTube Music.`);
        const track = res.tracks[0];
        player.queue.add(track);
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x1db954)
              .setTitle("Added to Queue (via Spotify)")
              .setDescription(`**[${track.info.title}](${track.info.uri})**`)
              .addFields(
                { name: "Author", value: track.info.author || artist || "Unknown", inline: true },
                { name: "Duration", value: track.info.isStream ? "🔴 LIVE" : formatDuration(track.info.duration), inline: true }
              )
              .setThumbnail(track.info.artworkUrl || ""),
          ],
        });
      } else {
        const { name, tracks } = spotifyData;
        console.log(`[Play] Spotify ${spotifyData.type} "${name}" → queuing ${tracks.length} tracks via YTM`);

        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x1db954)
              .setTitle("Loading Spotify Playlist...")
              .setDescription(`Found **${tracks.length}** tracks in **${name}**. Adding to queue...`),
          ],
        });

        let added = 0;
        for (const { query: ytmQuery } of tracks) {
          try {
            const res = await player.search({ query: ytmQuery, source: "ytmsearch" }, interaction.user);
            if (res?.tracks?.[0]) {
              player.queue.add(res.tracks[0]);
              added++;
              if (added === 1 && !player.playing && !player.paused) {
                await player.play().catch(() => {});
              }
            }
          } catch { /* skip failed tracks */ }
        }

        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x1db954)
              .setTitle("Playlist Added")
              .setDescription(`Added **${added}/${tracks.length}** tracks from **${name}** to the queue.`),
          ],
        });
        return;
      }

      if (!player.playing && !player.paused) {
        await player.play().catch((err) => console.error(`[Play] player.play() error:`, err.message));
      }
      return;
    }

    // ── Normal search / YouTube URL ───────────────────────────────────────────
    console.log(`[Play] Searching: "${query}" isUrl=${isUrl}`);
    const res = await player
      .search(isUrl ? { query } : { query, source: "ytmsearch" }, interaction.user)
      .catch((err) => { console.error(`[Play] Search error:`, err.message); return null; });

    console.log(`[Play] Search result: loadType=${res?.loadType}, tracks=${res?.tracks?.length}`);

    if (!res || res.loadType === "empty" || res.loadType === "error")
      return interaction.editReply(`❌ No results found for \`${query}\`.`);

    if (res.loadType === "playlist") {
      for (const track of res.tracks) player.queue.add(track);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle("Playlist Added")
            .setDescription(`Added **${res.tracks.length}** tracks from **${res.playlist?.name || "playlist"}** to the queue.`),
        ],
      });
    } else {
      const track = res.tracks[0];
      player.queue.add(track);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle("Added to Queue")
            .setDescription(`**[${track.info.title}](${track.info.uri})**`)
            .addFields(
              { name: "Author", value: track.info.author || "Unknown", inline: true },
              { name: "Duration", value: track.info.isStream ? "🔴 LIVE" : formatDuration(track.info.duration), inline: true }
            )
            .setThumbnail(track.info.artworkUrl || ""),
        ],
      });
    }

    if (!player.playing && !player.paused) {
      console.log(`[Play] Starting playback for guild ${interaction.guildId}`);
      await player.play().catch((err) => console.error(`[Play] player.play() error:`, err.message));
    }
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
