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
