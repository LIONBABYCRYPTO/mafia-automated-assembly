// Mafia Game API — Cloudflare Worker (fetch export format)
// All features: timer sync, player removal, werewolf chat, final words, vote tracking, role config

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    try {
      const path = url.pathname;

      // POST /api/rooms — create room
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
          phaseStartedAt: Date.now(),
          phaseDuration: 0,
          werewolfChat: [],
          finalWords: {},
        };
        await env.GAME_KV.put(`room:${code}`, JSON.stringify(state));
        return json({ room_code: code, host_token: hostToken }, 200, origin);
      }

      // GET /api/rooms/CODE
      if (path.startsWith('/api/rooms/') && method === 'GET') {
        const code = path.replace('/api/rooms/', '');
        const raw = await env.GAME_KV.get(`room:${code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        return json(publicState(JSON.parse(raw)), 200, origin);
      }

      // POST /api/update-phase
      if (path === '/api/update-phase' && method === 'POST') {
        const body = await request.json();
        const raw = await env.GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        state.phase = body.phase;
        state.phaseStartedAt = Date.now();
        state.phaseDuration = body.duration || 0;
        if (body.phase === 'day_voting') state.dayVotes = [];
        await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ success: true, phase: state.phase }, 200, origin);
      }

      // POST /api/players — join
      if (path === '/api/players' && method === 'POST') {
        const body = await request.json();
        const raw = await env.GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const userId = generateToken();
        const id = state.nextPlayerId++;
        state.players.push({ id, userId, name: body.name, alive: true });
        await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ id, player_token: userId }, 200, origin);
      }

      // GET /api/players?room_code=CODE
      if (path === '/api/players' && method === 'GET') {
        const code = url.searchParams.get('room_code') || '';
        const raw = await env.GAME_KV.get(`room:${code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        return json(state.players.map(p => ({ id: p.id, name: p.name, alive: p.alive })), 200, origin);
      }

      // DELETE /api/players — remove player (host only, needs host_token in body)
      if (path === '/api/players' && method === 'DELETE') {
        const body = await request.json();
        const raw = await env.GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        if (state.hostId !== body.host_token) return json({ error: 'Forbidden' }, 403, origin);
        state.players = state.players.filter(p => p.id !== body.player_id);
        await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ success: true }, 200, origin);
      }

      // GET /api/player-roles?room_code=X&player_id=X
      if (path === '/api/player-roles' && method === 'GET') {
        const code = url.searchParams.get('room_code') || '';
        const playerId = parseInt(url.searchParams.get('player_id') || '0');
        const auth = parseAuth(request);
        const raw = await env.GAME_KV.get(`room:${code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const p = state.players.find(p => p.id === playerId && p.userId === auth.token);
        if (!p) return json({ error: 'Forbidden or not found' }, 403, origin);
        return json({ role: p.role || null, alive: p.alive }, 200, origin);
      }

      // POST /api/assign-roles
      if (path === '/api/assign-roles' && method === 'POST') {
        const body = await request.json();
        const raw = await env.GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);

        const count = state.players.length;
        if (count < 6) return json({ error: `Need at least 6 players, got ${count}` }, 400, origin);

        let numWolves = state.customWolfCount || Math.floor(count / 4);
        if (numWolves < 1) numWolves = 1;
        if (numWolves > Math.floor(count / 2)) numWolves = Math.floor(count / 2);

        const roles = [];
        for (let i = 0; i < count; i++) {
          if (i < numWolves) roles.push('werewolf');
          else if (i === numWolves) roles.push('seer');
          else if (i === numWolves + 1) roles.push('doctor');
          else roles.push('villager');
        }
        for (let i = roles.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [roles[i], roles[j]] = [roles[j], roles[i]];
        }
        state.players.forEach((p, i) => p.role = roles[i]);
        state.phase = 'night';
        state.round = 1;
        state.phaseStartedAt = Date.now();
        state.nightActions = [];
        state.dayVotes = [];
        state.investigationResults = [];
        state.lastKilledName = null;
        state.lastDoctorSaved = false;
        state.werewolfChat = [];
        state.finalWords = {};
        await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ success: true, playerCount: count }, 200, origin);
      }

      // POST /api/night-actions
      if (path === '/api/night-actions' && method === 'POST') {
        const body = await request.json();
        const auth = parseAuth(request);
        const raw = await env.GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const player = state.players.find(p => p.id === body.player_id && p.userId === auth.token);
        if (!player) return json({ error: 'Forbidden' }, 403, origin);

        state.nightActions = state.nightActions.filter(a => a.playerId !== body.player_id);
        state.nightActions.push({ playerId: body.player_id, targetId: body.target_id || null, actionType: body.action_type });

        const response = { success: true };
        if (body.action_type === 'investigate' && body.target_id) {
          const target = state.players.find(p => p.id === body.target_id);
          if (target && target.role) {
            response.investigation = { targetId: target.id, targetName: target.name, isWerewolf: target.role === 'werewolf' };
            state.investigationResults = state.investigationResults.filter(r => r.investigatorId !== body.player_id);
            state.investigationResults.push({ investigatorId: body.player_id, targetId: target.id, targetRole: target.role, targetName: target.name });
          }
        }
        await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json(response, 200, origin);
      }

      // POST /api/process-night
      if (path === '/api/process-night' && method === 'POST') {
        const body = await request.json();
        const raw = await env.GAME_KV.get(`room:${body.room_code}`);
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
        let killedName = null;
        if (victimId !== null && !saved) {
          const v = state.players.find(p => p.id === victimId);
          if (v) { v.alive = false; killedName = v.name; }
        }
        state.lastKilledName = killedName;
        state.lastDoctorSaved = saved;

        const winner = checkWin(state);
        if (winner) {
          state.phase = 'victory'; state.winner = winner;
          await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
          return json({ killedPlayer: killedName ? { name: killedName } : null, saved, winner }, 200, origin);
        }

        state.phase = 'day_discussion';
        state.phaseStartedAt = Date.now();
        state.nightActions = [];
        state.investigationResults = [];
        await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ killedPlayer: killedName ? { name: killedName } : null, saved, round: state.round }, 200, origin);
      }

      // POST /api/day-votes
      if (path === '/api/day-votes' && method === 'POST') {
        const body = await request.json();
        const auth = parseAuth(request);
        const raw = await env.GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const player = state.players.find(p => p.id === body.voter_id && p.userId === auth.token);
        if (!player) return json({ error: 'Forbidden' }, 403, origin);
        state.dayVotes = state.dayVotes.filter(v => v.voterId !== body.voter_id);
        state.dayVotes.push({ voterId: body.voter_id, targetId: body.target_id });
        await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ success: true }, 200, origin);
      }

      // GET /api/vote-tally?room_code=CODE
      if (path === '/api/vote-tally' && method === 'GET') {
        const code = url.searchParams.get('room_code') || '';
        const raw = await env.GAME_KV.get(`room:${code}`);
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
        const raw = await env.GAME_KV.get(`room:${body.room_code}`);
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

        const winner = checkWin(state);
        if (winner) {
          state.phase = 'victory'; state.winner = winner;
          await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
          return json({ eliminatedPlayer: eliminatedName ? { name: eliminatedName, role: eliminatedRole } : null, voteTally: tally, winner }, 200, origin);
        }

        state.phase = 'day_results';
        state.dayVotes = [];
        await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ eliminatedPlayer: eliminatedName ? { name: eliminatedName, role: eliminatedRole } : null, voteTally: tally }, 200, origin);
      }

      // POST /api/continue-to-night
      if (path === '/api/continue-to-night' && method === 'POST') {
        const body = await request.json();
        const raw = await env.GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        state.round++;
        state.phase = 'night';
        state.phaseStartedAt = Date.now();
        state.nightActions = [];
        state.investigationResults = [];
        state.werewolfChat = [];
        await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ success: true, round: state.round }, 200, origin);
      }

      // GET /api/night-progress?room_code=CODE
      if (path === '/api/night-progress' && method === 'GET') {
        const code = url.searchParams.get('room_code') || '';
        const raw = await env.GAME_KV.get(`room:${code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const alivePlayers = state.players.filter(p => p.alive);
        return json({
          aliveWolfCount: alivePlayers.filter(p => p.role === 'werewolf').length,
          aliveSeerCount: alivePlayers.filter(p => p.role === 'seer').length,
          aliveDocCount: alivePlayers.filter(p => p.role === 'doctor').length,
          killActionsSubmitted: state.nightActions.filter(a => a.actionType === 'kill').length,
          investigateActionsSubmitted: state.nightActions.filter(a => a.actionType === 'investigate').length,
          protectActionsSubmitted: state.nightActions.filter(a => a.actionType === 'protect').length,
        }, 200, origin);
      }

      // POST /api/werewolf-chat
      if (path === '/api/werewolf-chat' && method === 'POST') {
        const body = await request.json();
        const auth = parseAuth(request);
        const raw = await env.GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const player = state.players.find(p => p.id === body.player_id && p.userId === auth.token);
        if (!player || player.role !== 'werewolf') return json({ error: 'Forbidden' }, 403, origin);
        state.werewolfChat.push({ playerId: player.id, playerName: player.name, text: body.text, at: Date.now() });
        if (state.werewolfChat.length > 50) state.werewolfChat = state.werewolfChat.slice(-50);
        await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ success: true }, 200, origin);
      }

      // GET /api/werewolf-chat?room_code=CODE&player_id=X
      if (path === '/api/werewolf-chat' && method === 'GET') {
        const code = url.searchParams.get('room_code') || '';
        const playerId = parseInt(url.searchParams.get('player_id') || '0');
        const auth = parseAuth(request);
        const raw = await env.GAME_KV.get(`room:${code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const player = state.players.find(p => p.id === playerId && p.userId === auth.token);
        if (!player || player.role !== 'werewolf') return json({ error: 'Forbidden' }, 403, origin);
        return json({ messages: state.werewolfChat }, 200, origin);
      }

      // POST /api/final-words
      if (path === '/api/final-words' && method === 'POST') {
        const body = await request.json();
        const auth = parseAuth(request);
        const raw = await env.GAME_KV.get(`room:${body.room_code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        const player = state.players.find(p => p.id === body.player_id && p.userId === auth.token);
        if (!player) return json({ error: 'Forbidden' }, 403, origin);
        state.finalWords[body.player_id] = { name: player.name, text: body.text };
        await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ success: true }, 200, origin);
      }

      // GET /api/final-words?room_code=CODE
      if (path === '/api/final-words' && method === 'GET') {
        const code = url.searchParams.get('room_code') || '';
        const raw = await env.GAME_KV.get(`room:${code}`);
        if (!raw) return json({ error: 'Room not found' }, 404, origin);
        const state = JSON.parse(raw);
        return json({ finalWords: state.finalWords }, 200, origin);
      }

      return json({ error: 'Not found' }, 404, origin);
    } catch (err) {
      return json({ error: err.message || 'Internal error' }, 500, origin);
    }
  }
};

function checkWin(state) {
  const alive = state.players.filter(p => p.alive);
  const wolves = alive.filter(p => p.role === 'werewolf').length;
  const villagers = alive.length - wolves;
  if (wolves >= villagers && wolves > 0) return 'werewolf';
  if (wolves === 0) return 'village';
  return null;
}

function publicState(state) {
  return {
    roomCode: state.roomCode, phase: state.phase, round: state.round,
    winner: state.winner, playerCount: state.players.length,
    aliveCount: state.players.filter(p => p.alive).length,
    lastKilledName: state.lastKilledName,
    lastDoctorSaved: state.lastDoctorSaved,
    phaseStartedAt: state.phaseStartedAt,
    phaseDuration: state.phaseDuration,
    finalWords: Object.values(state.finalWords || {}),
    players: state.players.map(p => ({ id: p.id, name: p.name, alive: p.alive })),
  };
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
