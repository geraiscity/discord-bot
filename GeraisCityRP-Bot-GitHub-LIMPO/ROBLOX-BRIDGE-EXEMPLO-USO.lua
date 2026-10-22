-- Exemplo de uso em um ServerScript.
local ServerScriptService = game:GetService("ServerScriptService")
local GeraisBridge = require(ServerScriptService:WaitForChild("GeraisBridge"))

-- Quando seu sistema de economia alterar dinheiro:
-- local antes = saldo
-- saldo += valor
-- GeraisBridge.LogMoneyChange(player, antes, saldo, "salario_policial")

-- Quando seu sistema de combate souber quem matou quem:
-- GeraisBridge.LogDeath(vitima, {
--     killerUserId = assassino.UserId,
--     killerUsername = assassino.Name,
--     weapon = "Glock 17",
--     cause = "Arma de fogo",
--     location = "Avenida Central",
--     distance = 18.4,
-- })

-- Quando uma ação de staff ocorrer:
-- GeraisBridge.LogStaffAction(staff, "give_money", alvo, "Evento administrativo")

-- Quando detectar exploit:
-- GeraisBridge.LogSecurity(player, "remote_spam", "145 chamadas em 3 segundos")
