// Only approved metadata is logged. Never copy arbitrary audit payloads.
export function safeAuditText(value: unknown, max = 180): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return "Não informado";
  const cleaned = String(value).replace(/[\r\n\t\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned.slice(0, max).replace(/([\\`*_~|<>@])/g, "\\$1") || "Não informado";
}
export function roleChangeList(value: unknown): string {
  if (!Array.isArray(value) || !value.length) return "Não informado";
  const roles = value.slice(0, 12).map((item: unknown) => {
    if (!item || typeof item !== "object") return "Cargo não identificado";
    const r = item as { name?: unknown; id?: unknown };
    const id = typeof r.id === "string" && /^\d{15,22}$/.test(r.id) ? " (ID " + r.id + ")" : "";
    return safeAuditText(r.name, 65) + id;
  });
  if (value.length > 12) roles.push("+" + (value.length - 12) + " cargo(s)");
  return roles.join("\n").slice(0, 1000);
}
export function auditDestination(kind: "channel" | "role" | "member" | "server", env: Record<string, string | undefined>, shieldChannel: string | null): string | null {
  const specific = {channel:"DISCORD_CHANNEL_LOG_CHANNEL_ID", role:"DISCORD_ROLE_LOG_CHANNEL_ID", member:"DISCORD_MEMBER_LOG_CHANNEL_ID", server:"DISCORD_SERVER_LOG_CHANNEL_ID"}[kind];
  return env[specific]?.trim() || env.DISCORD_AUDIT_LOG_CHANNEL_ID?.trim() || env.GERAIS_LOG_CHANNEL_ID?.trim() || shieldChannel || null;
}

export const logRouteKinds = ["channel", "role", "member", "server", "general", "security", "ticket_bugs", "ticket_suporte", "ticket_denuncias", "ticket_compras", "ticket_parcerias", "roblox", "roblox_security"] as const;
export type LogRouteKind = typeof logRouteKinds[number];
export type LogRoutes = Partial<Record<LogRouteKind, string>>;
export function isLogRouteKind(value: string): value is LogRouteKind {
  return (logRouteKinds as readonly string[]).includes(value);
}
export function normalizeLogRoutes(value: unknown): LogRoutes {
  const result: LogRoutes = {};
  if (!value || typeof value !== "object") return result;
  for (const kind of logRouteKinds) {
    const id = (value as Record<string, unknown>)[kind];
    if (typeof id === "string" && /^\d{15,22}$/.test(id)) result[kind] = id;
  }
  return result;
}
export function effectiveLogRoute(kind: LogRouteKind, routes: LogRoutes, env: Record<string, string | undefined>, legacySecurity: string | null): string | null {
  const security = routes.security || legacySecurity || null;
  if (kind === "security") return security;
  if(kind==="roblox")return routes.roblox || env.ROBLOX_LOG_CHANNEL_ID?.trim() || env.GERAIS_LOG_CHANNEL_ID?.trim() || null;
  if(kind==="roblox_security")return routes.roblox_security || env.ROBLOX_SECURITY_LOG_CHANNEL_ID?.trim() || security;
  if(kind==="ticket_bugs"||kind==="ticket_suporte"||kind==="ticket_denuncias"||kind==="ticket_compras"||kind==="ticket_parcerias")return routes[kind] || env[kind.toUpperCase()+"_LOG_CHANNEL_ID"]?.trim() || env.TRANSCRIPT_CHANNEL_ID?.trim() || env.TICKET_LOG_CHANNEL_ID?.trim() || legacyTicketDestinations[kind];
  const general = routes.general || env.DISCORD_AUDIT_LOG_CHANNEL_ID?.trim() || env.GERAIS_LOG_CHANNEL_ID?.trim() || security;
  if (kind === "general") return general || null;
  const specific = {channel:"DISCORD_CHANNEL_LOG_CHANNEL_ID", role:"DISCORD_ROLE_LOG_CHANNEL_ID", member:"DISCORD_MEMBER_LOG_CHANNEL_ID", server:"DISCORD_SERVER_LOG_CHANNEL_ID"}[kind];
  return routes[kind] || env[specific]?.trim() || general || null;
}

export const legacyTicketDestinations={ticket_bugs:"1549446571605758063",ticket_suporte:"1549446560637657201",ticket_denuncias:"1549446567650664459",ticket_compras:"1549446564043301054",ticket_parcerias:"1568070781391470734"} as const;
