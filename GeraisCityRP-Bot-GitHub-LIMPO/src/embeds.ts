import { EmbedBuilder } from "discord.js";
import { config } from "./config.js";

export function buildTicketPanelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setAuthor({ name: "SUPORTE GERAL GCRP" })
    .setTitle("Central de Atendimento / Suporte")
    .setDescription(
      [
        "Para que possamos te atender com agilidade, leia nossas diretrizes:",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "📌 **Diretrizes de Atendimento**",
        "• **Respeito e Cordialidade:** O respeito mútuo é obrigatório com a equipe e com os membros.",
        "• **Imparcialidade da Staff:** Analisaremos tudo com total imparcialidade, independentemente de quem estiver certo ou errado, ou de laços de amizade.",
        "• **Provas Concretas:** Denúncias exigem provas válidas (prints ou vídeos) apresentadas logo no início.",
        "• **Evite Pings Desnecessários:** Marcar a equipe repetidamente não acelera o processo e pode gerar punições.",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "> Aguarde pacientemente! Um membro da nossa equipe irá atendê-lo assim que possível.",
        "",
        "**Precisa de atendimento?** Clique no botão abaixo em **ABRIR TICKET** e escolha a categoria desejada.",
      ].join("\n"),
    )
    .setColor(0xed4245)
    .setFooter({ text: "GERAIS CITY RP • CENTRAL DE ATENDIMENTO" });
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
