"use strict";

const { Client, GatewayIntentBits, Collection, EmbedBuilder } = require("discord.js");
const { LavalinkManager } = require("lavalink-client");
const fs   = require("fs");
const path = require("path");
const { formatDuration, progressBar, resolveSpotify, setVoiceStatus, clearVoiceStatus } = require("./utils/helpers");

// ─── Discord client ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

client.commands      = new Collection();
client.npIntervals   = new Map();
client.errorCounts   = new Map();
client.retriedTracks = new Map();

// ─── Load commands ────────────────────────────────────────────────────────────
for (const file of fs.readdirSync(path.join(__dirname, "commands")).filter(f => f.endsWith(".js"))) {
  const cmd = require(path.join(__dirname, "commands", file));
  if (cmd.data && cmd.execute) client.commands.set(cmd.data.name, cmd);
}

// ─── Lavalink ─────────────────────────────────────────────────────────────────
client.lavalink = new LavalinkManager({
  nodes: [
    {
      id:                     "main",
      host:                   process.env.LAVALINK_HOST || "lavalink",
      port:                   parseInt(process.env.LAVALINK_PORT || "8080"),
      authorization:          process.env.LAVALINK_PASS || "Minh@2013",
      secure:                 false,
      retryAmount:            20,
      retryDelay:             2500,
      requestSignalTimeoutMS: 30000,
      heartBeatInterval:      30000,
      enablePingOnStatsCheck: true,
    },
  ],
  sendToShard: (guildId, payload) => {
    const guild = client.guilds.cache.get(guildId);
    if (guild) guild.shard.send(payload);
  },
  client: {
    id:       process.env.CLIENT_ID,
    username: "MusicBot",
  },
  playerOptions: {
    defaultSearchPlatform:             "ytmsearch",
    onDisconnect:                      { autoReconnect: true, destroyPlayer: false },
    onEmptyQueue:                      { destroyAfterMs: 30_000 },
    applyVolumeAsFilter:               false,
    clientBasedPositionUpdateInterval: 100,
  },
  queueOptions:    { maxPreviousTracks: 10 },
  advancedOptions: {
    enableDebugEvents:    true,
    maxFilterFixDuration: 600,
    debugOptions:         { noAudio: { toggleSleepOnInactivity: false } },
  },
});

// ─── Push YouTube OAuth token to node via REST ────────────────────────────────
async function pushYouTubeOAuth(node) {
  const token = process.env.YOUTUBE_REFRESH_TOKEN;
  if (!token) {
    console.warn(`[Lavalink] YOUTUBE_REFRESH_TOKEN not set — YouTube may fail with login errors.`);
    return;
  }
  try {
    const protocol = node.options.secure ? "https" : "http";
    const base     = `${protocol}://${node.options.host}:${node.options.port}`;

    const res = await fetch(`${base}/youtube/token`, {
      method:  "POST",
      headers: {
        "Authorization": node.options.authorization,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({ refreshToken: token }),
    });

    if (res.ok) {
      console.log(`[Lavalink] YouTube OAuth token pushed to node "${node.id}" ✅`);
    } else {
      const text = await res.text();
      console.error(`[Lavalink] Failed to push YouTube OAuth token: ${res.status} ${text}`);
    }
  } catch (err) {
    console.error(`[Lavalink] Failed to push YouTube OAuth token:`, err.message);
  }
}

// ─── Lavalink node events ─────────────────────────────────────────────────────
client.lavalink.nodeManager
  .on("connect", async (node) => {
    console.log(`[Lavalink] Node "${node.id}" connected ✅`);
    await pushYouTubeOAuth(node);
  })
  .on("error",        (node, err)    => console.error(`[Lavalink] Node "${node.id}" error:`, err.message))
  .on("disconnect",   (node, reason) => console.warn(`[Lavalink] Node "${node.id}" disconnected:`, JSON.stringify(reason)))
  .on("reconnecting", (node)         => console.log(`[Lavalink] Node "${node.id}" reconnecting...`));

// ─── Now-playing embed ────────────────────────────────────────────────────────
function buildNowPlayingEmbed(player, track) {
  const pos = player.position;
  const dur = track.info.duration;
  const bar = track.info.isStream ? "🔴 LIVE" : progressBar(pos, dur);

  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle("Now Playing")
    .setDescription(`**[${track.info.title}](${track.info.uri})**`)
    .addFields(
      { name: "Author",       value: track.info.author || "Unknown",                                                       inline: true },
      { name: "Duration",     value: track.info.isStream ? "🔴 LIVE" : `${formatDuration(pos)} / ${formatDuration(dur)}`, inline: true },
      { name: "Requested By", value: track.requester?.username || "Unknown",                                               inline: true },
      { name: "Progress",     value: bar }
    )
    .setThumbnail(track.info.artworkUrl || "");
}

function clearNpInterval(guildId) {
  const iv = client.npIntervals.get(guildId);
  if (iv) { clearInterval(iv); client.npIntervals.delete(guildId); }
}

// ─── Autoplay ─────────────────────────────────────────────────────────────────
async function handleAutoplay(player, lastTrack) {
  try {
    const id        = lastTrack.info.identifier;
    const requester = lastTrack.requester || client.user;
    console.log(`[Autoplay] Seeding from: "${lastTrack.info.title}"`);

    const res = await player.search(
      { query: `https://www.youtube.com/watch?v=${id}&list=RD${id}`, source: "youtube" },
      requester
    );
    if (!res?.tracks?.length) { console.warn("[Autoplay] No related tracks found."); return; }

    const played = new Set((player.queue.previous || []).map(t => t.info.identifier));
    const next   = res.tracks.filter(t => t.info.identifier !== id && !played.has(t.info.identifier));
    if (!next.length) { console.warn("[Autoplay] Only duplicates returned — skipping."); return; }

    await player.queue.add(next.slice(0, 5));
    if (!player.playing) await player.play();
  } catch (err) {
    console.error("[Autoplay] Error:", err.message);
  }
}

// ─── Track error retry helper ─────────────────────────────────────────────────
async function searchReplacement(player, failedTrack, sources) {
  const query          = `${failedTrack.info.title} ${failedTrack.info.author || ""}`.trim();
  const targetDuration = failedTrack.info.duration || 0;

  for (const source of sources) {
    try {
      const res = await player.search({ query, source }, failedTrack.requester);
      if (!res?.tracks?.length) continue;
      return (
        res.tracks.find(t => Math.abs((t.info.duration || 0) - targetDuration) < 5000) ||
        res.tracks[0]
      );
    } catch (err) {
      console.error(`[Lavalink] Replacement search failed on ${source}:`, err.message);
    }
  }
  return null;
}

// ─── Lavalink player events ───────────────────────────────────────────────────
client.lavalink

  .on("trackStart", async (player, track) => {
    console.log(`[Lavalink] trackStart: "${track.info.title}" guild=${player.guildId}`);
    clearNpInterval(player.guildId);
    client.errorCounts.set(player.guildId, 0);
    client.retriedTracks.delete(player.guildId);

    await setVoiceStatus(client, player.voiceChannelId, `🎵 ${track.info.title}`);

    const channel = client.channels.cache.get(player.textChannelId);
    if (!channel) return;

    let npMsg;
    try { npMsg = await channel.send({ embeds: [buildNowPlayingEmbed(player, track)] }); }
    catch { return; }

    if (!track.info.isStream) {
      const iv = setInterval(async () => {
        const p = client.lavalink.getPlayer(player.guildId);
        if (!p?.queue.current || p.paused) return;
        try { await npMsg.edit({ embeds: [buildNowPlayingEmbed(p, p.queue.current)] }); }
        catch { clearNpInterval(player.guildId); }
      }, 10_000);
      client.npIntervals.set(player.guildId, iv);
    }
  })

  .on("trackEnd", (player) => {
    clearNpInterval(player.guildId);
  })

  .on("trackError", async (player, track, payload) => {
    const guildId = player.guildId;
    const reason  = payload?.exception?.message || payload?.exception?.cause || "Unknown error";
    console.error(`[Lavalink] trackError guild=${guildId}:`, reason);
    clearNpInterval(guildId);

    const channel      = client.channels.cache.get(player.textChannelId);
    const isLoginError = /sign in|login|requires login|bot|cookie|403/i.test(reason);

    const failCount = (client.errorCounts.get(guildId) || 0) + 1;
    client.errorCounts.set(guildId, failCount);
    if (failCount >= 5) {
      client.errorCounts.set(guildId, 0);
      channel?.send("⚠️ Too many tracks failed in a row. Stopping playback.").catch(() => {});
      await player.stopPlaying(true).catch(() => {});
      return;
    }

    const trackKey   = track?.info?.identifier || track?.encoded;
    let   retriedSet = client.retriedTracks.get(guildId);
    if (!retriedSet) { retriedSet = new Set(); client.retriedTracks.set(guildId, retriedSet); }

    if (track && trackKey && !retriedSet.has(trackKey)) {
      retriedSet.add(trackKey);

      if (isLoginError) {
        console.log(`[Lavalink] Login error — retrying "${track.info.title}" with fallback source`);
        channel?.send(`⚠️ **${track.info.title}** is age/login restricted — trying another source...`).catch(() => {});
      }

      const sources     = isLoginError ? ["ytsearch", "ytmsearch"] : ["ytmsearch", "ytsearch"];
      const replacement = await searchReplacement(player, track, sources);

      if (replacement) {
        console.log(`[Lavalink] Replacement found via ${replacement.info.sourceName}`);
        player.queue.tracks.unshift(replacement);
        await player.skip(0, false).catch(err => console.error("[Lavalink] skip-to-retry failed:", err.message));
        return;
      }
    }

    channel?.send(`⚠️ Couldn't play **${track?.info?.title || "that track"}** — skipping.`).catch(() => {});
    await player.skip(0, false).catch(err => {
      console.error("[Lavalink] skip-after-error failed:", err.message);
      player.stopPlaying(true).catch(() => {});
    });
  })

  .on("trackStuck", (player, track) => {
    console.warn(`[Lavalink] Track stuck guild=${player.guildId}: "${track?.info?.title}"`);
    clearNpInterval(player.guildId);
    client.channels.cache.get(player.textChannelId)
      ?.send(`⚠️ **${track?.info?.title || "Track"}** got stuck and was skipped.`).catch(() => {});
  })

  .on("playerSocketClosed", (player, payload) => {
    console.warn(`[Lavalink] Player socket closed guild=${player.guildId}:`, payload);
  })

  .on("queueEnd", async (player) => {
    clearNpInterval(player.guildId);
    await clearVoiceStatus(client, player.voiceChannelId);

    if (player.get("autoplay")) {
      const seed = player.queue.previous[0];
      console.log(`[Autoplay] queueEnd — seed: "${seed?.info?.title || "NONE"}"`);
      if (seed) { handleAutoplay(player, seed); return; }
      console.warn("[Autoplay] No previous track to seed from.");
    }

    client.channels.cache.get(player.textChannelId)
      ?.send("Queue finished. Use `/play` to add more tracks.").catch(() => {});
  });

// ─── Load events ──────────────────────────────────────────────────────────────
for (const file of fs.readdirSync(path.join(__dirname, "events")).filter(f => f.endsWith(".js"))) {
  const event = require(path.join(__dirname, "events", file));
  if (event.once) client.once(event.name, (...args) => event.execute(...args, client));
  else            client.on(  event.name, (...args) => event.execute(...args, client));
}

// ─── Forward voice updates to Lavalink ───────────────────────────────────────
client.on("raw", d => {
  if (["VOICE_STATE_UPDATE", "VOICE_SERVER_UPDATE"].includes(d.t)) {
    if (d.d && !d.d.guild_id && d.d.member?.guild_id)
      d.d.guild_id = d.d.member.guild_id;
    console.log(`[Voice] ${d.t} guild=${d.d?.guild_id ?? "UNKNOWN"}`);
  }
  client.lavalink.sendRawData(d);
});

// ─── Slash command handler ────────────────────────────────────────────────────
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction, client);
  } catch (err) {
    console.error(`[Command/${interaction.commandName}]`, err);
    const payload = { content: "An error occurred.", ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

// ─── Process-level error guards ───────────────────────────────────────────────
process.on("unhandledRejection",       reason => console.error("[Process] Unhandled Rejection:", reason));
process.on("uncaughtException",        err    => console.error("[Process] Uncaught Exception:", err));
process.on("uncaughtExceptionMonitor", err    => console.error("[Process] Uncaught Exception Monitor:", err));

client.login(process.env.DISCORD_TOKEN);
