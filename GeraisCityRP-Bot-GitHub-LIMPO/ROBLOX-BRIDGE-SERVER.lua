-- Gerais City RP • Roblox -> Discord Bridge
-- Coloque este ModuleScript em ServerScriptService.
-- NUNCA coloque a chave em LocalScript, ReplicatedStorage ou qualquer lugar replicado ao cliente.
-- Ative: Game Settings > Security > Allow HTTP Requests.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")

local Bridge = {}

-- Troque pela URL pública do seu bot/deployment (sem barra no final).
local BRIDGE_URL = "https://SEU-DOMINIO.replit.app"
-- Use o mesmo valor do Secret ROBLOX_BRIDGE_SECRET configurado no host do bot.
local BRIDGE_SECRET = "COLOQUE_UMA_CHAVE_FORTE_AQUI"

local function playerInfo(player)
	if not player then return nil end
	return {
		userId = tostring(player.UserId),
		username = player.Name,
		displayName = player.DisplayName,
	}
end

local function serverInfo()
	return {
		jobId = game.JobId,
		placeId = tostring(game.PlaceId),
		name = game.PrivateServerId ~= "" and "Servidor privado" or "Servidor público",
	}
end

function Bridge.Send(eventName, severity, player, data)
	assert(typeof(eventName) == "string", "eventName precisa ser string")
	local payload = {
		eventId = HttpService:GenerateGUID(false),
		event = eventName,
		severity = severity or "info",
		player = playerInfo(player),
		server = serverInfo(),
		data = data or {},
	}

	local ok, result = pcall(function()
		return HttpService:RequestAsync({
			Url = BRIDGE_URL .. "/api/roblox/events",
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["X-Gerais-Bridge-Key"] = BRIDGE_SECRET,
			},
			Body = HttpService:JSONEncode(payload),
		})
	end)

	if not ok then
		warn("[Gerais Bridge] Falha HTTP:", result)
		return false
	end
	if not result.Success then
		warn("[Gerais Bridge] API recusou:", result.StatusCode, result.Body)
		return false
	end
	return true
end

function Bridge.LogDeath(victim, info)
	info = info or {}
	return Bridge.Send("player.death", "info", victim, {
		killerUserId = info.killerUserId,
		killerUsername = info.killerUsername,
		killerName = info.killerName,
		weapon = info.weapon,
		cause = info.cause,
		location = info.location,
		distance = info.distance,
	})
end

function Bridge.LogMoneyChange(player, balanceBefore, balanceAfter, source)
	local delta = balanceAfter - balanceBefore
	return Bridge.Send("economy.transaction", "info", player, {
		balanceBefore = balanceBefore,
		balanceAfter = balanceAfter,
		delta = delta,
		source = source or "nao_informada",
	})
end

function Bridge.LogStaffAction(staffPlayer, action, targetPlayer, reason)
	return Bridge.Send("staff.action", "info", staffPlayer, {
		action = action,
		targetUserId = targetPlayer and tostring(targetPlayer.UserId) or nil,
		targetUsername = targetPlayer and targetPlayer.Name or nil,
		reason = reason,
	})
end

function Bridge.LogSecurity(player, reason, details)
	return Bridge.Send("security.exploit", "critical", player, {
		reason = reason,
		details = details,
	})
end

function Bridge.LogSystemError(details)
	return Bridge.Send("system.error", "warning", nil, {
		details = tostring(details),
	})
end

-- Opcional: eventos de entrada/saída ficam no histórico do Bridge.
Players.PlayerAdded:Connect(function(player)
	task.spawn(function()
		Bridge.Send("player.join", "info", player, {})
	end)
end)

Players.PlayerRemoving:Connect(function(player)
	task.spawn(function()
		Bridge.Send("player.leave", "info", player, {})
	end)
end)

return Bridge
