import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  type Guild,
} from "discord.js";
import { getRecentRobloxEvents, getRobloxBridgeStats, robloxBridgeConfigured } from "./roblox-bridge.js";
import { parseTicketTopic } from "./ticket-meta.js";

export type AdminSection = "home" | "roblox" | "logs" | "tickets" | "security";

export type SecurityPanelState = {
  enabled: boolean;
  mode: "alerta" | "proteger";
  safeMode: boolean;
  logChannelId: string | null;
  incidentCount: number;
  allowedBotCount: number;
  trustedAdminCount: number;
};

function navigation(active: AdminSection): ActionRowBuilder<ButtonBuilder>[] {
  const entries: Array<[AdminSection, string, string]> = [
    ["home", "Início", "🏠"],
    ["roblox", "Roblox", "🎮"],
    ["logs", "Logs", "📋"],
    ["tickets", "Tickets", "🎫"],
    ["security", "Segurança", "🛡️"],
  ];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      entries.map(([id, label, emoji]) =>
        new ButtonBuilder()
          .setCustomId(`admin_panel:${id}`)
          .setLabel(label)
          .setEmoji(emoji)
          .setStyle(id === active ? ButtonStyle.Primary : ButtonStyle.Secondary),
      ),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`admin_panel:${active}:refresh`).setLabel("Atualizar").setEmoji("🔄").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("admin_panel:close").setLabel("Fechar").setEmoji("✖️").setStyle(ButtonStyle.Danger),
    ),
  ];
}

function securityRows(state: SecurityPanelState): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("admin_security:status").setLabel("Status").setEmoji("📊").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("admin_security:toggle").setLabel(state.enabled ? "Desativar" : "Ativar").setEmoji(state.enabled ? "🔴" : "🟢").setStyle(state.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId("admin_security:mode").setLabel(state.mode === "proteger" ? "Modo: Proteger" : "Modo: Alertas").setEmoji("🛡️").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("admin_security:safe").setLabel(state.safeMode ? "Safe Mode: ON" : "Safe Mode: OFF").setEmoji("🟡").setStyle(state.safeMode ? ButtonStyle.Danger : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("admin_security:incidents").setLabel("Incidentes").setEmoji("🚨").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("admin_security:snapshot_create").setLabel("Criar backup").setEmoji("💾").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("admin_security:snapshot_preview").setLabel("Prévia backup").setEmoji("🔎").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("admin_security:release").setLabel("Liberar raid").setEmoji("🔓").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("admin_security:test").setLabel("Testar alerta").setEmoji("📣").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("admin_security:config").setLabel("Configurações").setEmoji("⚙️").setStyle(ButtonStyle.Primary),
    ),
  ];
}

function uptimeText(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}min`;
}

function ticketCounts(guild: Guild): { open: number; claimed: number; purchases: number } {
  let open = 0;
  let claimed = 0;
  let purchases = 0;
  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildText) continue;
    const meta = parseTicketTopic(channel.topic);
    if (!meta) continue;
    open += 1;
    if (meta.claimedBy) claimed += 1;
    if (meta.type === "compras") purchases += 1;
  }
  return { open, claimed, purchases };
}

export function buildAdminSecurityConfigPanel(guild: Guild, state: SecurityPanelState) {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: "GERAIS CITY • SECURITY CENTER" })
    .setTitle("⚙️ Configurações do Shield")
    .setDescription("As configurações que antes ficavam espalhadas em `/seguranca` agora ficam aqui dentro do Painel Admin.")
    .addFields(
      { name: "Canal de segurança", value: state.logChannelId ? `<#${state.logChannelId}>` : "Não configurado", inline: true },
      { name: "Bots permitidos", value: String(state.allowedBotCount), inline: true },
      { name: "Equipe confiável", value: String(state.trustedAdminCount), inline: true },
      { name: "Servidor", value: guild.name, inline: false },
    )
    .setTimestamp();

  const configRows = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("admin_security:bot_add").setLabel("Permitir bot").setEmoji("🤖").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("admin_security:bot_remove").setLabel("Remover bot").setEmoji("🗑️").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("admin_security:bot_list").setLabel("Listar bots").setEmoji("📋").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("admin_security:team_add").setLabel("Adicionar equipe").setEmoji("👤").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("admin_security:team_remove").setLabel("Remover equipe").setEmoji("➖").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("admin_security:team_list").setLabel("Listar equipe").setEmoji("👥").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("admin_security:log_channel").setLabel("Canal de logs").setEmoji("📋").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("admin_security:verification_publish").setLabel("Painel verificação").setEmoji("✅").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("admin_security:verification_status").setLabel("Status verificação").setEmoji("🔎").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("admin_security:verification_disable").setLabel("Desativar verificação").setEmoji("⛔").setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("admin_security:incident_detail").setLabel("Abrir incidente").setEmoji("🧾").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("admin_security:snapshot_restore").setLabel("Restaurar backup").setEmoji("♻️").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("admin_security:back").setLabel("Voltar à Segurança").setEmoji("⬅️").setStyle(ButtonStyle.Secondary),
    ),
  ];

  const nav = navigation("security");
  return { embeds: [embed], components: [nav[0], ...configRows, nav[1]] };
}

export async function buildAdminPanel(
  client: Client,
  guild: Guild,
  section: AdminSection = "home",
  securityState?: SecurityPanelState,
) {
  const bridge = getRobloxBridgeStats();
  const tickets = ticketCounts(guild);
  const persistence = process.env.DATABASE_URL?.trim() ? "PostgreSQL configurado" : "Armazenamento local/fallback";

  if (section === "roblox") {
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setAuthor({ name: "GERAIS CITY • CONTROL CENTER" })
      .setTitle("🎮 Roblox Bridge")
      .setDescription("Visão operacional da comunicação Roblox → Gerais Bot.")
      .addFields(
        { name: "Bridge", value: robloxBridgeConfigured() ? "🟢 Configurado" : "🔴 Sem ROBLOX_BRIDGE_SECRET", inline: true },
        { name: "Eventos recebidos", value: String(bridge.received), inline: true },
        { name: "Rejeitados", value: String(bridge.rejected), inline: true },
        { name: "Mortes registradas", value: String(bridge.deaths), inline: true },
        { name: "Alertas econômicos", value: String(bridge.economyAlerts), inline: true },
        { name: "Alertas de segurança", value: String(bridge.securityAlerts), inline: true },
        { name: "Último evento", value: bridge.lastEventAt ? `<t:${Math.floor(bridge.lastEventAt / 1000)}:R>` : "Nenhum desde que o bot ligou", inline: false },
      )
      .setFooter({ text: "Os detalhes completos ficam no banco; o Discord recebe os eventos relevantes." })
      .setTimestamp();
    return { embeds: [embed], components: navigation(section) };
  }

  if (section === "logs") {
    const recent = getRecentRobloxEvents(10);
    const lines = recent.length
      ? recent.map((event) => {
          const player = event.player?.username || event.player?.displayName || event.player?.userId || "sistema";
          return `\`${event.id}\` • **${event.category.toUpperCase()}** • ${event.event} • ${player} • ${event.severity}`;
        }).join("\n")
      : "Nenhum evento Roblox recebido desde que o bot ligou.";
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: "GERAIS CITY • LOG CENTER" })
      .setTitle("📋 Eventos recentes")
      .setDescription(lines.slice(0, 3900))
      .addFields(
        { name: "gerais-logs", value: process.env.GERAIS_LOG_CHANNEL_ID ? `<#${process.env.GERAIS_LOG_CHANNEL_ID}>` : "Não configurado", inline: true },
        { name: "security-alerts", value: process.env.SECURITY_ALERT_CHANNEL_ID ? `<#${process.env.SECURITY_ALERT_CHANNEL_ID}>` : process.env.SECURITY_LOG_CHANNEL_ID ? `<#${process.env.SECURITY_LOG_CHANNEL_ID}>` : "Não configurado", inline: true },
        { name: "transcripts", value: process.env.TRANSCRIPT_CHANNEL_ID ? `<#${process.env.TRANSCRIPT_CHANNEL_ID}>` : process.env.TICKET_LOG_CHANNEL_ID ? `<#${process.env.TICKET_LOG_CHANNEL_ID}>` : "Não configurado", inline: true },
      )
      .setTimestamp();
    return { embeds: [embed], components: navigation(section) };
  }

  if (section === "tickets") {
    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setAuthor({ name: "GERAIS CITY • CONTROL CENTER" })
      .setTitle("🎫 Tickets")
      .addFields(
        { name: "Abertos", value: String(tickets.open), inline: true },
        { name: "Assumidos", value: String(tickets.claimed), inline: true },
        { name: "Compras", value: String(tickets.purchases), inline: true },
        { name: "Transcripts", value: process.env.TRANSCRIPT_CHANNEL_ID ? `<#${process.env.TRANSCRIPT_CHANNEL_ID}>` : process.env.TICKET_LOG_CHANNEL_ID ? `<#${process.env.TICKET_LOG_CHANNEL_ID}>` : "Canal não configurado", inline: false },
      )
      .setDescription("Use `/painel-tickets` para publicar o painel visual. A categoria **Compras** já faz parte da central.")
      .setTimestamp();
    return { embeds: [embed], components: navigation(section) };
  }

  if (section === "security") {
    const state = securityState ?? {
      enabled: true,
      mode: "alerta" as const,
      safeMode: false,
      logChannelId: process.env.SECURITY_ALERT_CHANNEL_ID ?? null,
      incidentCount: 0,
      allowedBotCount: 0,
      trustedAdminCount: 0,
    };
    const embed = new EmbedBuilder()
      .setColor(state.enabled ? (state.safeMode ? 0xfee75c : 0x57f287) : 0x747f8d)
      .setAuthor({ name: "GERAIS CITY • SECURITY CENTER" })
      .setTitle("🛡️ Gerais Shield")
      .setDescription("Todos os controles principais de segurança ficam aqui. O slash command `/seguranca` foi removido para deixar a lista de comandos limpa.")
      .addFields(
        { name: "Estado", value: state.enabled ? "🟢 Ativo" : "🔴 Desativado", inline: true },
        { name: "Modo", value: state.mode === "proteger" ? "Proteção automática" : "Somente alertas", inline: true },
        { name: "Safe Mode", value: state.safeMode ? "🟡 Ativo" : "Desativado", inline: true },
        { name: "Incidentes", value: String(state.incidentCount), inline: true },
        { name: "Bots permitidos", value: String(state.allowedBotCount), inline: true },
        { name: "Equipe confiável", value: String(state.trustedAdminCount), inline: true },
        { name: "Canal de alertas", value: state.logChannelId ? `<#${state.logChannelId}>` : "Não configurado", inline: false },
      )
      .setFooter({ text: "Ações sensíveis continuam restritas ao proprietário configurado." })
      .setTimestamp();
    const nav = navigation(section);
    return { embeds: [embed], components: [nav[0], ...securityRows(state), nav[1]] };
  }

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setAuthor({ name: "GERAIS CITY • CONTROL CENTER" })
    .setTitle("⚙️ Painel Administrativo")
    .setDescription("Central privada do Discord + Roblox. Use os botões abaixo para navegar sem criar dezenas de comandos e canais.")
    .addFields(
      { name: "Gerais Bot", value: client.isReady() ? `🟢 Online • ${client.ws.ping}ms` : "🔴 Desconectado", inline: true },
      { name: "Uptime", value: uptimeText(Math.floor(process.uptime())), inline: true },
      { name: "Persistência", value: persistence, inline: true },
      { name: "Roblox Bridge", value: robloxBridgeConfigured() ? `🟢 ${bridge.received} eventos` : "🟡 Aguardando configuração", inline: true },
      { name: "Tickets abertos", value: String(tickets.open), inline: true },
      { name: "Alertas Roblox", value: String(bridge.securityAlerts + bridge.economyAlerts), inline: true },
    )
    .setFooter({ text: "Gerais City RP • Administração integrada" })
    .setTimestamp();
  return { embeds: [embed], components: navigation("home") };
}
