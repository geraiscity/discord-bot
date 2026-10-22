/** Helpers sem acesso ao Discord: decisões verificáveis com testes. */
export type SecurityMode = "alerta" | "proteger";
export type Detection = "convite" | "possivel_token" | "termo_protegido" | null;

export interface MessageProtectionOptions {
  blockInvites: boolean;
  allowedInviteCodes: readonly string[];
  protectedTerms: readonly string[];
}

export function detectSensitiveContent(
  content: string,
  options: MessageProtectionOptions,
): Detection {
  // Nunca incluímos o texto original em alertas ou logs.
  if (/\bmfa\.[\w-]{35,}\b|\b[\w-]{24,}\.[\w-]{6,}\.[\w-]{27,}\b/.test(content)) {
    return "possivel_token";
  }
  const lower = content.toLocaleLowerCase("en-US");
  if (options.protectedTerms.some((term) => term.trim().length >= 5 && lower.includes(term.trim().toLocaleLowerCase("en-US")))) {
    return "termo_protegido";
  }
  if (options.blockInvites) {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)([a-z0-9-]+)/gi;
    for (const match of content.matchAll(regex)) {
      const inviteCode = match[1]?.toLowerCase();
      if (inviteCode && !options.allowedInviteCodes.some((code) => code.toLowerCase() === inviteCode)) {
        return "convite";
      }
    }
  }
  return null;
}

export function isPrivilegedPermissionChange(oldBits: bigint, newBits: bigint, criticalMask: bigint): boolean {
  return (newBits & criticalMask & ~oldBits) !== 0n;
}

/** Contador deslizante: cada guild/autor tem sua janela isolada. */
export class SlidingCounter {
  private readonly hits = new Map<string, number[]>();
  private readonly windowMs: number;
  constructor(windowMs: number) {
    if (windowMs <= 0) throw new Error("Janela inválida");
    this.windowMs = windowMs;
  }
  record(key: string, time = Date.now()): number {
    if (this.hits.size > 10_000) {
      for (const [itemKey, values] of this.hits) {
        if (values[values.length - 1]! < time - this.windowMs) this.hits.delete(itemKey);
      }
    }
    const recent = (this.hits.get(key) ?? []).filter((value) => value > time - this.windowMs);
    recent.push(time);
    this.hits.set(key, recent);
    return recent.length;
  }
  clear(key: string): void { this.hits.delete(key); }
}

export function isProtectedChannel(channelId: string, topic: string | null | undefined, configuredIds: readonly string[]): boolean {
  return configuredIds.includes(channelId) || Boolean(topic?.startsWith("ticket:"));
}

export function shouldQuarantineRoles(rolePermissionBits: bigint, dangerousMask: bigint): boolean {
  return (rolePermissionBits & dangerousMask) !== 0n;
}

export interface JoinRiskInput {
  accountAgeMs: number;
  defaultAvatar: boolean;
  username: string;
  joinsInWindow: number;
  raidThreshold: number;
  isBot: boolean;
  botAllowed: boolean;
}

export interface JoinRiskResult {
  score: number;
  factors: string[];
}

/**
 * Pontuação conservadora: sinaliza risco sem tentar "adivinhar" intenção.
 * O resultado deve ser usado junto com limites configuráveis e logs privados.
 */
export function scoreJoinRisk(input: JoinRiskInput): JoinRiskResult {
  let score = 0;
  const factors: string[] = [];
  const day = 86_400_000;
  if (input.isBot && !input.botAllowed) {
    score += 10;
    factors.push("bot não autorizado");
  }
  if (input.accountAgeMs < day) {
    score += 4;
    factors.push("conta com menos de 24h");
  } else if (input.accountAgeMs < 7 * day) {
    score += 3;
    factors.push("conta com menos de 7 dias");
  } else if (input.accountAgeMs < 30 * day) {
    score += 1;
    factors.push("conta com menos de 30 dias");
  }
  if (input.defaultAvatar) {
    score += 1;
    factors.push("avatar padrão");
  }
  if (/\d{5,}/.test(input.username) || /^[a-z]{2,8}\d{3,}$/i.test(input.username)) {
    score += 1;
    factors.push("nome com padrão automatizado");
  }
  if (input.joinsInWindow >= input.raidThreshold) {
    score += 4;
    factors.push("entrada durante pico de raid");
  } else if (input.joinsInWindow >= Math.max(3, Math.floor(input.raidThreshold / 2))) {
    score += 2;
    factors.push("múltiplas entradas recentes");
  }
  return { score, factors };
}
