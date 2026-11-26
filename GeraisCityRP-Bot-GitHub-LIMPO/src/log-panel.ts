import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, type Guild } from "discord.js";
import { effectiveLogRoute, logRouteKinds, type LogRouteKind } from "./audit-core.js";
import { getLogRoutes } from "./log-routing.js";
export const routeLabels: Record<LogRouteKind,string> = {channel:"Canais",role:"Cargos",member:"Membros",server:"Servidor",general:"Auditoria geral",security:"Segurança"};
export async function buildLogRoutingPanel(guild: Guild, legacy: string | null, notice?: string) {
  const routes = await getLogRoutes(guild.id);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("📋 Central de destinos de logs")
    .setDescription((notice ? notice + "\n\n" : "") + "Escolha a categoria para configurar um canal privado. O bot nunca envia esses logs ao PV.")
    .addFields(logRouteKinds.map((kind) => {
      const id = effectiveLogRoute(kind, routes, process.env, legacy);
      return {name:routeLabels[kind],value:(id ? "<#" + id + ">" : "Não configurado") + (routes[kind] ? " • Personalizado" : " • Padrão"),inline:true};
    }))
    .setFooter({text:"Auditoria administrativa e alertas do Shield • apenas proprietário"}).setTimestamp();
  const pick = (kind: LogRouteKind) => new ButtonBuilder().setCustomId("log_route_pick:" + kind).setLabel(routeLabels[kind]).setStyle(ButtonStyle.Secondary);
  return {embeds:[embed],components:[
    new ActionRowBuilder<ButtonBuilder>().addComponents(logRouteKinds.slice(0,4).map(pick)),
    new ActionRowBuilder<ButtonBuilder>().addComponents(pick("general"),pick("security"),new ButtonBuilder().setCustomId("admin_panel:logs").setLabel("Voltar").setStyle(ButtonStyle.Primary)),
  ]};
}
export async function buildLogRoutePicker(guild: Guild, legacy: string | null, kind: LogRouteKind, notice?: string) {
  const routes = await getLogRoutes(guild.id);
  const id = effectiveLogRoute(kind, routes, process.env, legacy);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("Configurar logs • " + routeLabels[kind])
    .setDescription((notice ? notice + "\n\n" : "") + "Destino atual: " + (id ? "<#" + id + ">" : "Não configurado") + "\nSelecione um canal de texto privado neste servidor. Usar padrão remove apenas a escolha do painel, preservando as configurações anteriores.");
  const selector = new ChannelSelectMenuBuilder().setCustomId("log_route_select:" + kind).setPlaceholder("Selecione o canal de logs").setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1);
  return {embeds:[embed],components:[
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(selector),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("log_route_reset:" + kind).setLabel("Usar padrão").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("admin_panel:log_routes").setLabel("Voltar").setStyle(ButtonStyle.Primary),
    ),
  ]};
}
