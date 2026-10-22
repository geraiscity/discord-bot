export interface TicketMeta {
  ownerId: string;
  type: string;
  addedUserIds: string[];
  claimedBy?: string;
}

const SNOWFLAKE = /^\d{15,22}$/;

export function parseTicketTopic(topic: string | null | undefined): TicketMeta | null {
  if (!topic?.startsWith("ticket:")) return null;
  const [base, ...parts] = topic.split("|");
  const match = base.match(/^ticket:(\d{15,22}):([a-z0-9_-]{2,32})$/i);
  if (!match) return null;
  const added = new Set<string>();
  let claimedBy: string | undefined;
  for (const part of parts) {
    const [key, raw = ""] = part.split("=", 2);
    if (key === "added") {
      for (const id of raw.split(",")) if (SNOWFLAKE.test(id)) added.add(id);
    }
    if (key === "claimed" && SNOWFLAKE.test(raw)) claimedBy = raw;
  }
  return { ownerId: match[1], type: match[2], addedUserIds: [...added], claimedBy };
}

export function buildTicketTopic(meta: TicketMeta): string {
  const parts = [`ticket:${meta.ownerId}:${meta.type}`];
  const added = [...new Set(meta.addedUserIds.filter((id) => SNOWFLAKE.test(id)))].slice(0, 20);
  if (added.length) parts.push(`added=${added.join(",")}`);
  if (meta.claimedBy && SNOWFLAKE.test(meta.claimedBy)) parts.push(`claimed=${meta.claimedBy}`);
  return parts.join("|").slice(0, 1024);
}

export function isTicketTopic(topic: string | null | undefined): boolean {
  return Boolean(parseTicketTopic(topic));
}
