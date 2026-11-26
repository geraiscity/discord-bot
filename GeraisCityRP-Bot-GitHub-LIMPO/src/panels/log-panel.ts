import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, type Guild } from "discord.js";
import { effectiveLogRoute, logRouteKinds, type LogRouteKind } from "../audit/audit-core.js";
import { getLogRoutes, validateLogChannel } from "../audit/log-routing.js";
export const routeLabels: Record<LogRouteKind,string> = {channel:"Canais",role:"Cargos",member:"Membros",server:"Servidor",general:"Auditoria geral",security:"Segurança",ticket_bugs:"Tickets • Bugs",ticket_suporte:"Tickets • Suporte",ticket_denuncias:"Tickets • Denúncias",ticket_compras:"Tickets • Compras",ticket_parcerias:"Tickets • Parcerias",roblox:"Roblox • Geral",roblox_security:"Roblox • Segurança"};
export async function buildLogRoutingPanel(guild: Guild, legacy: string | null, notice?: string) {
  const routes = await getLogRoutes(guild.id);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("📋 Central de destinos de logs")
    .setDescription((notice ? notice + "\n\n" : "") + "Escolha a categoria para configurar um canal privado. O bot nunca envia esses logs ao PV.")
    .addFields(logRouteKinds.map((kind) => {
      const id = effectiveLogRoute(kind, routes, process.env, legacy);
      return {name:routeLabels[kind],value:(id ? "<#" + id + ">" : "Não configurado") + (routes[kind] ? " • Personalizado" : " • Padrão"),inline:true};
    }))
    .setFooter({text:"Discord, tickets e Roblox • apenas proprietário"}).setTimestamp();
  const pick = (kind: LogRouteKind) => new ButtonBuilder().setCustomId("log_route_pick:" + kind).setLabel(routeLabels[kind]).setStyle(ButtonStyle.Secondary);
  return {embeds:[embed],components:[
    new ActionRowBuilder<ButtonBuilder>().addComponents(logRouteKinds.slice(0,4).map(pick)),
    new ActionRowBuilder<ButtonBuilder>().addComponents(pick("general"),pick("security"),pick("roblox"),pick("roblox_security")),
    new ActionRowBuilder<ButtonBuilder>().addComponents(logRouteKinds.slice(6,11).map(pick)),
    new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("log_route_check:all").setLabel("Verificar destinos").setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId("admin_panel:logs").setLabel("Voltar").setStyle(ButtonStyle.Primary)),
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

export async function buildLogRouteCheck(guild:Guild,legacy:string|null){const routes=await getLogRoutes(guild.id);const fields=await Promise.all(logRouteKinds.map(async kind=>{const id=effectiveLogRoute(kind,routes,process.env,legacy);if(!id)return {name:routeLabels[kind],value:"⚠️ Não configurado"};const invalid=await validateLogChannel(guild,id,kind.startsWith("ticket_"));return {name:routeLabels[kind],value:invalid?"⚠️ "+invalid+" (ID "+id+")":"✅ <#"+id+"> • permissões verificadas"};}));return {embeds:[new EmbedBuilder().setTitle("Diagnóstico de destinos").setDescription("Consulta real ao Discord. Privacidade avaliada para @everyone; revise também os cargos autorizados.").addFields(fields).setTimestamp()],components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("admin_panel:log_routes").setLabel("Voltar").setStyle(ButtonStyle.Primary))]};}
