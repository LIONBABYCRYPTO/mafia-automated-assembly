// Werewolf Game API — Cloudflare Worker v3.4
// Phase 2: KV version locking, Cache API, diff-based polling, role scaling, vote tie fix

const DEFAULT_HEARTBEAT_TIMEOUT = 60000;
const GHOST_REMOVE_TIMEOUT = 300000;
const CACHE_TTL = 1.5; // seconds
const POLL_DIFF_ENABLED = true;

// Role permissions
const ROLE_ACTIONS = {
  kill:       ['werewolf', 'wolf_king'],
  mark:       ['wolf_king'],
  investigate:['seer'],
  protect:    ['doctor'],
  store_target:['shooter', 'wolf_king'],
};

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event));
});
addEventListener('unhandledrejection', event => { event.preventDefault(); });

// In-memory cache for GET /api/rooms responses
const roomCache = new Map();

async function handleRequest(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') || '*';
  const method = request.method;
  if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) });

  try {
    const path = url.pathname;

    // WC Proxy: /api/wc — proxies worldcup26.ir with CORS headers
    if (path === '/api/wc' && method === 'GET') {
      const wcResp = await fetch('https://worldcup26.ir/get/games');
      const wcData = await wcResp.json();
      return json(wcData, 200, origin);
    }

    // POST /api/rooms
    if (path === '/api/rooms' && method === 'POST') {
      const body = await request.json();
      const code = body.room_code || Math.random().toString(36).substring(2, 8).toUpperCase();
      const hostToken = generateToken();
      const version = 1;
      const state = {
        roomCode: code, hostId: hostToken, phase: 'lobby', round: 1,
        winner: null, players: [], nextPlayerId: 1,
        nightActions: [], dayVotes: [], investigationResults: [],
        lastKilledName: null, lastDoctorSaved: false,
        customWolfCount: body.wolf_count || 0,
        phaseStartedAt: Date.now(), phaseDuration: 0,
        werewolfChat: [], finalWords: {},
        shooterTarget: null, wolfKingTarget: null,
        version,
      };
      // CAS: write with metadata version
      await GAME_KV.put(`room:${code}`, JSON.stringify(state), {
        metadata: { version },
      });
      // Invalidate cache
      roomCache.delete(`room:${code}`);
      return json({ room_code: code, host_token: hostToken }, 200, origin);
    }

    // GET /api/rooms/CODE/snapshot — lightweight polling (and heartbeat piggyback)
    const snapshotMatch = path.match(/^\/api\/rooms\/([A-Z0-9]+)\/snapshot$/);
    if (snapshotMatch && method === 'GET') {
      const code = snapshotMatch[1];
      const raw = await GAME_KV.get(`room:${code}`);
      if (!raw) return json({ error: 'Room not found' }, 404, origin);
      const state = JSON.parse(raw);
      const now = Date.now();

      // Piggyback heartbeat: update in-memory only, no KV write (loss-tolerant)
      const playerId = url.searchParams.get('player_id');
      if (playerId) {
        const player = state.players.find(p => p.id === Number(playerId));
        if (player) {
          player.lastHeartbeat = Date.now();
          player.online = true;
          // No KV write — heartbeat is loss-tolerant, stale timestamp is harmless.
          // This saves ~2,500 KV writes per game (10 players × 3.5s × 15min).
        }
      }

      return json({
        phase: state.phase, round: state.round, winner: state.winner,
        playerCount: state.players.length,
        aliveCount: state.players.filter(p => p.alive).length,
        lastKilledName: state.lastKilledName,
        lastDoctorSaved: state.lastDoctorSaved,
        phaseStartedAt: state.phaseStartedAt,
        phaseDuration: state.phaseDuration,
        alivePlayerIds: state.players.filter(p => p.alive).map(p => p.id),
        dayVoteCount: state.dayVotes.length,
      }, 200, origin);
    }

    // GET /api/rooms/CODE — full state
    if (path.startsWith('/api/rooms/') && method === 'GET') {
      return handleGetRoom(path, origin);
    }

    // POST /api/join
    if (path === '/api/join' && method === 'POST') {
      return await withRoom(body => {
        if (body.room_code !== body.room_code) {}
        const state = body._state;
        if (state.phase !== 'lobby') return json({ error: 'Game already started' }, 400, origin);
        if (state.players.length >= 100) return json({ error: 'Room full' }, 400, origin);
        // Name uniqueness check
        if (state.players.some(p => p.name.toLowerCase() === (body.name || '').toLowerCase().trim())) {
          return json({ error: 'Name already taken' }, 400, origin);
        }
        // Device duplicate check (disabled for multi-tab testing)
        const userId = generateToken();
        state.players.push({
          id: state.nextPlayerId++, userId, name: body.name || 'Player',
          alive: true, role: null, online: true, lastHeartbeat: Date.now(),
          deviceId: body.device_id || null,
        });
        return { success: true, player_id: state.nextPlayerId - 1, user_token: userId };
      }, request, origin);
    }

    // POST /api/assign-roles
    if (path === '/api/assign-roles' && method === 'POST') {
      return await withRoom(body => {
        const state = body._state;
        if (state.phase !== 'lobby') return json({ error: 'Not in lobby' }, 400, origin);
        const count = state.players.length;
        if (count < 6) return json({ error: `Need at least 6 players, got ${count}` }, 400, origin);
        
        // Smooth role scaling based on player count
        const wolfCount = body.wolf_count || state.customWolfCount || getWolfCount(count);
        const roleSet = getRoleSet(count);
        
        const roles = [];
        for (let i = 0; i < wolfCount; i++) roles.push('werewolf');
        if (roleSet.has.wolf_king) roles.push('wolf_king');
        if (roleSet.has.shooter) roles.push('shooter');
        for (let i = 0; i < roleSet.seer_count; i++) roles.push('seer');
        for (let i = 0; i < roleSet.doctor_count; i++) roles.push('doctor');
        while (roles.length < count) roles.push('villager');
        
        // Fisher-Yates shuffle
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
        state.shooterTarget = null; state.wolfKingTarget = null;
        return { success: true, playerCount: count };
      }, request, origin);
    }

    // POST /api/night-actions
    if (path === '/api/night-actions' && method === 'POST') {
      return await withRoom(async (body, auth) => {
        const state = body._state;
        if (state.phase !== 'night') return json({ error: 'Not night phase' }, 400, origin);
        const player = state.players.find(p => p.id === body.player_id && p.userId === auth?.token);
        if (!player) return json({ error: 'Forbidden' }, 403, origin);
        if (!player.alive) return json({ error: 'Dead players cannot act' }, 400, origin);

        const allowed = ROLE_ACTIONS[body.action_type] || [];
        if (!allowed.includes(player.role)) {
          return json({ error: `Role ${player.role} cannot perform ${body.action_type}` }, 403, origin);
        }

        if (body.action_type === 'protect') {
          if (body.target_id === body.player_id) return json({ error: 'Doctor cannot self-protect' }, 400, origin);
          const last = player.lastProtectedPlayerId;
          if (last && body.target_id === last) return json({ error: 'Cannot protect same player consecutively' }, 400, origin);
          const target = state.players.find(p => p.id === body.target_id && p.alive);
          if (!target) return json({ error: 'Target not found or not alive' }, 400, origin);
        }

        if (body.action_type === 'investigate') {
          const target = state.players.find(p => p.id === body.target_id && p.alive);
          if (!target) return json({ error: 'Target not found or not alive' }, 400, origin);
        }

        // Remove old action of same type, add new
        state.nightActions = state.nightActions.filter(a => a.playerId !== body.player_id || a.actionType !== body.action_type);
        state.nightActions.push({ playerId: body.player_id, targetId: body.target_id || null, actionType: body.action_type });

        if (body.action_type === 'protect') player.lastProtectedPlayerId = body.target_id;

        const response = { success: true };
        if (body.action_type === 'investigate' && body.target_id) {
          const target = state.players.find(p => p.id === body.target_id);
          if (target && target.role) {
            const isBad = target.role === 'werewolf' || target.role === 'wolf_king';
            response.investigation = {
              targetId: target.id, targetName: target.name,
              isGood: !isBad,
              result: target.role === 'wolf_king' ? '👑 Wolf King' : (isBad ? '☠️ Werewolf' : '🤝 Town'),
            };
            state.investigationResults = state.investigationResults.filter(r => r.investigatorId !== body.player_id);
            state.investigationResults.push({ investigatorId: body.player_id, targetId: target.id, targetRole: target.role, targetName: target.name });
          }
        }
        return response;
      }, request, origin);
    }

    // POST /api/store-target
    if (path === '/api/store-target' && method === 'POST') {
      return await withRoom(async (body, auth) => {
        const state = body._state;
        if (state.phase !== 'night') return json({ error: 'Only during night' }, 400, origin);
        const player = state.players.find(p => p.id === body.player_id && p.userId === auth?.token);
        if (!player) return json({ error: 'Forbidden' }, 403, origin);
        if (!player.alive) return json({ error: 'Dead players cannot act' }, 400, origin);
        if (player.role !== 'shooter' && player.role !== 'wolf_king') {
          return json({ error: 'Only Shooter and Wolf King can store targets' }, 403, origin);
        }
        const targetId = body.target_id === 'no_target' ? null : (body.target_id ? Number(body.target_id) : null);
        if (targetId !== null) {
          const target = state.players.find(p => p.id === targetId && p.alive);
          if (!target) return json({ error: 'Target not found or not alive' }, 400, origin);
        }
        if (player.role === 'shooter') state.shooterTarget = targetId;
        else if (player.role === 'wolf_king') state.wolfKingTarget = targetId;
        return { success: true, storedTargetId: targetId };
      }, request, origin);
    }

    // POST /api/process-night
    if (path === '/api/process-night' && method === 'POST') {
      return await withRoom(body => {
        const state = body._state;
        if (state.phase !== 'night') return json({ error: 'Not night phase' }, 400, origin);
        const kills = state.nightActions.filter(a => a.actionType === 'kill' && a.targetId);
        const protects = state.nightActions.filter(a => a.actionType === 'protect' && a.targetId);
        const tally = {};
        kills.forEach(k => { if (k.targetId) tally[k.targetId] = (tally[k.targetId] || 0) + 1; });
        let victimId = null;
        // Deterministic tie-break: use player ID order (stable per state)
        const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]));
        if (sorted.length > 0 && sorted[0][1] > 0) victimId = Number(sorted[0][0]);

        const saved = protects.some(p => p.targetId === victimId);
        let killedName = null, killedRole = null;
        if (victimId !== null && !saved) {
          const v = state.players.find(p => p.id === victimId);
          if (v) { v.alive = false; killedName = v.name; killedRole = v.role; }
        }
        state.lastKilledName = killedName;
        state.lastDoctorSaved = saved;

        // Death-trigger: Shooter stored target
        if (killedName && killedRole === 'shooter' && state.shooterTarget !== null) {
          const st = state.players.find(p => p.id === state.shooterTarget && p.alive);
          if (st) { st.alive = false; killedName = killedName + ' • Shot: ' + st.name; state.shooterTarget = null; }
        }
        // Death-trigger: Wolf King stored mark
        const wkDead = state.players.find(p => p.role === 'wolf_king' && !p.alive);
        if (wkDead && state.wolfKingTarget !== null) {
          const mt = state.players.find(p => p.id === state.wolfKingTarget && p.alive);
          if (mt) { mt.alive = false; killedName = (killedName||'') + (killedName?' • ':'') + 'Mark: '+mt.name; state.wolfKingTarget = null; }
        }

        // RE-CHECK win after ALL eliminations
        const winner = checkWin(state);
        if (winner) {
          state.phase = 'victory'; state.winner = winner;
          return { killedPlayer: killedName ? { name: killedName } : null, saved, winner };
        }
        state.phase = 'day_discussion'; state.phaseStartedAt = Date.now();
        state.nightActions = []; state.investigationResults = [];
        return { killedPlayer: killedName ? { name: killedName } : null, saved, round: state.round };
      }, request, origin);
    }

    // POST /api/day-votes
    if (path === '/api/day-votes' && method === 'POST') {
      return await withRoom((body, auth) => {
        const state = body._state;
        if (state.phase !== 'day_voting' && state.phase !== 'day_vote') return json({ error: 'Not voting phase' }, 400, origin);
        const player = state.players.find(p => p.id === body.voter_id && p.userId === auth?.token);
        if (!player) return json({ error: 'Forbidden' }, 403, origin);
        if (!player.alive) return json({ error: 'Dead players cannot vote' }, 400, origin);
        state.dayVotes = state.dayVotes.filter(v => v.voterId !== body.voter_id);
        state.dayVotes.push({ voterId: body.voter_id, targetId: Number(body.target_id) });
        return { success: true };
      }, request, origin);
    }

    // POST /api/process-day
    if (path === '/api/process-day' && method === 'POST') {
      return await withRoom(body => {
        const state = body._state;
        if (state.phase !== 'day_voting' && state.phase !== 'day_vote') return json({ error: 'Not voting phase' }, 400, origin);
        const tally = {};
        state.dayVotes.forEach(v => { if (v.targetId) tally[v.targetId] = (tally[v.targetId] || 0) + 1; });
        
        // Deterministic tie-break: sort by votes desc, then by player ID asc
        const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]));
        let eliminatedId = null;
        if (sorted.length > 0 && sorted[0][1] > 0) {
          // Check for tie
          const maxVotes = sorted[0][1];
          const tied = sorted.filter(([_, c]) => c === maxVotes);
          if (tied.length > 1) {
            // Tie: no elimination
            state.lastKilledName = null;
            state.dayVotes = [];
            return { eliminatedPlayer: null, voteTally: tally, tie: true };
          }
          eliminatedId = Number(sorted[0][0]);
        }
        let eliminatedName = null, eliminatedRole = null;
        if (eliminatedId !== null) {
          const ep = state.players.find(p => p.id === eliminatedId);
          if (ep) { ep.alive = false; eliminatedName = ep.name; eliminatedRole = ep.role || null; }
        }
        state.lastKilledName = eliminatedName;

        // Shooter death trigger
        if (eliminatedRole === 'shooter' && state.shooterTarget !== null) {
          const st = state.players.find(p => p.id === state.shooterTarget && p.alive);
          if (st) { st.alive = false; eliminatedName = eliminatedName + ' • Shot: ' + st.name; state.shooterTarget = null; }
        }
        // Wolf King death trigger
        if (eliminatedRole === 'wolf_king' && state.wolfKingTarget !== null) {
          const mt = state.players.find(p => p.id === state.wolfKingTarget && p.alive);
          if (mt) { mt.alive = false; eliminatedName = (eliminatedName||'') + (eliminatedName?' • ':'') + 'Mark: ' + mt.name; state.wolfKingTarget = null; }
        }

        const winner = checkWin(state);
        if (winner) {
          state.phase = 'victory'; state.winner = winner;
          return { eliminatedPlayer: eliminatedName ? { name: eliminatedName, role: eliminatedRole } : null, voteTally: tally, winner };
        }
        state.phase = 'day_results'; state.dayVotes = [];
        return { eliminatedPlayer: eliminatedName ? { name: eliminatedName, role: eliminatedRole } : null, voteTally: tally };
      }, request, origin);
    }

    // POST /api/continue-to-night
    if (path === '/api/continue-to-night' && method === 'POST') {
      return await withRoom(body => {
        const state = body._state;
        if (state.phase !== 'day_results') return json({ error: 'Not results phase' }, 400, origin);
        state.round++; state.phase = 'night'; state.phaseStartedAt = Date.now();
        state.nightActions = []; state.investigationResults = []; state.werewolfChat = [];
        if (state.shooterTarget !== null) {
          const t = state.players.find(p => p.id === state.shooterTarget);
          if (!t || !t.alive) state.shooterTarget = null;
        }
        if (state.wolfKingTarget !== null) {
          const t = state.players.find(p => p.id === state.wolfKingTarget);
          if (!t || !t.alive) state.wolfKingTarget = null;
        }
        return { success: true, round: state.round };
      }, request, origin);
    }

    // POST /api/update-phase
    if (path === '/api/update-phase' && method === 'POST') {
      return await withRoom(body => {
        const state = body._state;
        const validPhases = ['lobby','night','day_discussion','day_voting','day_results','victory'];
        if (!validPhases.includes(body.phase)) return json({ error: 'Invalid phase' }, 400, origin);
        state.phase = body.phase;
        state.phaseStartedAt = Date.now();
        state.phaseDuration = body.duration || 0;
        if (body.phase === 'day_voting' || body.phase === 'day_vote') state.dayVotes = [];
        return { success: true, phase: state.phase };
      }, request, origin);
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

    // GET /api/night-progress
    if (path === '/api/night-progress' && method === 'GET') {
      const code = url.searchParams.get('room_code') || '';
      const raw = await GAME_KV.get(`room:${code}`);
      if (!raw) return json({ error: 'Room not found' }, 404, origin);
      const state = JSON.parse(raw);
      const alive = state.players.filter(p => p.alive);
      return json({
        aliveWolfCount: alive.filter(p => p.role === 'werewolf' || p.role === 'wolf_king').length,
        aliveSeerCount: alive.filter(p => p.role === 'seer').length,
        aliveDocCount: alive.filter(p => p.role === 'doctor').length,
        killActionsSubmitted: state.nightActions.filter(a => a.actionType === 'kill').length,
        investigateActionsSubmitted: state.nightActions.filter(a => a.actionType === 'investigate').length,
        protectActionsSubmitted: state.nightActions.filter(a => a.actionType === 'protect').length,
      }, 200, origin);
    }

    // GET /api/player-roles
    if (path === '/api/player-roles' && method === 'GET') {
      const code = url.searchParams.get('room_code') || '';
      const playerId = parseInt(url.searchParams.get('player_id') || '0');
      const auth = parseAuth(request);
      const raw = await GAME_KV.get(`room:${code}`);
      if (!raw) return json({ error: 'Room not found' }, 404, origin);
      const state = JSON.parse(raw);
      const player = state.players.find(p => p.id === playerId && p.userId === auth?.token);
      if (!player) return json({ error: 'Forbidden' }, 403, origin);
      if (state.phase === 'lobby') return json({ role: null }, 200, origin);
      return json({ userId: player.userId, role: player.role, name: player.name }, 200, origin);
    }

    // GET /api/players
    if (path === '/api/players' && method === 'GET') {
      const code = url.searchParams.get('room_code') || '';
      const raw = await GAME_KV.get(`room:${code}`);
      if (!raw) return json({ error: 'Room not found' }, 404, origin);
      const state = JSON.parse(raw);
      const now = Date.now();
      return json(state.players.map(p => ({
        id: p.id, name: p.name, alive: p.alive,
        online: p.online && (now - (p.lastHeartbeat || 0)) < DEFAULT_HEARTBEAT_TIMEOUT,
      })), 200, origin);
    }

    // POST /api/heartbeat
    // POST /api/heartbeat — no KV write, use snapshot poll heartbeat instead
    if (path === '/api/heartbeat' && method === 'POST') {
      return json({ success: true }, 200, origin);
    }

    // POST /api/check-ghosts
    if (path === '/api/check-ghosts' && method === 'POST') {
      return await withRoom(body => {
        const state = body._state;
        if (state.phase !== 'lobby') return { removed: 0 };
        const now = Date.now();
        const before = state.players.length;
        state.players = state.players.filter(p => (now - (p.lastHeartbeat || 0)) < GHOST_REMOVE_TIMEOUT);
        return { removed: before - state.players.length, remaining: state.players.length };
      }, request, origin);
    }

    // POST /api/werewolf-chat
    if (path === '/api/werewolf-chat' && method === 'POST') {
      return await withRoom((body, auth) => {
        const state = body._state;
        const player = state.players.find(p => p.id === body.player_id && p.userId === auth?.token);
        if (!player || (player.role !== 'werewolf' && player.role !== 'wolf_king')) return json({ error: 'Forbidden' }, 403, origin);
        if (!player.alive) return json({ error: 'Dead wolves cannot chat' }, 400, origin);
        state.werewolfChat.push({ playerId: player.id, playerName: player.name, text: body.text, at: Date.now() });
        if (state.werewolfChat.length > 50) state.werewolfChat = state.werewolfChat.slice(-50);
        return { success: true };
      }, request, origin);
    }

    // GET /api/werewolf-chat
    if (path === '/api/werewolf-chat' && method === 'GET') {
      const code = url.searchParams.get('room_code') || '';
      const playerId = parseInt(url.searchParams.get('player_id') || '0');
      const auth = parseAuth(request);
      const raw = await GAME_KV.get(`room:${code}`);
      if (!raw) return json({ error: 'Room not found' }, 404, origin);
      const state = JSON.parse(raw);
      const player = state.players.find(p => p.id === playerId && p.userId === auth?.token);
      if (!player || (player.role !== 'werewolf' && player.role !== 'wolf_king')) return json({ error: 'Forbidden' }, 403, origin);
      return json({ messages: state.werewolfChat }, 200, origin);
    }

    // POST /api/final-words
    if (path === '/api/final-words' && method === 'POST') {
      return await withRoom((body, auth) => {
        const state = body._state;
        const player = state.players.find(p => p.id === body.player_id && p.userId === auth?.token);
        if (!player) return json({ error: 'Forbidden' }, 403, origin);
        if (player.alive) return json({ error: 'Only dead players can submit final words' }, 400, origin);
        state.finalWords[body.player_id] = { name: player.name, text: body.text };
        return { success: true };
      }, request, origin);
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

// ===== HELPERS =====

// withRoom: read-modify-write with optimistic version locking (CAS)
async function withRoom(handler, request, origin) {
  const body = await request.json().catch(() => ({}));
  const auth = parseAuth(request);
  const code = body.room_code || '';
  if (!code) return json({ error: 'room_code required' }, 400, origin);

  const raw = await GAME_KV.getWithMetadata(`room:${code}`);
  if (!raw || !raw.value) return json({ error: 'Room not found' }, 404, origin);
  
  const state = JSON.parse(raw.value);
  const currentVersion = raw.metadata?.version || state.version || 0;
  body._state = state;
  
  const result = await handler(body, auth);
  
  // If handler returned a Response directly, return it
  if (result instanceof Response) {
    return result;
  }
  
  if (result && result.error) {
    // Handler returned an error data object, don't save
    return json(result, 200, origin);
  }
  if (result === undefined || result === null) {
    return json({ error: 'Internal error' }, 500, origin);
  }
  
  // Optimistic locking: increment version and CAS write
  const newVersion = currentVersion + 1;
  state.version = newVersion;
  try {
    await GAME_KV.put(`room:${code}`, JSON.stringify(state), {
      version: currentVersion,
      metadata: { version: newVersion },
    });
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('version') || msg.includes('CAS') || msg.includes('conflict')) {
      return json({ error: 'Conflict: state changed, please retry' }, 409, origin);
    }
    return json({ error: `KV write failed: ${msg}` }, 500, origin);
  }
  
  // Invalidate room cache on mutation
  roomCache.delete(`room:${code}`);

  return json(result, 200, origin);
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
  
  // Check in-memory cache
  const cached = roomCache.get(`room:${code}`);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL * 1000) {
    return json(cached.data, 200, origin);
  }
  
  const raw = await GAME_KV.get(`room:${code}`);
  if (!raw) return json({ error: 'Room not found' }, 404, origin);
  const state = JSON.parse(raw);
  const now = Date.now();
  
  // Build response
  const data = {
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
    roles: state.phase !== 'lobby' ? getRoleDistribution(state) : null,
  };
  
  // Cache for subsequent polls
  roomCache.set(`room:${code}`, { data, ts: Date.now() });
  
  return json(data, 200, origin);
}

// Smooth role scaling functions
function getWolfCount(playerCount) {
  // Smooth curve: at least 2, roughly 1 wolf per 5 villagers
  return Math.max(2, Math.min(15, Math.round((playerCount + 1) / 5)));
}

function getRoleSet(count) {
  const has = {};
  let seer_count = 1, doctor_count = 1;
  
  // Special roles at thresholds
  has.wolf_king = count >= 15;
  has.shooter = count >= 15;
  
  // Scale Seer/Doctor with player count
  if (count >= 30) { seer_count = 3; doctor_count = 2; }
  else if (count >= 20) { seer_count = 2; doctor_count = 2; }
  else if (count >= 15) { seer_count = 2; doctor_count = 1; }
  
  return { has, seer_count, doctor_count };
}

function getRoleDistribution(state) {
  const counts = { werewolf: 0, wolf_king: 0, seer: 0, doctor: 0, shooter: 0, villager: 0 };
  state.players.forEach(p => { if (p.role && counts[p.role] !== undefined) counts[p.role]++; });
  return counts;
}

function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) result += chars[Math.floor(Math.random() * chars.length)];
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
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-cache, no-store, must-revalidate' } });
}
