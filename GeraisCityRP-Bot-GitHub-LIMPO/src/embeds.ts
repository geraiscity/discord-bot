import { EmbedBuilder } from "discord.js";
import { config } from "./config.js";

export function buildTicketPanelEmbed(options: {
  title?: string | null;
  description?: string | null;
  color: number;
  footerImage?: string | null;
  thumbnail?: string | null;
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(options.title || config.defaults.panelTitle)
    .setDescription(
      options.description || config.defaults.panelDescription,
    )
    .setColor(options.color)
    .setFooter({ text: "Atendimento da comunidade" });

  if (options.footerImage || config.defaults.footerImage) {
    embed.setImage(options.footerImage || config.defaults.footerImage!);
  }
  if (options.thumbnail) {
    embed.setThumbnail(options.thumbnail);
  }

  return embed;
}

export function buildRulesEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Regras do atendimento")
    .setDescription(config.rules.map((rule, index) => `${index + 1}. ${rule}`).join("\n"))
    .setColor(config.defaults.panelColor);
}

export function buildAnnouncementEmbed(options: {
  title: string;
  message: string;
  color: number;
  image?: string;
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(options.title)
    .setDescription(options.message)
    .setColor(options.color)
    .setTimestamp();

  if (options.image) {
    embed.setImage(options.image);
  }

  return embed;
}
