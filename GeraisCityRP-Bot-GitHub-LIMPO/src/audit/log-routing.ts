import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { ChannelType, PermissionFlagsBits, type Guild } from "discord.js";
import { loadStateFromDatabase, saveStateToDatabase } from "../database/persistence.js";
import { normalizeLogRoutes, effectiveLogRoute, type LogRouteKind, type LogRoutes } from "./audit-core.js";

type SavedRoutes = { updatedAt: number; routes: LogRoutes };
type Storage = "both" | "local" | "database";
const cache = new Map<string, SavedRoutes>();
const loading = new Map<string, Promise<SavedRoutes>>();
const writing = new Map<string, Promise<unknown>>();
function fileFor(guildId: string): string {
  if (!/^\d{15,22}$/.test(guildId)) throw new Error("Invalid guild ID");
  return resolve(".data", "audit-routes-" + guildId + ".json");
}
function normalize(value: unknown): SavedRoutes | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<SavedRoutes>;
  if (typeof v.updatedAt !== "number" || !Number.isFinite(v.updatedAt) || !v.routes || typeof v.routes !== "object") return null;
  return {updatedAt: v.updatedAt, routes: normalizeLogRoutes(v.routes)};
}
async function load(guildId: string): Promise<SavedRoutes> {
  const known = cache.get(guildId);
  if (known) return known;
  let pending = loading.get(guildId);
  if (!pending) {
    pending = (async () => {
      const file = fileFor(guildId);
      const [database, local] = await Promise.all([
        loadStateFromDatabase<unknown>("audit-routes:" + guildId).catch(() => null),
        readFile(file, "utf8").then((raw) => JSON.parse(raw) as unknown).catch(() => null),
      ]);
      const candidates = [normalize(database), normalize(local)].filter((v): v is SavedRoutes => v !== null).sort((a,b) => b.updatedAt - a.updatedAt);
      const selected = candidates[0] ?? {updatedAt: 0, routes: {}};
      cache.set(guildId, selected);
      return selected;
    })().finally(() => { loading.delete(guildId); });
    loading.set(guildId, pending);
  }
  return pending;
}
export async function getLogRoutes(guildId: string): Promise<LogRoutes> {
  return {...(await load(guildId)).routes};
}
export function cachedSecurityRoute(guildId: string | undefined, legacy: string | null): string | null {
  return (guildId ? cache.get(guildId)?.routes.security : undefined) || legacy || null;
}
export async function resolveLogRoute(guildId: string, kind: LogRouteKind, legacy: string | null): Promise<string | null> {
  return effectiveLogRoute(kind, await getLogRoutes(guildId), process.env, legacy);
}
export async function validateLogChannel(guild: Guild, id: string): Promise<string | null> {
  const channel = await guild.channels.fetch(id, {force:true}).catch(() => null);
  if (channel?.type !== ChannelType.GuildText) return "Escolha um canal de texto deste servidor.";
  if (channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) !== false) return "O canal deve estar oculto para @everyone.";
  const me = guild.members.me;
  if (!me || !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return "Conceda ao bot Ver Canal, Enviar Mensagens e Incorporar Links neste canal.";
  return null;
}
export async function saveLogRoute(guildId: string, kind: LogRouteKind, id: string | null): Promise<Storage> {
  if (id !== null && !/^\d{15,22}$/.test(id)) throw new Error("Invalid channel ID");
  const previous = writing.get(guildId) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(async (): Promise<Storage> => {
    const old = await load(guildId);
    const routes = {...old.routes};
    if (id === null) delete routes[kind]; else routes[kind] = id;
    const next = {updatedAt: Math.max(Date.now(), old.updatedAt + 1), routes};
    const file = fileFor(guildId);
    const local = (async () => {
      await mkdir(dirname(file), {recursive:true});
      const tmp = file + "." + process.pid + ".tmp";
      await writeFile(tmp, JSON.stringify(next, null, 2), {mode:0o600});
      await rename(tmp, file);
      return true;
    })().catch(() => false);
    const [disk, db] = await Promise.all([local, saveStateToDatabase("audit-routes:" + guildId, next).catch(() => false)]);
    if (!disk && !db) throw new Error("Log route could not be saved");
    cache.set(guildId, next);
    return disk && db ? "both" : disk ? "local" : "database";
  });
  writing.set(guildId, task);
  try { return await task; }
  finally { if (writing.get(guildId) === task) writing.delete(guildId); }
}
