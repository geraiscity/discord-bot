import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { type MediaPromoInfo, type MediaPromoKind, mediaPromoCopy } from "./media-promo-utils.js";

/** Layout completo definido no código: o moderador só informa o link. */
export function buildMediaPromo(kind: MediaPromoKind, info: MediaPromoInfo) {
  const copy = mediaPromoCopy(kind, info.creatorName);
  const embed = new EmbedBuilder()
    .setColor(0xe53935)
    .setAuthor({ name: "GERAIS CITY RP  •  DIVULGAÇÕES" })
    .setTitle(copy.title)
    .setURL(info.url)
    .setDescription(copy.description)
    .addFields({ name: "📺 Onde assistir", value: info.platform, inline: true })
    .setFooter({ text: copy.footer })
    .setTimestamp();

  if (info.thumbnailUrl) embed.setImage(info.thumbnailUrl);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(copy.buttonLabel)
      .setURL(info.url),
  );
  return { embed, buttons };
}
