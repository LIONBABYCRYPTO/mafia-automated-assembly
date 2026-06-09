// Werewolf Game API — Cloudflare Worker
// v3.0 — Online/offline detection, heartbeat, auto-remove ghosts, branding

const DEFAULT_HEARTBEAT_TIMEOUT = 60000; // 60s inactivity = offline
const GHOST_REMOVE_TIMEOUT = 300000;     // 5min offline = removed (lobby only)

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event));
});

addEventListener('unhandledrejection', event => {
  event.preventDefault();
});

async function handleRequest(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    try {
      const path = url.pathname;

      // POST /api/rooms
      if (path === '/api/rooms' && method === 'POST') {
        const body = await request.json();
        const code = body.room_code || Math.random().toString(36).substring(2, 8).toUpperCase();
        const hostToken = generateToken();
        const wolfCount = body.wolf_count || 0;

        const state = {
          roomCode: code, hostId: hostToken, phase: 'lobby', round: 1,
          winner: null, players: [], nextPlayerId: 1,
          nightActions: [], dayVotes: [], investigationResults: [],
          lastKilledName: null, lastDoctorSaved: false,
          customWolfCount: wolfCount,
          phaseStartedAt: Date.now(), phaseDuration: 0,
          werewolfChat: [], finalWords: {},
          lastWolfKingMark: null, shooterRevengePending: null,
        };
        await GAME_KV.put(`room:${code}`, JSON.stringify(state));
        return json({ room_code: code, host_token: hostToken }, 200, origin);
      }

      // GET /api/rooms/CODE
      if (path.startsWith('/api/rooms/') && method === 'GET') {
        return handleGetRoom(path, origin);
      }

      // POST /api/update-phase
      if (path === '/api/update-phase' && method === 'POST') {
        const body = await request.json();
        const raw = await GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        state.phase = body.phase;
        state.phaseStartedAt = Date.now();
        state.phaseDuration = body.duration || 0;
        if (body.phase === 'day_voting') state.dayVotes = [];
        await GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ success: true, phase: state.phase }, 200, origin);
      }

      // POST /api/players — join
      if (path === '/api/players' && method === 'POST') {
        const body = await request.json();
        const raw = await GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        // Remove old ghosts before adding new
        state.players = state.players.filter(p => p.alive || p.role);
        const userId = generateToken();
        const id = state.nextPlayerId++;
        state.players.push({ id, userId, name: body.name, alive: true, lastHeartbeat: Date.now(), online: true, joinedAt: Date.now() });
        await GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ id, player_token: userId }, 200, origin);
      }

      // POST /api/heartbeat — online/offline ping
      if (path === '/api/heartbeat' && method === 'POST') {
        const body = await request.json();
        const raw = await GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const player = state.players.find(p => p.id === body.player_id);
        if (player) {
          player.lastHeartbeat = Date.now();
          player.online = true;
          await GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
          return json({ success: true }, 200, origin);
        }
        return json({ error: 'Player not found' }, 404, origin);
      }

      // POST /api/check-ghosts — sweep offline players in lobby
      if (path === '/api/check-ghosts' && method === 'POST') {
        const body = await request.json();
        const raw = await GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        if (state.phase !== 'lobby') return json({ success: true, count: 0 }, 200, origin);
        const now = Date.now();
        const before = state.players.length;
        state.players = state.players.filter(p => {
          if (!p.online && (now - (p.lastHeartbeat || 0)) > GHOST_REMOVE_TIMEOUT) return false;
          if ((now - (p.lastHeartbeat || 0)) > DEFAULT_HEARTBEAT_TIMEOUT) p.online = false;
          return true;
        });
        await GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ success: true, removed: before - state.players.length }, 200, origin);
      }

      // GET /api/player-online — check online status (host-side)
      if (path === '/api/player-online' && method === 'GET') {
        const code = url.searchParams.get('room_code') || '';
        const raw = await GAME_KV.get(`room:${code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const now = Date.now();
        const result = state.players.map(p => ({
          id: p.id, name: p.name, alive: p.alive,
          online: p.online && (now - (p.lastHeartbeat || 0)) < DEFAULT_HEARTBEAT_TIMEOUT,
          lastSeen: p.lastHeartbeat || 0,
        }));
        return json(result, 200, origin);
      }

      // GET /api/players
      if (path === '/api/players' && method === 'GET') {
        const code = url.searchParams.get('room_code') || '';
        const raw = await GAME_KV.get(`room:${code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        return json(state.players.map(p => ({ id: p.id, name: p.name, alive: p.alive })), 200, origin);
      }

      // DELETE /api/players
      if (path === '/api/players' && method === 'DELETE') {
        const body = await request.json();
        const raw = await GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        if (state.hostId !== body.host_token) return json({ error: 'Forbidden' }, 403, origin);
        state.players = state.players.filter(p => p.id !== body.player_id);
        await GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ success: true }, 200, origin);
      }

      // GET /api/player-roles
      if (path === '/api/player-roles' && method === 'GET') {
        const code = url.searchParams.get('room_code') || '';
        const playerId = parseInt(url.searchParams.get('player_id') || '0');
        const auth = parseAuth(request);
        const raw = await GAME_KV.get(`room:${code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const p = state.players.find(p => p.id === playerId && p.userId === auth.token);
        if (!p) return json({ error: 'Forbidden or not found' }, 403, origin);
        return json({ role: p.role || null, alive: p.alive }, 200, origin);
      }

      // POST /api/assign-roles
      if (path === '/api/assign-roles' && method === 'POST') {
        const body = await request.json();
        const raw = await GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const count = state.players.length;
        if (count < 6) return json({ error: `Need at least 6 players, got ${count}` }, 400, origin);

        let numWolves = body.wolf_count || state.customWolfCount || Math.floor(count / 4);
        if (numWolves < 1) numWolves = 1;
        if (numWolves > Math.floor(count / 2)) numWolves = Math.floor(count / 2);

        const hasExpanded = count >= 12;
        const roles = [];

        if (hasExpanded) {
          let wolfCount = Math.max(1, numWolves - 1);
          for (let i = 0; i < count; i++) {
            if (i < wolfCount) roles.push('werewolf');
            else if (i === wolfCount) roles.push('wolf_king');
            else if (i === wolfCount + 1) roles.push('seer');
            else if (i === wolfCount + 2) roles.push('doctor');
            else if (i === wolfCount + 3) roles.push('shooter');
            else roles.push('villager');
          }
        } else {
          for (let i = 0; i < count; i++) {
            if (i < numWolves) roles.push('werewolf');
            else if (i === numWolves) roles.push('seer');
            else if (i === numWolves + 1) roles.push('doctor');
            else roles.push('villager');
          }
        }

        for (let i = roles.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [roles[i], roles[j]] = [roles[j], roles[i]];
        }

        state.players.forEach((p, i) => { p.role = roles[i]; p.online = true; p.lastHeartbeat = Date.now(); });
        state.phase = 'night'; state.round = 1;
        state.phaseStartedAt = Date.now();
        state.nightActions = []; state.dayVotes = []; state.investigationResults = [];
        state.lastKilledName = null; state.lastDoctorSaved = false;
        state.werewolfChat = []; state.finalWords = {};
        state.lastWolfKingMark = null; state.shooterRevengePending = null;
        await GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ success: true, playerCount: count, hasExpandedRoles: hasExpanded }, 200, origin);
      }

      // POST /api/night-actions
      if (path === '/api/night-actions' && method === 'POST') {
        const body = await request.json();
        const auth = parseAuth(request);
        const raw = await GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const player = state.players.find(p => p.id === body.player_id && p.userId === auth.token);
        if (!player) return json({ error: 'Forbidden' }, 403, origin);

        const response = { success: true };

        if (body.action_type === 'protect') {
          if (body.target_id === body.player_id) {
            return json({ error: 'Doctor cannot protect themselves' }, 400, origin);
          }
          const lastProtected = player.lastProtectedPlayerId;
          if (lastProtected && body.target_id === lastProtected) {
            return json({ error: 'Doctor cannot protect the same player on consecutive nights' }, 400, origin);
          }
        }

        if (body.action_type === 'mark' && body.target_id) {
          state.lastWolfKingMark = body.target_id;
        }

        state.nightActions = state.nightActions.filter(a => a.playerId !== body.player_id || a.actionType !== body.action_type);
        state.nightActions.push({ playerId: body.player_id, targetId: body.target_id || null, actionType: body.action_type });

        if (body.action_type === 'protect') {
          player.lastProtectedPlayerId = body.target_id;
        }

        if (body.action_type === 'investigate' && body.target_id) {
          const target = state.players.find(p => p.id === body.target_id);
          if (target && target.role) {
            const isBad = target.role === 'werewolf' || target.role === 'wolf_king';
            response.investigation = { targetId: target.id, targetName: target.name, isGood: !isBad, result: isBad ? '☠️ Bad' : '🤝 Good' };
            state.investigationResults = state.investigationResults.filter(r => r.investigatorId !== body.player_id);
            state.investigationResults.push({ investigatorId: body.player_id, targetId: target.id, targetRole: target.role, targetName: target.name });
          }
        }

        await GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json(response, 200, origin);
      }

      // POST /api/process-night
      if (path === '/api/process-night' && method === 'POST') {
        const body = await request.json();
        const raw = await GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);

        const kills = state.nightActions.filter(a => a.actionType === 'kill' && a.targetId);
        const protects = state.nightActions.filter(a => a.actionType === 'protect' && a.targetId);

        const tally = {};
        kills.forEach(k => { if (k.targetId) tally[k.targetId] = (tally[k.targetId] || 0) + 1; });
        let victimId = null, maxVotes = 0;
        for (const [id, c] of Object.entries(tally)) {
          if (c > maxVotes) { maxVotes = c; victimId = Number(id); }
        }

        const saved = protects.some(p => p.targetId === victimId);
        let killedName = null, killedRole = null;
        if (victimId !== null && !saved) {
          const v = state.players.find(p => p.id === victimId);
          if (v) { v.alive = false; killedName = v.name; killedRole = v.role; }
        }
        state.lastKilledName = killedName;
        state.lastDoctorSaved = saved;

        if (killedName && killedRole === 'shooter') {
          state.shooterRevengePending = victimId;
        }

        const wolfKing = state.players.find(p => p.role === 'wolf_king' && !p.alive);
        if (wolfKing && state.lastWolfKingMark) {
          const markedTarget = state.players.find(p => p.id === state.lastWolfKingMark && p.alive);
          if (markedTarget) {
            markedTarget.alive = false;
            killedName = (killedName || '') + ' • Via Mark: ' + markedTarget.name;
            state.lastWolfKingMark = null;
          }
        }

        const winner = checkWin(state);
        if (winner) {
          state.phase = 'victory'; state.winner = winner;
          const result = { killedPlayer: killedName ? { name: killedName } : null, saved, winner };
          if (state.shooterRevengePending) result.shooterRevengePending = true;
          await GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
          return json(result, 200, origin);
        }

        state.phase = 'day_discussion';
        state.phaseStartedAt = Date.now();
        if (state.shooterRevengePending) {
          state.phase = 'night';
          state.phaseStartedAt = Date.now();
        } else {
          state.nightActions = [];
          state.investigationResults = [];
        }

        await GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ killedPlayer: killedName ? { name: killedName } : null, saved, round: state.round, shooterRevengePending: !!state.shooterRevengePending }, 200, origin);
      }

      // POST /api/shooter-revenge
      if (path === '/api/shooter-revenge' && method === 'POST') {
        const body = await request.json();
        const auth = parseAuth(request);
        const raw = await GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const player = state.players.find(p => p.id === body.player_id && p.userId === auth.token);
        if (!player) return json({ error: 'Forbidden' }, 403, origin);
        if (!state.shooterRevengePending || state.shooterRevengePending !== body.player_id) {
          return json({ error: 'No revenge shot pending' }, 400, origin);
        }
        const target = state.players.find(p => p.id === body.target_id && p.alive);
        if (!target) return json({ error: 'Target not found or dead' }, 400, origin);
        target.alive = false;
        state.shooterRevengePending = null;
        state.lastKilledName = target.name;
        const winner = checkWin(state);
        if (winner) {
          state.phase = 'victory'; state.winner = winner;
          await GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
          return json({ killedPlayer: { name: target.name }, winner }, 200, origin);
        }
        state.phase = 'day_discussion';
        state.phaseStartedAt = Date.now();
        state.nightActions = [];
        state.investigationResults = [];
        await GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ killedPlayer: { name: target.name }, saved: false, round: state.round }, 200, origin);
      }

      // POST /api/day-votes
      if (path === '/api/day-votes' && method === 'POST') {
        const body = await request.json();
        const auth = parseAuth(request);
        const raw = await GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const player = state.players.find(p => p.id === body.voter_id && p.userId === auth.token);
        if (!player) return json({ error: 'Forbidden' }, 403, origin);
        state.dayVotes = state.dayVotes.filter(v => v.voterId !== body.voter_id);
        state.dayVotes.push({ voterId: body.voter_id, targetId: body.target_id });
        await GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ success: true }, 200, origin);
      }

      // GET /api/vote-tally
      if (path === '/api/vote-tally' && method === 'GET') {
        const code = url.searchParams.get('room_code') || '';
        const raw = await GAME_KV.get(`room:${code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const tally = {};
        state.dayVotes.forEach(v => { if (v.targetId) tally[v.targetId] = (tally[v.targetId] || 0) + 1; });
        const nameMap = {};
        state.players.forEach(p => { nameMap[p.id] = p.name; });
        const result = Object.keys(tally).map(id => ({
          playerId: Number(id), playerName: nameMap[Number(id)] || 'Unknown', votes: tally[id],
        })).sort((a, b) => b.votes - a.votes);
        return json({ tally: result, totalVotes: state.dayVotes.length, totalPlayers: state.players.filter(p => p.alive).length }, 200, origin);
      }

      // POST /api/process-day
      if (path === '/api/process-day' && method === 'POST') {
        const body = await request.json();
        const raw = await GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const tally = {};
        state.dayVotes.forEach(v => { if (v.targetId) tally[v.targetId] = (tally[v.targetId] || 0) + 1; });
        let eliminatedId = null, maxVotes = 0;
        for (const [id, c] of Object.entries(tally)) {
          if (c > maxVotes) { maxVotes = c; eliminatedId = Number(id); }
        }
        let eliminatedName = null, eliminatedRole = null;
        if (eliminatedId !== null) {
          const ep = state.players.find(p => p.id === eliminatedId);
          if (ep) { ep.alive = false; eliminatedName = ep.name; eliminatedRole = ep.role || null; }
        }
        state.lastKilledName = eliminatedName;

        if (eliminatedRole === 'shooter') state.shooterRevengePending = eliminatedId;

        if (eliminatedRole === 'wolf_king' && state.lastWolfKingMark) {
          const markedTarget = state.players.find(p => p.id === state.lastWolfKingMark && p.alive);
          if (markedTarget) {
            markedTarget.alive = false;
            eliminatedName = 'Via Mark: ' + markedTarget.name;
            state.lastWolfKingMark = null;
          }
        }

        const winner = checkWin(state);
        if (winner) {
          state.phase = 'victory'; state.winner = winner;
          await GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
          return json({ eliminatedPlayer: eliminatedName ? { name: eliminatedName, role: eliminatedRole } : null, voteTally: tally, winner }, 200, origin);
        }
        state.phase = 'day_results';
        state.dayVotes = [];
        await GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ eliminatedPlayer: eliminatedName ? { name: eliminatedName, role: eliminatedRole } : null, voteTally: tally, shooterRevengePending: eliminatedRole === 'shooter' }, 200, origin);
      }

      // POST /api/continue-to-night
      if (path === '/api/continue-to-night' && method === 'POST') {
        const body = await request.json();
        const raw = await GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        state.round++;
        state.phase = 'night';
        state.phaseStartedAt = Date.now();
        state.nightActions = [];
        state.investigationResults = [];
        state.werewolfChat = [];
        await GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ success: true, round: state.round }, 200, origin);
      }

      // GET /api/night-progress
      if (path === '/api/night-progress' && method === 'GET') {
        const code = url.searchParams.get('room_code') || '';
        const raw = await GAME_KV.get(`room:${code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const alivePlayers = state.players.filter(p => p.alive);
        return json({
          aliveWolfCount: alivePlayers.filter(p => p.role === 'werewolf' || p.role === 'wolf_king').length,
          aliveSeerCount: alivePlayers.filter(p => p.role === 'seer').length,
          aliveDocCount: alivePlayers.filter(p => p.role === 'doctor').length,
          aliveWolfKingCount: alivePlayers.filter(p => p.role === 'wolf_king').length,
          killActionsSubmitted: state.nightActions.filter(a => a.actionType === 'kill' || a.actionType === 'mark').length,
          investigateActionsSubmitted: state.nightActions.filter(a => a.actionType === 'investigate').length,
          protectActionsSubmitted: state.nightActions.filter(a => a.actionType === 'protect').length,
          shooterRevengePending: !!state.shooterRevengePending,
        }, 200, origin);
      }

      // GET /api/check-restrictions
      if (path === '/api/check-restrictions' && method === 'GET') {
        const code = url.searchParams.get('room_code') || '';
        const playerId = parseInt(url.searchParams.get('player_id') || '0');
        const raw = await GAME_KV.get(`room:${code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const player = state.players.find(p => p.id === playerId);
        return json({
          lastProtectedPlayerId: player ? player.lastProtectedPlayerId || null : null,
          shooterRevengePending: !!state.shooterRevengePending,
          canUseRevenge: state.shooterRevengePending === playerId,
          wolfKingMark: state.lastWolfKingMark,
        }, 200, origin);
      }

      // POST /api/werewolf-chat
      if (path === '/api/werewolf-chat' && method === 'POST') {
        const body = await request.json();
        const auth = parseAuth(request);
        const raw = await GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const player = state.players.find(p => p.id === body.player_id && p.userId === auth.token);
        if (!player || (player.role !== 'werewolf' && player.role !== 'wolf_king')) return json({ error: 'Forbidden' }, 403, origin);
        state.werewolfChat.push({ playerId: player.id, playerName: player.name, text: body.text, at: Date.now() });
        if (state.werewolfChat.length > 50) state.werewolfChat = state.werewolfChat.slice(-50);
        await GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ success: true }, 200, origin);
      }

      // GET /api/werewolf-chat
      if (path === '/api/werewolf-chat' && method === 'GET') {
        const code = url.searchParams.get('room_code') || '';
        const playerId = parseInt(url.searchParams.get('player_id') || '0');
        const auth = parseAuth(request);
        const raw = await GAME_KV.get(`room:${code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const player = state.players.find(p => p.id === playerId && p.userId === auth.token);
        if (!player || (player.role !== 'werewolf' && player.role !== 'wolf_king')) return json({ error: 'Forbidden' }, 403, origin);
        return json({ messages: state.werewolfChat }, 200, origin);
      }

      // POST /api/final-words
      if (path === '/api/final-words' && method === 'POST') {
        const body = await request.json();
        const auth = parseAuth(request);
        const raw = await GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const player = state.players.find(p => p.id === body.player_id && p.userId === auth.token);
        if (!player) return json({ error: 'Forbidden' }, 403, origin);
        state.finalWords[body.player_id] = { name: player.name, text: body.text };
        await GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ success: true }, 200, origin);
      }

      // GET /api/final-words
      if (path === '/api/final-words' && method === 'GET') {
        const code = url.searchParams.get('room_code') || '';
        const raw = await GAME_KV.get(`room:${code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        return json({ finalWords: state.finalWords }, 200, origin);
      }

      return json({ error: 'Not found' }, 404, origin);
    } catch (err) {
      return json({ error: err.message || 'Internal error' }, 500, origin);
    }
}

function checkWin(state) {
  const alive = state.players.filter(p => p.alive);
  const wolves = alive.filter(p => p.role === 'werewolf' || p.role === 'wolf_king').length;
  const villagers = alive.length - wolves;
  if (wolves >= villagers && wolves > 0) return 'werewolf';
  if (wolves === 0) return 'village';
  return null;
}

async function handleGetRoom(path, origin) {
  const code = path.replace('/api/rooms/', '');
  const raw = await GAME_KV.get(`room:${code}`);
  if (!raw) return json({ error: 'Room not found' }, 404, origin);
  const state = JSON.parse(raw);
  const now = Date.now();
  const onlinePlayers = state.players.map(p => ({
    ...p,
    online: p.online && (now - (p.lastHeartbeat || 0)) < DEFAULT_HEARTBEAT_TIMEOUT,
  }));
  return json({
    roomCode: state.roomCode, phase: state.phase, round: state.round,
    winner: state.winner, playerCount: state.players.length,
    aliveCount: state.players.filter(p => p.alive).length,
    lastKilledName: state.lastKilledName,
    lastDoctorSaved: state.lastDoctorSaved,
    phaseStartedAt: state.phaseStartedAt,
    phaseDuration: state.phaseDuration,
    finalWords: Object.values(state.finalWords || {}),
    players: state.players.map(p => ({
      id: p.id, name: p.name, alive: p.alive,
      online: p.online && (now - (p.lastHeartbeat || 0)) < DEFAULT_HEARTBEAT_TIMEOUT,
      role: state.phase !== 'lobby' && !p.alive ? p.role : undefined,
    })),
    shooterRevengePending: !!state.shooterRevengePending,
    roles: state.phase !== 'lobby' ? getRoleDistribution(state) : null,
  }, 200, origin);
}

function getRoleDistribution(state) {
  const counts = { werewolf: 0, wolf_king: 0, seer: 0, doctor: 0, shooter: 0, villager: 0 };
  state.players.forEach(p => {
    if (p.role && counts[p.role] !== undefined) counts[p.role]++;
  });
  return counts;
}

function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

function corsHeaders(origin) {
  return { 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
}

function parseAuth(req) {
  const auth = req.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return { userId: null, token: auth.slice(7) };
  return { userId: null, token: null };
}

function json(data, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
}
