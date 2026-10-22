import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request } from "express";
import {
  ChannelType,
  Client,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type TextChannel,
} from "discord.js";
import { recordRobloxEvent } from "./persistence.js";

export type RobloxLogSeverity = "info" | "warning" | "suspicious" | "critical";
export type RobloxLogCategory =
  | "player"
  | "economy"
  | "combat"
  | "inventory"
  | "vehicle"
  | "staff"
  | "security"
  | "system";

export interface RobloxBridgeEvent {
  id: string;
  receivedAt: number;
  event: string;
  category: RobloxLogCategory;
  severity: RobloxLogSeverity;
  player?: {
    userId?: string;
    username?: string;
    displayName?: string;
  };
  server?: {
    jobId?: string;
    placeId?: string;
    name?: string;
  };
  data: Record<string, unknown>;
}

interface BridgeStats {
  received: number;
  rejected: number;
  deaths: number;
  economyAlerts: number;
  securityAlerts: number;
  lastEventAt: number | null;
  lastServerJobId: string | null;
}

const stats: BridgeStats = {
  received: 0,
  rejected: 0,
  deaths: 0,
  economyAlerts: 0,
  securityAlerts: 0,
  lastEventAt: null,
  lastServerJobId: null,
};

const recentEvents: RobloxBridgeEvent[] = [];
const dedupe = new Map<string, number>();
const serverRate = new Map<string, { startedAt: number; count: number }>();

const CATEGORY_COLOR: Record<RobloxLogCategory, number> = {
  player: 0x5865f2,
  economy: 0x57f287,
  combat: 0xed4245,
  inventory: 0xfee75c,
  vehicle: 0x3498db,
  staff: 0x9b59b6,
  security: 0xed4245,
  system: 0x747f8d,
};

const CATEGORY_LABEL: Record<RobloxLogCategory, string> = {
  player: "👤 PLAYER",
  economy: "💰 ECONOMIA",
  combat: "☠️ COMBATE",
  inventory: "🎒 INVENTÁRIO",
  vehicle: "🚗 VEÍCULO",
  staff: "👮 STAFF",
  security: "🚨 SEGURANÇA",
  system: "⚙️ SISTEMA",
};

function numberEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeString(value: unknown, max = 300): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  return text ? text.slice(0, max) : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function safeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function severityRank(value: RobloxLogSeverity): number {
  return { info: 0, warning: 1, suspicious: 2, critical: 3 }[value];
}

function normalizeSeverity(value: unknown): RobloxLogSeverity {
  return value === "warning" || value === "suspicious" || value === "critical" ? value : "info";
}

function categoryForEvent(event: string): RobloxLogCategory {
  if (event.startsWith("economy.")) return "economy";
  if (event.startsWith("combat.") || event === "player.death") return "combat";
  if (event.startsWith("inventory.")) return "inventory";
  if (event.startsWith("vehicle.")) return "vehicle";
  if (event.startsWith("staff.")) return "staff";
  if (event.startsWith("security.")) return "security";
  if (event.startsWith("system.")) return "system";
  return "player";
}

function deriveSeverity(event: string, requested: RobloxLogSeverity, data: Record<string, unknown>): RobloxLogSeverity {
  if (event === "security.exploit") return "critical";
  if (event.startsWith("security.") && severityRank(requested) < severityRank("suspicious")) return "suspicious";
  if (event === "system.error" && requested === "info") return "warning";
  if (!event.startsWith("economy.")) return requested;

  const amount = Math.abs(
    normalizeNumber(data.delta) ??
    normalizeNumber(data.amount) ??
    0,
  );
  const warning = numberEnv("ROBLOX_MONEY_WARNING", 100_000);
  const suspicious = numberEnv("ROBLOX_MONEY_SUSPICIOUS", 500_000);
  const critical = numberEnv("ROBLOX_MONEY_CRITICAL", 1_000_000);
  if (amount >= critical) return "critical";
  if (amount >= suspicious) return "suspicious";
  if (amount >= warning && requested === "info") return "warning";
  return requested;
}

function makeId(): string {
  return `RBX-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(req: Request): boolean {
  const expected = process.env.ROBLOX_BRIDGE_SECRET?.trim();
  if (!expected) return false;
  const supplied = String(req.header("x-gerais-bridge-key") ?? "").trim();
  return Boolean(supplied) && constantTimeEqual(supplied, expected);
}

function allowRate(serverKey: string): boolean {
  const now = Date.now();
  const max = numberEnv("ROBLOX_BRIDGE_MAX_EVENTS_PER_MINUTE", 180);
  const current = serverRate.get(serverKey);
  if (!current || now - current.startedAt >= 60_000) {
    serverRate.set(serverKey, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= max;
}

function remember(event: RobloxBridgeEvent): void {
  recentEvents.unshift(event);
  if (recentEvents.length > 250) recentEvents.length = 250;
  stats.received += 1;
  stats.lastEventAt = event.receivedAt;
  stats.lastServerJobId = event.server?.jobId ?? stats.lastServerJobId;
  if (event.event === "player.death") stats.deaths += 1;
  if (event.category === "economy" && severityRank(event.severity) >= severityRank("warning")) stats.economyAlerts += 1;
  if (event.category === "security" || severityRank(event.severity) >= severityRank("suspicious")) stats.securityAlerts += 1;
}

function formatMoney(value: unknown): string | null {
  const amount = normalizeNumber(value);
  if (amount === undefined) return null;
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${sign}R$ ${Math.abs(amount).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`;
}

function fieldValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "string") return value.slice(0, 900);
  try {
    return JSON.stringify(value).slice(0, 900);
  } catch {
    return null;
  }
}

function eventTitle(event: RobloxBridgeEvent): string {
  const known: Record<string, string> = {
    "player.join": "Jogador entrou",
    "player.leave": "Jogador saiu",
    "player.death": "Morte registrada",
    "economy.transaction": "Movimentação financeira",
    "economy.balance": "Alteração de saldo",
    "inventory.change": "Alteração de inventário",
    "vehicle.event": "Evento de veículo",
    "staff.action": "Ação administrativa",
    "security.exploit": "Possível exploit detectado",
    "system.error": "Erro do servidor Roblox",
  };
  return known[event.event] ?? event.event.replace(/[._-]+/g, " ");
}

function buildEventEmbed(event: RobloxBridgeEvent): EmbedBuilder {
  const playerName = event.player?.displayName || event.player?.username || "Não informado";
  const embed = new EmbedBuilder()
    .setColor(event.severity === "critical" ? 0xed4245 : event.severity === "suspicious" ? 0xf47b20 : CATEGORY_COLOR[event.category])
    .setAuthor({ name: `GERAIS CITY • ${CATEGORY_LABEL[event.category]}` })
    .setTitle(`${event.severity === "critical" ? "🚨 " : event.severity === "suspicious" ? "⚠️ " : ""}${eventTitle(event)}`)
    .setFooter({ text: `Evento ${event.id} • ${event.severity.toUpperCase()}` })
    .setTimestamp(event.receivedAt);

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  if (event.player?.userId || event.player?.username || event.player?.displayName) {
    fields.push({ name: "Jogador", value: `${playerName}${event.player?.username && event.player.username !== playerName ? ` (@${event.player.username})` : ""}`, inline: true });
    if (event.player.userId) fields.push({ name: "UserId", value: `\`${event.player.userId}\``, inline: true });
  }
  if (event.server?.name || event.server?.jobId) {
    fields.push({ name: "Servidor", value: event.server?.name || `\`${event.server?.jobId?.slice(0, 32)}\``, inline: true });
  }

  const data = event.data;
  if (event.category === "economy") {
    const delta = formatMoney(data.delta ?? data.amount);
    const before = formatMoney(data.balanceBefore);
    const after = formatMoney(data.balanceAfter);
    if (delta) fields.push({ name: "Alteração", value: `**${delta}**`, inline: true });
    if (before) fields.push({ name: "Saldo anterior", value: before, inline: true });
    if (after) fields.push({ name: "Saldo atual", value: after, inline: true });
  }
  if (event.event === "player.death") {
    const killer = fieldValue(data.killerName ?? data.killerUsername ?? data.killerUserId);
    const weapon = fieldValue(data.weapon);
    const cause = fieldValue(data.cause);
    const location = fieldValue(data.location);
    if (killer) fields.push({ name: "Responsável", value: killer, inline: true });
    if (weapon) fields.push({ name: "Arma", value: weapon, inline: true });
    if (cause) fields.push({ name: "Causa", value: cause, inline: true });
    if (location) fields.push({ name: "Local", value: location, inline: false });
  }

  const preferredKeys = ["action", "reason", "source", "item", "quantity", "vehicle", "speed", "distance", "remote", "details"];
  for (const key of preferredKeys) {
    if (fields.length >= 20) break;
    const value = fieldValue(data[key]);
    if (value) fields.push({ name: key.charAt(0).toUpperCase() + key.slice(1), value, inline: value.length < 60 });
  }

  if (!fields.length) {
    embed.setDescription("Evento recebido do servidor Roblox.");
  } else {
    embed.addFields(fields.slice(0, 20));
  }
  return embed;
}

async function resolveTextChannel(client: Client, guild: Guild, id: string | undefined): Promise<TextChannel | null> {
  if (!id) return null;
  const channel = await guild.channels.fetch(id).catch(() => null);
  if (channel?.type !== ChannelType.GuildText) return null;
  const me = guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages) || !permissions.has(PermissionFlagsBits.EmbedLinks)) return null;
  return channel;
}

async function targetGuild(client: Client): Promise<Guild | null> {
  const preferred = process.env.ROBLOX_BRIDGE_GUILD_ID?.trim() || process.env.DISCORD_GUILD_ID?.trim();
  if (preferred) return client.guilds.fetch(preferred).catch(() => null);
  return client.guilds.cache.size === 1 ? client.guilds.cache.first() ?? null : null;
}

function shouldSendGeneral(event: RobloxBridgeEvent): boolean {
  if (process.env.ROBLOX_LOG_VERBOSE === "true") return severityRank(event.severity) < severityRank("suspicious");
  if (event.event === "player.death" || event.category === "staff") return true;
  if (event.category === "system" && severityRank(event.severity) <= severityRank("warning")) return true;
  return false;
}

function shouldSendSecurity(event: RobloxBridgeEvent): boolean {
  if (event.category === "security") return true;
  if (event.category === "economy" && severityRank(event.severity) >= severityRank("warning")) return true;
  return severityRank(event.severity) >= severityRank("suspicious");
}

async function dispatch(client: Client, event: RobloxBridgeEvent): Promise<void> {
  const guild = await targetGuild(client);
  if (!guild) return;
  const generalId = process.env.GERAIS_LOG_CHANNEL_ID?.trim() || process.env.ROBLOX_LOG_CHANNEL_ID?.trim();
  const securityId = process.env.SECURITY_ALERT_CHANNEL_ID?.trim() || process.env.SECURITY_LOG_CHANNEL_ID?.trim();
  const embed = buildEventEmbed(event);

  if (shouldSendSecurity(event)) {
    const channel = await resolveTextChannel(client, guild, securityId);
    if (channel) await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => undefined);
    return;
  }
  if (shouldSendGeneral(event)) {
    const channel = await resolveTextChannel(client, guild, generalId);
    if (channel) await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => undefined);
  }
}

function normalizeIncoming(body: unknown): RobloxBridgeEvent | null {
  const input = safeObject(body);
  const eventName = normalizeString(input.event, 80);
  if (!eventName || !/^[a-z0-9_.-]{3,80}$/i.test(eventName)) return null;
  const playerRaw = safeObject(input.player);
  const serverRaw = safeObject(input.server);
  const data = safeObject(input.data);
  const category = categoryForEvent(eventName);
  const requestedSeverity = normalizeSeverity(input.severity);
  return {
    id: makeId(),
    receivedAt: Date.now(),
    event: eventName.toLowerCase(),
    category,
    severity: deriveSeverity(eventName.toLowerCase(), requestedSeverity, data),
    player: Object.keys(playerRaw).length ? {
      userId: normalizeString(playerRaw.userId, 24),
      username: normalizeString(playerRaw.username, 40),
      displayName: normalizeString(playerRaw.displayName, 40),
    } : undefined,
    server: Object.keys(serverRaw).length ? {
      jobId: normalizeString(serverRaw.jobId, 80),
      placeId: normalizeString(serverRaw.placeId, 30),
      name: normalizeString(serverRaw.name, 80),
    } : undefined,
    data,
  };
}

export function robloxBridgeConfigured(): boolean {
  return Boolean(process.env.ROBLOX_BRIDGE_SECRET?.trim());
}

export function getRobloxBridgeStats(): Readonly<BridgeStats> {
  return { ...stats };
}

export function getRecentRobloxEvents(limit = 10): RobloxBridgeEvent[] {
  return recentEvents.slice(0, Math.max(1, Math.min(50, limit)));
}

export function registerRobloxBridgeRoutes(app: Express, client: Client): void {
  app.post("/api/roblox/events", async (req, res) => {
    if (!robloxBridgeConfigured()) {
      res.status(503).json({ ok: false, error: "bridge_not_configured" });
      return;
    }
    if (!isAuthorized(req)) {
      stats.rejected += 1;
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    const event = normalizeIncoming(req.body);
    if (!event) {
      stats.rejected += 1;
      res.status(400).json({ ok: false, error: "invalid_event" });
      return;
    }
    const serverKey = event.server?.jobId || "unknown";
    if (!allowRate(serverKey)) {
      stats.rejected += 1;
      res.status(429).json({ ok: false, error: "rate_limited" });
      return;
    }
    const externalId = normalizeString(safeObject(req.body).eventId, 120);
    if (externalId) {
      const previous = dedupe.get(externalId);
      if (previous && Date.now() - previous < 10 * 60_000) {
        res.status(202).json({ ok: true, duplicate: true, id: event.id });
        return;
      }
      dedupe.set(externalId, Date.now());
      if (dedupe.size > 1000) {
        const cutoff = Date.now() - 10 * 60_000;
        for (const [id, at] of dedupe) if (at < cutoff) dedupe.delete(id);
      }
    }

    remember(event);
    void recordRobloxEvent({
      id: event.id,
      guildId: process.env.ROBLOX_BRIDGE_GUILD_ID?.trim() || process.env.DISCORD_GUILD_ID?.trim() || "auto",
      eventType: event.event,
      category: event.category,
      severity: event.severity,
      userId: event.player?.userId ?? null,
      username: event.player?.username ?? null,
      jobId: event.server?.jobId ?? null,
      payload: { player: event.player ?? null, server: event.server ?? null, data: event.data },
      createdAt: event.receivedAt,
    });
    void dispatch(client, event);
    res.status(202).json({ ok: true, id: event.id, severity: event.severity });
  });

  app.get("/api/roblox/status", (_req, res) => {
    res.json({
      enabled: robloxBridgeConfigured(),
      received: stats.received,
      rejected: stats.rejected,
      lastEventAt: stats.lastEventAt,
    });
  });
}
