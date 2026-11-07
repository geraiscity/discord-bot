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
    .setAuthor({ name: "GERAIS CITY RP  •  CENTRAL DE ATENDIMENTO" })
    .setTitle(options.title || config.defaults.panelTitle)
    .setDescription(
      `${options.description || config.defaults.panelDescription}

Selecione a categoria que melhor corresponde à sua solicitação. Ao clicar em **ABRIR TICKET**, um menu privado será exibido para você escolher o tipo de atendimento.

Nossa equipe irá assumir seu chamado assim que possível. Evite abrir mais de um ticket para o mesmo assunto.`,
    )
    .addFields(
      { name: "🛠️ Suporte e Bugs", value: "Dúvidas gerais, ajuda e problemas técnicos no servidor.", inline: true },
      { name: "🚨 Denúncias", value: "Envie denúncias e informações para análise da equipe.", inline: true },
      { name: "🛒 Compras", value: "Atendimento sobre produtos, serviços e pagamentos.", inline: true },
      { name: "🤝 Parcerias", value: "Propostas e oportunidades de parceria.", inline: true },
    )
    .setColor(options.color)
    .setFooter({ text: "Gerais City RP • Atendimento oficial" });

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
