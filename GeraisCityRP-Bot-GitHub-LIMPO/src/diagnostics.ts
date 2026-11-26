import { ChannelType, EmbedBuilder, PermissionFlagsBits, type Client, type Guild } from "discord.js";
import { interactionMetrics } from "./diagnostics-core.js";
import { auditDeliveryStats } from "./discord-audit.js";
import { probeDatabase } from "./persistence.js";
import { getRobloxBridgeStats, robloxBridgeConfigured } from "./roblox-bridge.js";
import { securityEnvironment } from "./security.js";
import type { SecurityPanelState } from "./admin-panel.js";

export async function buildDiagnosticsEmbed(client: Client, guild: Guild, state?: SecurityPanelState): Promise<EmbedBuilder> {
  const database = await probeDatabase();
  const bot = guild.members.me;
  const required = [
    ["Ver auditoria", PermissionFlagsBits.ViewAuditLog],
    ["Gerenciar servidor", PermissionFlagsBits.ManageGuild],
    ["Gerenciar canais", PermissionFlagsBits.ManageChannels],
    ["Gerenciar cargos", PermissionFlagsBits.ManageRoles],
    ["Gerenciar mensagens", PermissionFlagsBits.ManageMessages],
    ["Moderar membros", PermissionFlagsBits.ModerateMembers],
    ["Expulsar membros", PermissionFlagsBits.KickMembers],
    ["Banir membros", PermissionFlagsBits.BanMembers],
    ["Gerenciar webhooks", PermissionFlagsBits.ManageWebhooks],
  ] as const;
  const missing = required.filter(([, flag]) => !bot?.permissions.has(flag)).map(([label]) => label);
  const ownerConfigured = /^\d{15,22}$/.test(securityEnvironment.ownerId);
  const target = !securityEnvironment.guildId || securityEnvironment.guildId === guild.id;
  const log = state?.logChannelId ? guild.channels.cache.get(state.logChannelId) : null;
  const logPerms = bot && log?.type === ChannelType.GuildText ? log.permissionsFor(bot) : null;
  const privateLog = log?.type === ChannelType.GuildText && !log.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel);
  const logOk = privateLog && logPerms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
  const bridge = getRobloxBridgeStats();
  const metrics = interactionMetrics.summary();
  const audit = auditDeliveryStats(guild.id);
  const aboveBot = bot ? guild.roles.cache.filter((role) => !role.managed && role.id !== guild.id && role.comparePositionTo(bot.roles.highest) >= 0).size : null;
  const databaseText = { local: "Arquivo local (PostgreSQL não configurado)", available: "PostgreSQL respondeu ao teste", unavailable: "PostgreSQL indisponível; confira a hospedagem", timeout: "PostgreSQL demorou mais de 3s" }[database];
  const shieldText = !ownerConfigured ? "Configure SECURITY_OWNER_ID" : !target ? "Servidor fora do escopo configurado" : !state?.enabled ? "Desativado" : state.safeMode ? "Safe Mode" : state.mode === "alerta" ? "Somente alertas" : "Proteção automática";
  const issue = missing.length > 0 || !logOk || !ownerConfigured || !target || database === "unavailable" || database === "timeout" || !client.isReady();
  return new EmbedBuilder()
    .setColor(issue ? 0xfee75c : 0x57f287)
    .setTitle("🩺 Diagnóstico do bot")
    .setDescription("Diagnóstico somente leitura. Nenhuma configuração ou permissão foi alterada.")
    .addFields(
      { name: "Discord", value: client.isReady() ? "Conectado • " + client.ws.ping + " ms Gateway" : "Desconectado", inline: true },
      { name: "Banco de dados", value: databaseText, inline: true },
      { name: "Shield", value: shieldText, inline: true },
      { name: "Permissões do bot", value: missing.length ? missing.join(", ") : "Nenhuma falta detectada", inline: false },
      { name: "Hierarquia", value: aboveBot === null ? "Não foi possível consultar o cargo do bot." : aboveBot + " cargo(s) não gerenciável(is) por posição. Se precisar gerenciá-los, ajuste a hierarquia.", inline: false },
      { name: "Canal de alertas", value: logOk ? "Privado para @everyone e permissões do bot detectadas" : "Confira o canal privado e as permissões Ver Canal, Enviar Mensagens e Incorporar Links. Cache pode estar incompleto.", inline: false },
      { name: "Confiança da autoria", value: state?.auditStats ? state.auditStats.confirmed + " confirmadas • " + state.auditStats.unconfirmed + " inconclusivas • " + state.auditStats.replayed + " repetidas ignoradas (desde inicialização)" : "Aguardando dados", inline: false },
      { name: "Auditoria Discord", value: audit.sent + " entregues • " + audit.failed + " falhas desde a inicialização. Sem envio ao PV. Confira os canais privados configurados em caso de falhas.", inline: false },
      { name: "Roblox Bridge", value: robloxBridgeConfigured() ? (bridge.lastEventAt ? "Último evento <t:" + Math.floor(bridge.lastEventAt / 1000) + ":R>" : "Configurado; nenhum evento recebido desde a inicialização") : "Não configurado", inline: false },
      { name: "Backup automático", value: securityEnvironment.autoSnapshots ? "Configurado (não confirma execução)" : "Desativado", inline: true },
      { name: "Memória do processo", value: Math.round(process.memoryUsage().rss / 1048576) + " MB RSS", inline: true },
      { name: "Interações desde a inicialização", value: metrics.completed + " concluídas • " + metrics.failures + " exceções capturadas", inline: false },
      { name: "Tempo total de processamento", value: metrics.sampleSize ? "Mediana: " + metrics.p50 + " ms • P95: " + metrics.p95 + " ms • últimas " + metrics.sampleSize : "Aguardando amostras", inline: false },
    )
    .setFooter({ text: "Permissões e hierarquia consultadas no cache; métricas não incluem a confirmação do cliente Discord." })
    .setTimestamp();
}
