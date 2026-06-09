// Mafia Game API — KV-backed Pages Functions
// Game state stored as JSON in Workers KV. 2s polling on frontend handles eventual consistency.

interface Player {
  id: number;
  userId: string;
  name: string;
  alive: boolean;
  role?: string;
}

interface NightAction {
  playerId: number;
  targetId: number | null;
  actionType: 'kill' | 'investigate' | 'protect';
}

interface DayVote {
  voterId: number;
  targetId: number;
}

interface GameState {
  roomCode: string;
  hostId: string;
  phase: 'lobby' | 'night' | 'day_discussion' | 'day_voting' | 'victory';
  round: number;
  winner: string | null;
  players: Player[];
  nextPlayerId: number;
  nightActions: NightAction[];
  dayVotes: DayVote[];
}

interface Env {
  GAME_KV: KVNamespace;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') || '*';

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin) });
  }

  try {
    const pathParts = (params as any).path || [];
    const path = '/' + pathParts.join('/');

    // POST /api/rooms — create room
    if (path === '/rooms' && request.method === 'POST') {
      const body: any = await request.json();
      const code = body.room_code || Math.random().toString(36).substring(2, 8).toUpperCase();
      const hostToken = generateToken();

      const state: GameState = {
        roomCode: code, hostId: hostToken, phase: 'lobby', round: 1,
        winner: null, players: [], nextPlayerId: 1,
        nightActions: [], dayVotes: [],
      };
      await env.GAME_KV.put(`room:${code}`, JSON.stringify(state));

      return json({ room_code: code, host_token: hostToken }, 200, origin);
    }

    // GET /api/rooms/CODE — get room state
    if (pathParts.length === 2 && pathParts[0] === 'rooms' && method === 'GET') {
      const code = pathParts[1];
      const raw = await env.GAME_KV.get(`room:${code}`);
      if (!raw) return json({ error: 'Room not found' }, 404, origin);
      const state: GameState = JSON.parse(raw);
      return json(publicState(state), 200, origin);
    }

    // JOIN /api/players — POST with { room_code, name }
    if (path === '/players' && method === 'POST') {
      const body: any = await request.json();
      const code = body.room_code;
      const raw = await env.GAME_KV.get(`room:${code}`);
      if (!raw) return json({ error: 'Room not found' }, 404, origin);

      const state: GameState = JSON.parse(raw);
      const userId = generateToken();
      const id = state.nextPlayerId++;
      state.players.push({ id, userId, name: body.name, alive: true });
      await env.GAME_KV.put(`room:${code}`, JSON.stringify(state));

      return json({ id, player_token: userId }, 200, origin);
    }

    // GET /api/players?room_code=CODE
    if (path === '/players' && method === 'GET') {
      const code = url.searchParams.get('room_code') || '';
      const raw = await env.GAME_KV.get(`room:${code}`);
      if (!raw) return json({ error: 'Room not found' }, 404, origin);
      const state: GameState = JSON.parse(raw);
      return json(state.players.map(p => ({ id: p.id, name: p.name, alive: p.alive })), 200, origin);
    }

    // GET /api/player-roles?player_id=X
    if (path === '/player-roles' && method === 'GET') {
      const code = url.searchParams.get('room_code') || '';
      const playerId = parseInt(url.searchParams.get('player_id') || '0');
      const auth = parseAuth(request);
      const raw = await env.GAME_KV.get(`room:${code}`);
      if (!raw) return json({ error: 'Room not found' }, 404, origin);
      const state: GameState = JSON.parse(raw);
      const p = state.players.find(p => p.id === playerId && p.userId === auth.token);
      if (!p) return json({ error: 'Forbidden or not found' }, 403, origin);
      return json({ role: p.role || null }, 200, origin);
    }

    // POST /api/assign-roles
    if (path === '/assign-roles' && method === 'POST') {
      const body: any = await request.json();
      const raw = await env.GAME_KV.get(`room:${body.room_code}`);
      if (!raw) return json({ error: 'Room not found' }, 404, origin);
      const state: GameState = JSON.parse(raw);

      const count = state.players.length;
      if (count < 6) return json({ error: `Need at least 6 players, got ${count}` }, 400, origin);

      const numWolves = count <= 7 ? 2 : Math.floor(count / 4);
      const roles: string[] = [];
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
      state.nightActions = [];
      state.dayVotes = [];
      await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
      return json({ success: true, playerCount: count }, 200, origin);
    }

    // POST /api/night-actions
    if (path === '/night-actions' && method === 'POST') {
      const body: any = await request.json();
      const auth = parseAuth(request);
      const raw = await env.GAME_KV.get(`room:${body.room_code}`);
      if (!raw) return json({ error: 'Room not found' }, 404, origin);
      const state: GameState = JSON.parse(raw);
      const player = state.players.find(p => p.id === body.player_id && p.userId === auth.token);
      if (!player) return json({ error: 'Forbidden' }, 403, origin);

      state.nightActions = state.nightActions.filter(a => a.playerId !== body.player_id);
      state.nightActions.push({ playerId: body.player_id, targetId: body.target_id || null, actionType: body.action_type });
      await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
      return json({ success: true }, 200, origin);
    }

    // POST /api/process-night
    if (path === '/process-night' && method === 'POST') {
      const body: any = await request.json();
      const raw = await env.GAME_KV.get(`room:${body.room_code}`);
      if (!raw) return json({ error: 'Room not found' }, 404, origin);
      const state: GameState = JSON.parse(raw);

      const kills = state.nightActions.filter(a => a.actionType === 'kill' && a.targetId);
      const protects = state.nightActions.filter(a => a.actionType === 'protect' && a.targetId);

      const tally: Record<number, number> = {};
      kills.forEach(k => { if (k.targetId) tally[k.targetId] = (tally[k.targetId] || 0) + 1; });
      let victimId: number | null = null, maxVotes = 0;
      for (const [id, c] of Object.entries(tally)) {
        if (c > maxVotes) { maxVotes = c; victimId = Number(id); }
      }

      const saved = protects.some(p => p.targetId === victimId);
      let killedName: string | null = null;
      if (victimId !== null && !saved) {
        const v = state.players.find(p => p.id === victimId);
        if (v) { v.alive = false; killedName = v.name; }
      }

      const winner = checkWin(state);
      if (winner) {
        state.phase = 'victory'; state.winner = winner;
        await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
        return json({ killedPlayer: killedName ? { name: killedName } : null, saved, winner }, 200, origin);
      }

      state.phase = 'day_discussion';
      state.nightActions = [];
      await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
      return json({ killedPlayer: killedName ? { name: killedName } : null, saved }, 200, origin);
    }

    // POST /api/day-votes
    if (path === '/day-votes' && method === 'POST') {
      const body: any = await request.json();
      const auth = parseAuth(request);
      const raw = await env.GAME_KV.get(`room:${body.room_code}`);
      if (!raw) return json({ error: 'Room not found' }, 404, origin);
      const state: GameState = JSON.parse(raw);
      const player = state.players.find(p => p.id === body.voter_id && p.userId === auth.token);
      if (!player) return json({ error: 'Forbidden' }, 403, origin);

      state.dayVotes = state.dayVotes.filter(v => v.voterId !== body.voter_id);
      state.dayVotes.push({ voterId: body.voter_id, targetId: body.target_id });
      await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
      return json({ success: true }, 200, origin);
    }

    // POST /api/process-day
    if (path === '/process-day' && method === 'POST') {
      const body: any = await request.json();
      const raw = await env.GAME_KV.get(`room:${body.room_code}`);
      if (!raw) return json({ error: 'Room not found' }, 404, origin);
      const state: GameState = JSON.parse(raw);

      const tally: Record<number, number> = {};
      state.dayVotes.forEach(v => { if (v.targetId) tally[v.targetId] = (tally[v.targetId] || 0) + 1; });
      let eliminatedId: number | null = null, maxVotes = 0;
      for (const [id, c] of Object.entries(tally)) {
        if (c > maxVotes) { maxVotes = c; eliminatedId = Number(id); }
      }

      let eliminatedName: string | null = null, eliminatedRole: string | null = null;
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

      state.round++;
      state.phase = 'night';
      state.dayVotes = [];
      state.nightActions = [];
      await env.GAME_KV.put(`room:${body.room_code}`, JSON.stringify(state));
      return json({ eliminatedPlayer: eliminatedName ? { name: eliminatedName, role: eliminatedRole } : null, voteTally: tally }, 200, origin);
    }

    return json({ error: 'Not found' }, 404, origin);
  } catch (err: any) {
    return json({ error: err.message || 'Internal error' }, 500, origin);
  }
};

function checkWin(state: GameState): string | null {
  const alive = state.players.filter(p => p.alive);
  const wolves = alive.filter(p => p.role === 'werewolf').length;
  const villagers = alive.length - wolves;
  if (wolves >= villagers && wolves > 0) return 'werewolf';
  if (wolves === 0) return 'village';
  return null;
}

function publicState(state: GameState) {
  return {
    roomCode: state.roomCode, phase: state.phase, round: state.round,
    winner: state.winner, playerCount: state.players.length,
    aliveCount: state.players.filter(p => p.alive).length,
    players: state.players.map(p => ({ id: p.id, name: p.name, alive: p.alive })),
  };
}

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function parseAuth(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return { userId: null, token: auth.slice(7) };
  return { userId: null, token: null };
}

function json(data: any, status = 200, origin = '*'): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}
