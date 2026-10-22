# Roblox Bridge — configuração rápida

1. No host do bot, crie `ROBLOX_BRIDGE_SECRET` com uma chave aleatória forte.
2. Configure `GERAIS_LOG_CHANNEL_ID`, `SECURITY_ALERT_CHANNEL_ID` e `TRANSCRIPT_CHANNEL_ID` com os IDs dos três canais privados.
3. Publique o bot em um endpoint HTTPS estável e copie a URL pública.
4. No Roblox Studio, habilite HTTP Requests.
5. Coloque `ROBLOX-BRIDGE-SERVER.lua` como ModuleScript dentro de `ServerScriptService`, com nome `GeraisBridge`.
6. No ModuleScript, troque `BRIDGE_URL` e `BRIDGE_SECRET`.
7. Nos scripts server-side de economia/combate, chame:
   - `GeraisBridge.LogMoneyChange(player, saldoAntes, saldoDepois, "origem")`
   - `GeraisBridge.LogDeath(vitima, {...})`
   - `GeraisBridge.LogStaffAction(...)`
   - `GeraisBridge.LogSecurity(...)`

O bot não precisa receber o token do Discord dentro do Roblox. O Roblox conhece apenas a chave do Bridge.

Limiares padrão:
- R$ 100.000: atenção
- R$ 500.000: suspeito
- R$ 1.000.000: crítico

Eles podem ser alterados pelos Secrets `ROBLOX_MONEY_WARNING`, `ROBLOX_MONEY_SUSPICIOUS` e `ROBLOX_MONEY_CRITICAL`.
