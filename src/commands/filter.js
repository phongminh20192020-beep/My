"use strict";

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("filter")
    .setDescription("Apply an audio filter or reset all filters")
    .addStringOption(o =>
      o.setName("preset")
        .setDescription("Filter preset to apply")
        .setRequired(true)
        .addChoices(
          { name: "Bass Boost",      value: "bassboost"   },
          { name: "Nightcore",       value: "nightcore"   },
          { name: "Vaporwave",       value: "vaporwave"   },
          { name: "Slowed + Reverb", value: "slowed"      },
          { name: "8D Audio",        value: "8d"          },
          { name: "Karaoke",         value: "karaoke"     },
          { name: "Pop",             value: "pop"         },
          { name: "Soft",            value: "soft"        },
          { name: "Treble Boost",    value: "trebleboost" },
          { name: "Off (Reset)",     value: "off"         },
        )
    ),

  async execute(interaction, client) {
    await interaction.deferReply();

    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player || !player.queue.current)
      return interaction.editReply("Nothing is currently playing.");

    const fm     = player.filterManager;
    const preset = interaction.options.getString("preset");

    try {
      await fm.resetFilters();

      switch (preset) {
        case "bassboost":
          await fm.setEqualizer([
            { band: 0, gain: 0.3  }, { band: 1, gain: 0.25 }, { band: 2, gain: 0.20 },
            { band: 3, gain: 0.10 }, { band: 4, gain: 0.05 }, { band: 5, gain: 0.0  },
            { band: 6, gain: 0.0  }, { band: 7, gain: 0.0  }, { band: 8, gain: 0.0  },
            { band: 9, gain: 0.0  }, { band: 10, gain: 0.0 }, { band: 11, gain: 0.0 },
            { band: 12, gain: 0.0 }, { band: 13, gain: 0.0 }, { band: 14, gain: 0.0 },
          ]);
          break;
        case "nightcore":
          await fm.setTimescale({ speed: 1.3, pitch: 1.3, rate: 1.0 });
          break;
        case "vaporwave":
          await fm.setTimescale({ speed: 0.85, pitch: 0.85, rate: 1.0 });
          await fm.setEqualizer([
            { band: 0, gain: 0.3 }, { band: 1, gain: 0.3 },
            { band: 13, gain: 0.3 }, { band: 14, gain: 0.3 },
          ]);
          break;
        case "slowed":
          await fm.setTimescale({ speed: 0.80, pitch: 0.90, rate: 1.0 });
          break;
        case "8d":
          await fm.setRotation({ rotationHz: 0.2 });
          break;
        case "karaoke":
          await fm.setKaraoke({ level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 });
          break;
        case "pop":
          await fm.setEqualizer([
            { band: 0,  gain: -0.05 }, { band: 1,  gain:  0.05 }, { band: 2,  gain:  0.10 },
            { band: 3,  gain:  0.15 }, { band: 4,  gain:  0.10 }, { band: 5,  gain:  0.05 },
            { band: 6,  gain:  0.0  }, { band: 7,  gain:  0.0  }, { band: 8,  gain:  0.05 },
            { band: 9,  gain:  0.05 }, { band: 10, gain:  0.10 }, { band: 11, gain:  0.10 },
            { band: 12, gain:  0.05 }, { band: 13, gain: -0.05 }, { band: 14, gain: -0.05 },
          ]);
          break;
        case "soft":
          await fm.setEqualizer([
            { band: 0,  gain:  0.0  }, { band: 1,  gain:  0.0  }, { band: 2,  gain:  0.0  },
            { band: 3,  gain:  0.0  }, { band: 4,  gain:  0.0  }, { band: 5,  gain:  0.0  },
            { band: 6,  gain:  0.0  }, { band: 7,  gain:  0.0  }, { band: 8,  gain: -0.05 },
            { band: 9,  gain: -0.10 }, { band: 10, gain: -0.15 }, { band: 11, gain: -0.15 },
            { band: 12, gain: -0.15 }, { band: 13, gain: -0.15 }, { band: 14, gain: -0.15 },
          ]);
          break;
        case "trebleboost":
          await fm.setEqualizer([
            { band: 0,  gain: 0.0  }, { band: 1,  gain: 0.0  }, { band: 2,  gain: 0.0  },
            { band: 3,  gain: 0.0  }, { band: 4,  gain: 0.0  }, { band: 5,  gain: 0.0  },
            { band: 6,  gain: 0.0  }, { band: 7,  gain: 0.0  }, { band: 8,  gain: 0.10 },
            { band: 9,  gain: 0.15 }, { band: 10, gain: 0.20 }, { band: 11, gain: 0.25 },
            { band: 12, gain: 0.30 }, { band: 13, gain: 0.25 }, { band: 14, gain: 0.20 },
          ]);
          break;
        case "off":
          return interaction.editReply("✖ All filters have been **reset**.");
      }
    } catch (err) {
      console.error("[Filter] filterManager error:", err.message);
      return interaction.editReply("❌ Failed to apply filter. Your Lavalink node may not support this.");
    }

    const labels = {
      bassboost: "🔊 Bass Boost", nightcore: "🌙 Nightcore", vaporwave: "🌊 Vaporwave",
      slowed: "🐢 Slowed + Reverb", "8d": "🎧 8D Audio", karaoke: "🎤 Karaoke",
      pop: "🎵 Pop", soft: "🎶 Soft", trebleboost: "✨ Treble Boost",
    };

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle("Filter Applied")
          .setDescription(`**${labels[preset]}** is now active.`)
          .setFooter({ text: 'Use "/filter Off (Reset)" to remove all filters.' }),
      ],
    });
  },
};
