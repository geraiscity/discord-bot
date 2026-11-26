import {
  ChannelType,
  Guild,
  OverwriteType,
  PermissionFlagsBits,
  type GuildBasedChannel,
} from "discord.js";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { loadLatestSnapshotFromDatabase, saveSnapshotToDatabase,loadStateFromDatabase,saveStateToDatabase } from "../database/persistence.js";

const SNAPSHOT_FILE = resolve(process.env.SECURITY_SNAPSHOT_FILE || ".data/gerais-snapshot.json");
const HISTORY_DIR = resolve(process.env.SECURITY_SNAPSHOT_HISTORY_DIR || ".data/gerais-snapshots");
const MAX_HISTORY = 10;
import {mappedId,latest,type RestoreScope} from "./recovery-core.js";
const busy=new Set<string>();
type Ledger={roles:Record<string,string>;channels:Record<string,string>};
function key(s:GuildSnapshot){return "restore:"+s.guildId+":"+s.createdAt;}
function file(s:GuildSnapshot){return join(HISTORY_DIR,s.guildId,"restore-"+s.createdAt+".json");}
async function ledgerFor(s:GuildSnapshot):Promise<Ledger>{
 const [db,local]=await Promise.all([loadStateFromDatabase<Ledger>(key(s)),readFile(file(s),"utf8").then(x=>JSON.parse(x) as Ledger).catch(()=>null)]);
 return {roles:{...db?.roles,...local?.roles},channels:{...db?.channels,...local?.channels}};
}
async function saveLedger(s:GuildSnapshot,l:Ledger){
 const p=file(s);const disk=(async()=>{await mkdir(dirname(p),{recursive:true});await writeFile(p+".tmp",JSON.stringify(l),{mode:0o600});await rename(p+".tmp",p);return true;})().catch(()=>false);
 const [a,b]=await Promise.all([disk,saveStateToDatabase(key(s),l)]);if(!a&&!b)throw Error("Falha ao salvar mapa de recuperação; operação interrompida.");
}

interface RoleSnapshot {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  position: number;
  permissions: string;
  mentionable: boolean;
}

interface OverwriteSnapshot {
  id: string;
  type: number;
  allow: string;
  deny: string;
}

interface ChannelSnapshot {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
  position: number;
  topic?: string | null;
  nsfw?: boolean;
  rateLimitPerUser?: number;
  permissionOverwrites: OverwriteSnapshot[];
}

export interface GuildSnapshot {
  version: 3;
  guildId: string;
  createdAt: number;
  guildName: string;
  roles: RoleSnapshot[];
  channels: ChannelSnapshot[];
}

function snapshotChannel(channel: GuildBasedChannel): ChannelSnapshot {
  const permissionOverwrites = "permissionOverwrites" in channel
    ? channel.permissionOverwrites.cache.map((overwrite) => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow.bitfield.toString(),
        deny: overwrite.deny.bitfield.toString(),
      }))
    : [];
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: "parentId" in channel ? channel.parentId : null,
    position: "rawPosition" in channel ? channel.rawPosition : 0,
    topic: "topic" in channel && typeof channel.topic === "string" ? channel.topic : null,
    nsfw: "nsfw" in channel && typeof channel.nsfw === "boolean" ? channel.nsfw : undefined,
    rateLimitPerUser: "rateLimitPerUser" in channel && typeof channel.rateLimitPerUser === "number" ? channel.rateLimitPerUser : undefined,
    permissionOverwrites,
  };
}

async function rotateHistory(guildId: string): Promise<void> {
  const dir = join(HISTORY_DIR, guildId);
  const files = (await readdir(dir).catch(() => []))
    .filter((name) => /^snapshot-\d+\.json$/.test(name))
    .sort()
    .reverse();
  for (const stale of files.slice(MAX_HISTORY)) {
    await unlink(join(dir, stale)).catch(() => undefined);
  }
}

export async function createGuildSnapshot(guild: Guild): Promise<GuildSnapshot> {
  if(busy.has(guild.id))throw Error("Operação em andamento.");busy.add(guild.id);try{
  await Promise.all([guild.roles.fetch(),guild.channels.fetch()]);
  const snapshot: GuildSnapshot = {
    version: 3,
    guildId: guild.id,
    createdAt: Date.now(),
    guildName: guild.name,
    roles: guild.roles.cache
      .filter((role) => role.id !== guild.id && !role.managed)
      .sort((a, b) => a.position - b.position)
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        position: role.position,
        permissions: role.permissions.bitfield.toString(),
        mentionable: role.mentionable,
      })),
    channels: guild.channels.cache
      .filter((channel) => !channel.isThread())
      .sort((a, b) => ("rawPosition" in a ? a.rawPosition : 0) - ("rawPosition" in b ? b.rawPosition : 0))
      .map(snapshotChannel),
  };

  await mkdir(dirname(SNAPSHOT_FILE), { recursive: true });
  const temp = `${SNAPSHOT_FILE}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  await rename(temp, SNAPSHOT_FILE);

  const historyDir = join(HISTORY_DIR, guild.id);
  await mkdir(historyDir, { recursive: true });
  await writeFile(join(historyDir, `snapshot-${snapshot.createdAt}.json`), JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  await rotateHistory(guild.id);
  await saveSnapshotToDatabase(guild.id, snapshot.createdAt, snapshot);
  return snapshot;
  }finally{busy.delete(guild.id);}
}

function normalizeSnapshot(parsed: GuildSnapshot | (Omit<GuildSnapshot, "version"> & { version: 2 }), guildId: string): GuildSnapshot | null {
  if ((parsed.version !== 2 && parsed.version !== 3) || parsed.guildId !== guildId) return null;
  return { ...parsed, version: 3 } as GuildSnapshot;
}

export async function loadGuildSnapshot(guildId:string):Promise<GuildSnapshot|null>{
 const [db,local]=await Promise.all([loadLatestSnapshotFromDatabase<GuildSnapshot>(guildId),readFile(SNAPSHOT_FILE,"utf8").then(x=>JSON.parse(x) as GuildSnapshot).catch(()=>null)]);
 return latest([db?normalizeSnapshot(db,guildId):null,local?normalizeSnapshot(local,guildId):null]);
}

function supportedChannelType(type: number): type is ChannelType {
  return [
    ChannelType.GuildCategory,
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildVoice,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum,
  ].includes(type as ChannelType);
}

export interface RestorePreview {
  missingRoles: Array<{ id: string; name: string }>;
  missingChannels: Array<{ id: string; name: string; type: number }>;
  unsupportedChannels: number;
}

export async function previewGuildRestore(guild: Guild, snapshot: GuildSnapshot): Promise<RestorePreview> {
  await Promise.all([guild.roles.fetch(),guild.channels.fetch()]);
  const ledger=await ledgerFor(snapshot);
  return {
    missingRoles: snapshot.roles
      .filter((role) => !mappedId(role.id,ledger.roles,id=>guild.roles.cache.has(id)))
      .map((role) => ({ id: role.id, name: role.name })),
    missingChannels: snapshot.channels
      .filter((channel) => !mappedId(channel.id,ledger.channels,id=>guild.channels.cache.has(id)) && supportedChannelType(channel.type))
      .map((channel) => ({ id: channel.id, name: channel.name, type: channel.type })),
    unsupportedChannels: snapshot.channels.filter((channel) => !mappedId(channel.id,ledger.channels,id=>guild.channels.cache.has(id)) && !supportedChannelType(channel.type)).length,
  };
}

export interface RestoreReport {
  rolesCreated: number;
  channelsCreated: number;
  skipped: number;
}

export async function restoreGuildSnapshot(guild:Guild,snapshot:GuildSnapshot,scope:RestoreScope="all"):Promise<RestoreReport>{
 if(snapshot.guildId!==guild.id||busy.has(guild.id))throw Error("Backup inválido ou operação em andamento.");busy.add(guild.id);try{
 const ledger=await ledgerFor(snapshot);
  const roleMap = new Map<string, string>();
  roleMap.set(guild.id, guild.id);
  let rolesCreated = 0;
  let channelsCreated = 0;
  let skipped = 0;

  await guild.roles.fetch();
  await guild.channels.fetch();

  for (const saved of snapshot.roles) {
    const existingId=mappedId(saved.id,ledger.roles,id=>guild.roles.cache.has(id));const existing=existingId?guild.roles.cache.get(existingId):undefined;
    if (existing) {
      roleMap.set(saved.id, existing.id);
      continue;
    }
    if(scope==="channels"){skipped++;continue;}
    const created = await guild.roles.create({
      name: saved.name,
      color: saved.color,
      hoist: saved.hoist,
      permissions: BigInt(saved.permissions),
      mentionable: saved.mentionable,
      reason: "Shield: restauração de snapshot",
    }).catch(() => null);
    if (!created) { skipped++; continue; }
    roleMap.set(saved.id, created.id);
    rolesCreated++;ledger.roles[saved.id]=created.id;await saveLedger(snapshot,ledger);
  }

  const channelMap = new Map<string, string>();
  for(const saved of snapshot.channels){const id=mappedId(saved.id,ledger.channels,id=>guild.channels.cache.has(id));if(id)channelMap.set(saved.id,id);}

  const createOne = async (saved: ChannelSnapshot) => {
    if(channelMap.has(saved.id)||scope==="roles")return;if(!supportedChannelType(saved.type)){skipped++;return;}
    const parent = saved.parentId ? channelMap.get(saved.parentId) ?? guild.channels.cache.get(saved.parentId)?.id : undefined;
    if(saved.parentId&&!parent){skipped++;return;}
    if(saved.permissionOverwrites.some(o=>o.type===OverwriteType.Role&&!roleMap.has(o.id)&&!guild.roles.cache.has(o.id))){skipped++;return;}
    const overwrites = saved.permissionOverwrites.map((overwrite) => ({
      id: roleMap.get(overwrite.id) ?? overwrite.id,
      type: overwrite.type === OverwriteType.Member ? OverwriteType.Member : OverwriteType.Role,
      allow: BigInt(overwrite.allow),
      deny: BigInt(overwrite.deny),
    }));
    const options: Record<string, unknown> = {
      name: saved.name,
      type: saved.type,
      parent,
      permissionOverwrites: overwrites,
      reason: "Shield: restauração de snapshot",
    };
    if ([ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(saved.type as ChannelType)) {
      options.topic = saved.topic ?? undefined;
      options.nsfw = saved.nsfw ?? false;
      options.rateLimitPerUser = saved.rateLimitPerUser ?? 0;
    }
    const created = await guild.channels.create(options as never).catch(() => null);
    if (!created) { skipped++; return; }
    channelMap.set(saved.id, created.id);
    channelsCreated++;ledger.channels[saved.id]=created.id;await saveLedger(snapshot,ledger);
  };

  for (const saved of snapshot.channels.filter((channel) => channel.type === ChannelType.GuildCategory)) await createOne(saved);
  for (const saved of snapshot.channels.filter((channel) => channel.type !== ChannelType.GuildCategory)) await createOne(saved);

  return { rolesCreated, channelsCreated, skipped };
  }finally{busy.delete(guild.id);}
}

export function snapshotFilePath(): string { return SNAPSHOT_FILE; }
export function snapshotHistoryDirectory(): string { return HISTORY_DIR; }
