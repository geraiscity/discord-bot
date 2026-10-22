import pg, { type Pool as PgPool } from "pg";

const { Pool } = pg;

export type PersistenceMode = "postgresql" | "arquivo";

let pool: PgPool | null = null;
let initPromise: Promise<PgPool | null> | null = null;
let lastDatabaseErrorAt = 0;

function databaseUrl(): string {
  return process.env.DATABASE_URL?.trim() ?? "";
}

async function initializePool(): Promise<PgPool | null> {
  if (!databaseUrl()) return null;
  if (pool) return pool;
  if (Date.now() - lastDatabaseErrorAt < 30_000) return null;

  const candidate = new Pool({
    connectionString: databaseUrl(),
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    ssl: process.env.DATABASE_SSL === "false" ? false : undefined,
  });

  try {
    await candidate.query("select 1");
    await candidate.query(`
      create table if not exists gerais_bot_state (
        key text primary key,
        value jsonb not null,
        updated_at timestamptz not null default now()
      );

      create table if not exists gerais_security_incidents (
        id text primary key,
        guild_id text not null,
        created_at bigint not null,
        title text not null,
        details text not null,
        urgent boolean not null default false
      );
      create index if not exists gerais_security_incidents_guild_created_idx
        on gerais_security_incidents (guild_id, created_at desc);

      create table if not exists gerais_ticket_events (
        id bigserial primary key,
        guild_id text not null,
        channel_id text not null,
        owner_id text,
        actor_id text,
        action text not null,
        payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
      create index if not exists gerais_ticket_events_channel_idx
        on gerais_ticket_events (channel_id, created_at desc);

      create table if not exists gerais_ticket_ratings (
        id bigserial primary key,
        guild_id text not null,
        ticket_id text not null,
        user_id text not null,
        rating integer not null check (rating between 1 and 5),
        created_at timestamptz not null default now(),
        unique (ticket_id, user_id)
      );

      create table if not exists gerais_verification_events (
        id bigserial primary key,
        guild_id text not null,
        user_id text not null,
        approved boolean not null,
        method text not null,
        account_age_days integer,
        email_verified boolean,
        reason text,
        created_at timestamptz not null default now()
      );
      create index if not exists gerais_verification_events_user_idx
        on gerais_verification_events (guild_id, user_id, created_at desc);

      create table if not exists gerais_snapshots (
        guild_id text not null,
        created_at bigint not null,
        snapshot jsonb not null,
        primary key (guild_id, created_at)
      );
      create index if not exists gerais_snapshots_guild_created_idx
        on gerais_snapshots (guild_id, created_at desc);

      create table if not exists gerais_roblox_events (
        id text primary key,
        guild_id text not null,
        event_type text not null,
        category text not null,
        severity text not null,
        user_id text,
        username text,
        job_id text,
        payload jsonb not null default '{}'::jsonb,
        created_at bigint not null
      );
      create index if not exists gerais_roblox_events_created_idx
        on gerais_roblox_events (guild_id, created_at desc);
      create index if not exists gerais_roblox_events_user_idx
        on gerais_roblox_events (guild_id, user_id, created_at desc);
    `);
    pool = candidate;
    console.log("Persistência PostgreSQL do Gerais Bot conectada.");
    return pool;
  } catch (error) {
    lastDatabaseErrorAt = Date.now();
    console.error("PostgreSQL indisponível; usando arquivos locais como fallback:", error);
    await candidate.end().catch(() => undefined);
    return null;
  }
}

async function getPool(): Promise<PgPool | null> {
  if (!databaseUrl()) return null;
  if (pool) return pool;
  if (!initPromise) {
    initPromise = initializePool().finally(() => {
      initPromise = null;
    });
  }
  return initPromise;
}

export async function persistenceMode(): Promise<PersistenceMode> {
  return (await getPool()) ? "postgresql" : "arquivo";
}

export async function loadStateFromDatabase<T>(key: string): Promise<T | null> {
  const db = await getPool();
  if (!db) return null;
  try {
    const result = await db.query<{ value: T }>(
      "select value from gerais_bot_state where key = $1 limit 1",
      [key],
    );
    return result.rows[0]?.value ?? null;
  } catch (error) {
    console.error("Falha ao ler estado no PostgreSQL:", error);
    return null;
  }
}

export async function saveStateToDatabase(key: string, value: unknown): Promise<boolean> {
  const db = await getPool();
  if (!db) return false;
  try {
    await db.query(
      `insert into gerais_bot_state (key, value, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
    return true;
  } catch (error) {
    console.error("Falha ao salvar estado no PostgreSQL:", error);
    return false;
  }
}

export interface PersistedSecurityIncident {
  id: string;
  guildId: string;
  createdAt: number;
  title: string;
  details: string;
  urgent: boolean;
}

export async function persistSecurityIncident(incident: PersistedSecurityIncident): Promise<void> {
  const db = await getPool();
  if (!db) return;
  await db.query(
    `insert into gerais_security_incidents (id, guild_id, created_at, title, details, urgent)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (id) do nothing`,
    [incident.id, incident.guildId, incident.createdAt, incident.title, incident.details, incident.urgent],
  ).catch((error) => console.error("Falha ao persistir incidente:", error));
}

export async function loadRecentSecurityIncidents(guildId: string, limit = 200): Promise<PersistedSecurityIncident[]> {
  const db = await getPool();
  if (!db) return [];
  try {
    const result = await db.query<{
      id: string;
      guild_id: string;
      created_at: string;
      title: string;
      details: string;
      urgent: boolean;
    }>(
      `select id, guild_id, created_at, title, details, urgent
       from gerais_security_incidents
       where guild_id = $1
       order by created_at desc
       limit $2`,
      [guildId, Math.max(1, Math.min(1000, limit))],
    );
    return result.rows.reverse().map((row) => ({
      id: row.id,
      guildId: row.guild_id,
      createdAt: Number(row.created_at),
      title: row.title,
      details: row.details,
      urgent: row.urgent,
    }));
  } catch (error) {
    console.error("Falha ao carregar incidentes do PostgreSQL:", error);
    return [];
  }
}

export interface TicketEventInput {
  guildId: string;
  channelId: string;
  ownerId?: string | null;
  actorId?: string | null;
  action: string;
  payload?: Record<string, unknown>;
}

export async function recordTicketEvent(event: TicketEventInput): Promise<void> {
  const db = await getPool();
  if (!db) return;
  await db.query(
    `insert into gerais_ticket_events (guild_id, channel_id, owner_id, actor_id, action, payload)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [event.guildId, event.channelId, event.ownerId ?? null, event.actorId ?? null, event.action, JSON.stringify(event.payload ?? {})],
  ).catch((error) => console.error("Falha ao persistir evento de ticket:", error));
}

export async function recordTicketRating(input: {
  guildId: string;
  ticketId: string;
  userId: string;
  rating: number;
}): Promise<void> {
  const db = await getPool();
  if (!db) return;
  await db.query(
    `insert into gerais_ticket_ratings (guild_id, ticket_id, user_id, rating)
     values ($1, $2, $3, $4)
     on conflict (ticket_id, user_id) do update set rating = excluded.rating, created_at = now()`,
    [input.guildId, input.ticketId, input.userId, input.rating],
  ).catch((error) => console.error("Falha ao persistir avaliação de ticket:", error));
}

export async function recordVerificationEvent(input: {
  guildId: string;
  userId: string;
  approved: boolean;
  method: "native" | "oauth_email";
  accountAgeDays?: number;
  emailVerified?: boolean | null;
  reason?: string;
}): Promise<void> {
  const db = await getPool();
  if (!db) return;
  await db.query(
    `insert into gerais_verification_events
       (guild_id, user_id, approved, method, account_age_days, email_verified, reason)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [input.guildId, input.userId, input.approved, input.method, input.accountAgeDays ?? null, input.emailVerified ?? null, input.reason ?? null],
  ).catch((error) => console.error("Falha ao persistir evento de verificação:", error));
}


export interface RobloxEventInput {
  id: string;
  guildId: string;
  eventType: string;
  category: string;
  severity: string;
  userId?: string | null;
  username?: string | null;
  jobId?: string | null;
  payload?: Record<string, unknown>;
  createdAt: number;
}

export async function recordRobloxEvent(event: RobloxEventInput): Promise<void> {
  const db = await getPool();
  if (!db) return;
  await db.query(
    `insert into gerais_roblox_events
       (id, guild_id, event_type, category, severity, user_id, username, job_id, payload, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
     on conflict (id) do nothing`,
    [
      event.id,
      event.guildId,
      event.eventType,
      event.category,
      event.severity,
      event.userId ?? null,
      event.username ?? null,
      event.jobId ?? null,
      JSON.stringify(event.payload ?? {}),
      event.createdAt,
    ],
  ).catch((error) => console.error("Falha ao persistir evento Roblox:", error));
}

export async function saveSnapshotToDatabase(guildId: string, createdAt: number, snapshot: unknown): Promise<void> {
  const db = await getPool();
  if (!db) return;
  try {
    await db.query(
      `insert into gerais_snapshots (guild_id, created_at, snapshot)
       values ($1, $2, $3::jsonb)
       on conflict (guild_id, created_at) do update set snapshot = excluded.snapshot`,
      [guildId, createdAt, JSON.stringify(snapshot)],
    );
    await db.query(
      `delete from gerais_snapshots
       where guild_id = $1 and created_at not in (
         select created_at from gerais_snapshots where guild_id = $1 order by created_at desc limit 10
       )`,
      [guildId],
    );
  } catch (error) {
    console.error("Falha ao persistir snapshot no PostgreSQL:", error);
  }
}

export async function loadLatestSnapshotFromDatabase<T>(guildId: string): Promise<T | null> {
  const db = await getPool();
  if (!db) return null;
  try {
    const result = await db.query<{ snapshot: T }>(
      `select snapshot from gerais_snapshots where guild_id = $1 order by created_at desc limit 1`,
      [guildId],
    );
    return result.rows[0]?.snapshot ?? null;
  } catch (error) {
    console.error("Falha ao ler snapshot do PostgreSQL:", error);
    return null;
  }
}

export async function closePersistence(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end().catch(() => undefined);
}
