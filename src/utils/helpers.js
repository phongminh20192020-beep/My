"use strict";

/**
 * Format milliseconds into h:mm:ss or m:ss
 */
function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Build a playback progress bar string
 */
function progressBar(position, duration, length = 20) {
  const filled = Math.min(length, Math.round((position / duration) * length));
  return (
    "▬".repeat(Math.max(0, filled - 1)) +
    "🔘" +
    "▬".repeat(Math.max(0, length - filled))
  );
}

/**
 * Get a Spotify anonymous access token (same one the web player uses — no credentials needed)
 */
let _spotifyTokenCache = null;

async function getSpotifyToken() {
  // Reuse cached token if still valid
  if (_spotifyTokenCache && _spotifyTokenCache.expiresAt > Date.now() + 60_000) {
    return _spotifyTokenCache.token;
  }

  const res = await fetch(
    "https://open.spotify.com/get_access_token?reason=transport&productType=web_player",
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json",
      },
    }
  );

  if (!res.ok) throw new Error(`Spotify anonymous token failed (${res.status})`);

  const data = await res.json();
  if (!data.accessToken) throw new Error("Spotify returned no accessToken");

  _spotifyTokenCache = {
    token: data.accessToken,
    expiresAt: data.accessTokenExpirationTimestampMs || (Date.now() + 3_600_000),
  };

  return data.accessToken;
}

/**
 * Resolve a Spotify URL into a list of { query, title, artist } objects.
 * Supports track, playlist, and album URLs.
 */
async function resolveSpotify(url) {
  const token = await getSpotifyToken();
  const headers = { Authorization: `Bearer ${token}` };

  const trackMatch    = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
  const playlistMatch = url.match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
  const albumMatch    = url.match(/spotify\.com\/album\/([a-zA-Z0-9]+)/);

  if (trackMatch) {
    const res = await fetch(`https://api.spotify.com/v1/tracks/${trackMatch[1]}`, { headers });
    if (!res.ok) throw new Error(`Spotify track fetch failed (${res.status})`);
    const d = await res.json();
    const artist = d.artists?.[0]?.name ?? "";
    return {
      type: "track",
      name: d.name,
      tracks: [{ query: `${artist} ${d.name}`.trim(), title: d.name, artist }],
    };
  }

  if (playlistMatch) {
    const res = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistMatch[1]}?fields=name,tracks.items(track(name,artists))`,
      { headers }
    );
    if (!res.ok) throw new Error(`Spotify playlist fetch failed (${res.status})`);
    const d = await res.json();
    const tracks = (d.tracks?.items ?? [])
      .map((i) => i.track)
      .filter(Boolean)
      .map((t) => {
        const artist = t.artists?.[0]?.name ?? "";
        return { query: `${artist} ${t.name}`.trim(), title: t.name, artist };
      });
    return { type: "playlist", name: d.name, tracks };
  }

  if (albumMatch) {
    const res = await fetch(
      `https://api.spotify.com/v1/albums/${albumMatch[1]}?market=US`,
      { headers }
    );
    if (!res.ok) throw new Error(`Spotify album fetch failed (${res.status})`);
    const d = await res.json();
    const tracks = (d.tracks?.items ?? []).map((t) => {
      const artist = t.artists?.[0]?.name ?? "";
      return { query: `${artist} ${t.name}`.trim(), title: t.name, artist };
    });
    return { type: "album", name: d.name, tracks };
  }

  return null;
}

/**
 * Clear the voice channel status
 */
async function clearVoiceStatus(client, channelId) {
  if (!channelId) return;
  await client.rest
    .put(`/channels/${channelId}/voice-status`, { body: { status: "" } })
    .catch(() => {});
}

/**
 * Set the voice channel status
 */
async function setVoiceStatus(client, channelId, status) {
  if (!channelId) return;
  await client.rest
    .put(`/channels/${channelId}/voice-status`, { body: { status } })
    .catch(() => {});
}

module.exports = {
  formatDuration,
  progressBar,
  getSpotifyToken,
  resolveSpotify,
  clearVoiceStatus,
  setVoiceStatus,
};
