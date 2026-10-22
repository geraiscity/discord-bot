import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type express from "express";

const STATE_TTL_MS = 10 * 60_000;

export const oauthVerificationEnvironment = {
  clientId: process.env.DISCORD_CLIENT_ID?.trim() ?? "",
  clientSecret: process.env.DISCORD_CLIENT_SECRET?.trim() ?? "",
  redirectUri: process.env.VERIFICATION_OAUTH_REDIRECT_URI?.trim() ?? "",
  stateSecret: process.env.VERIFICATION_STATE_SECRET?.trim() ?? "",
};

interface SignedState {
  u: string;
  g: string;
  t: number;
  n: string;
}

interface DiscordOauthUser {
  id: string;
  username: string;
  verified?: boolean;
  email?: string | null;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
}

export interface OAuthVerificationResult {
  ok: boolean;
  message: string;
}

export function oauthVerificationConfigured(): boolean {
  const env = oauthVerificationEnvironment;
  return Boolean(
    /^\d{15,22}$/.test(env.clientId) &&
    env.clientSecret.length >= 16 &&
    /^https?:\/\//i.test(env.redirectUri) &&
    env.stateSecret.length >= 32
  );
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", oauthVerificationEnvironment.stateSecret).update(payload).digest("base64url");
}

export function createVerificationState(guildId: string, userId: string, now = Date.now()): string {
  if (!oauthVerificationConfigured()) throw new Error("OAuth2 de verificação não configurado.");
  const state: SignedState = {
    u: userId,
    g: guildId,
    t: now,
    n: randomBytes(12).toString("base64url"),
  };
  const payload = encodeBase64Url(JSON.stringify(state));
  return `${payload}.${sign(payload)}`;
}

export function verifyVerificationState(value: string, now = Date.now()): SignedState | null {
  if (!oauthVerificationConfigured()) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  const expected = sign(payload);
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SignedState;
    if (!/^\d{15,22}$/.test(decoded.u) || !/^\d{15,22}$/.test(decoded.g)) return null;
    if (!Number.isFinite(decoded.t) || now - decoded.t < -30_000 || now - decoded.t > STATE_TTL_MS) return null;
    if (typeof decoded.n !== "string" || decoded.n.length < 8) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function buildOauthAuthorizationUrl(guildId: string, userId: string): string {
  const state = createVerificationState(guildId, userId);
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", oauthVerificationEnvironment.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", oauthVerificationEnvironment.redirectUri);
  url.searchParams.set("scope", "identify email");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

async function exchangeCode(code: string): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: oauthVerificationEnvironment.clientId,
    client_secret: oauthVerificationEnvironment.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: oauthVerificationEnvironment.redirectUri,
  });
  const response = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const token = await response.json() as TokenResponse;
  return typeof token.access_token === "string" ? token.access_token : null;
}

async function fetchCurrentUser(accessToken: string): Promise<DiscordOauthUser | null> {
  const response = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  return await response.json() as DiscordOauthUser;
}

async function revokeToken(accessToken: string): Promise<void> {
  const body = new URLSearchParams({
    client_id: oauthVerificationEnvironment.clientId,
    client_secret: oauthVerificationEnvironment.clientSecret,
    token: accessToken,
    token_type_hint: "access_token",
  });
  await fetch("https://discord.com/api/v10/oauth2/token/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(8_000),
  }).catch(() => undefined);
}

function htmlPage(title: string, message: string, success: boolean): string {
  const safeTitle = title.replace(/[<>&]/g, "");
  const safeMessage = message.replace(/[<>&]/g, "");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{font-family:system-ui,sans-serif;background:#111214;color:#f2f3f5;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:560px;margin:24px;padding:32px;border-radius:18px;background:#1e1f22;border:1px solid #2b2d31;text-align:center}.icon{font-size:48px}h1{margin:12px 0}p{color:#b5bac1;line-height:1.6}</style></head><body><main class="card"><div class="icon">${success ? "✅" : "❌"}</div><h1>${safeTitle}</h1><p>${safeMessage}</p><p>Você pode fechar esta página e voltar ao Discord.</p></main></body></html>`;
}

export function registerVerificationOAuthRoutes(
  app: express.Express,
  complete: (guildId: string, userId: string, emailVerified: boolean) => Promise<OAuthVerificationResult>,
): void {
  if (!oauthVerificationConfigured()) return;
  let callbackPath = "/auth/discord/callback";
  try {
    callbackPath = new URL(oauthVerificationEnvironment.redirectUri).pathname || callbackPath;
  } catch {
    // A validação da configuração já impedirá uso com URL inválida.
  }

  app.get(callbackPath, async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const stateValue = typeof req.query.state === "string" ? req.query.state : "";
    const state = verifyVerificationState(stateValue);
    if (!code || !state) {
      res.status(400).type("html").send(htmlPage("Verificação inválida", "A solicitação expirou ou não corresponde a uma verificação iniciada no Discord.", false));
      return;
    }

    let accessToken: string | null = null;
    try {
      accessToken = await exchangeCode(code);
      if (!accessToken) {
        res.status(400).type("html").send(htmlPage("Falha na autorização", "O Discord não concluiu a autorização. Inicie a verificação novamente pelo painel.", false));
        return;
      }
      const currentUser = await fetchCurrentUser(accessToken);
      if (!currentUser || currentUser.id !== state.u) {
        res.status(403).type("html").send(htmlPage("Conta diferente", "Autorize a mesma conta do Discord que clicou no botão de verificação.", false));
        return;
      }
      const result = await complete(state.g, state.u, currentUser.verified === true);
      res.status(result.ok ? 200 : 403).type("html").send(htmlPage(result.ok ? "Verificação concluída" : "Verificação recusada", result.message, result.ok));
    } catch (error) {
      console.error("Falha no OAuth2 de verificação:", error);
      res.status(500).type("html").send(htmlPage("Erro temporário", "Não foi possível finalizar a verificação agora. Tente novamente em alguns instantes.", false));
    } finally {
      if (accessToken) void revokeToken(accessToken);
    }
  });
}
