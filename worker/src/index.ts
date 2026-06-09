import { D1Database, Request as CfRequest } from '@cloudflare/workers-types';

interface Env {
  DB: D1Database;
  ENVIRONMENT?: string;
  AUTH_SECRET: string;
}

interface PlayerRole {
  player_id: number;
  room_code: string;
  role: string;
}

// Simple anonymous token
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

function parseAuth(req: Request): { userId: string | null; token: string | null } {
  const auth = req.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) {
    return { userId: null, token: auth.slice(7) };
  }
  return { userId: null, token: null };
}

function json(data: any, status = 200, origin = '*'): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    const path = url.pathname;
    const auth = parseAuth(request);

    try {
      // ── rooms ──
      if (path === '/api/rooms' && method === 'POST') {
        const body: any = await request.json();
        const code = body.room_code || Math.random().toString(36).substring(2, 8).toUpperCase();
        const token = generateToken();

        // Delete old room if same code
        await env.DB.prepare('DELETE FROM rooms WHERE room_code = ?').bind(code).run();

        const { meta } = await env.DB.prepare(
          'INSERT INTO rooms (room_code, host_id, phase, round) VALUES (?, ?, ?, ?)'
        ).bind(code, token, 'lobby', 1).run();

        return json({ room_code: code, id: meta.last_row_id, host_token: token }, 200, origin);
      }

      if (path.startsWith('/api/rooms/') && method === 'GET') {
        const code = path.split('/')[3];
        const { results } = await env.DB.prepare(
          'SELECT id, room_code, phase, round, winner FROM rooms WHERE room_code = ?'
        ).bind(code).all();
        if (results.length === 0) return json({ error: 'Room not found' }, 404, origin);
        return json(results[0], 200, origin);
      }

      // ── players ──
      if (path === '/api/players' && method === 'GET') {
        const room_code = url.searchParams.get('room_code') || '';
        const { results } = await env.DB.prepare(
          'SELECT id, user_id, name, alive FROM players WHERE room_code = ? ORDER BY joined_at'
        ).bind(room_code).all();
        return json(results, 200, origin);
      }

      if (path === '/api/players' && method === 'POST') {
        const body: any = await request.json();
        const token = generateToken();
        const user_id = token;

        const { meta, error } = await env.DB.prepare(
          'INSERT INTO players (room_code, user_id, name, alive) VALUES (?, ?, ?, 1)'
        ).bind(body.room_code, user_id, body.name).run();

        if (error && error.message?.includes('UNIQUE')) {
          return json({ error: 'Name already taken in this room' }, 409, origin);
        }

        return json({ id: meta.last_row_id, user_id, player_token: token }, 200, origin);
      }

      // ── player_roles ──
      if (path === '/api/player-roles' && method === 'GET') {
        const player_id = url.searchParams.get('player_id') || '';
        const userToken = auth.token;

        // Verify token matches player
        const { results: players } = await env.DB.prepare(
          'SELECT id, user_id FROM players WHERE id = ?'
        ).bind(player_id).all();

        if (players.length === 0) return json({ error: 'Player not found' }, 404, origin);
        if ((players[0] as any).user_id !== userToken) {
          return json({ error: 'Forbidden' }, 403, origin);
        }

        const { results } = await env.DB.prepare(
          'SELECT role FROM player_roles WHERE player_id = ?'
        ).bind(player_id).all();

        return json(results, 200, origin);
      }

      // ── night_actions ──
      if (path === '/api/night-actions' && method === 'GET') {
        const room_code = url.searchParams.get('room_code') || '';
        const round = url.searchParams.get('round') || '0';
        const { results } = await env.DB.prepare(
          'SELECT player_id, target_id, action_type FROM night_actions WHERE room_code = ? AND round = ?'
        ).bind(room_code, round).all();
        return json(results, 200, origin);
      }

      if (path === '/api/night-actions' && method === 'POST') {
        const body: any = await request.json();
        const userToken = auth.token;

        // Verify ownership
        const { results: players } = await env.DB.prepare(
          'SELECT id, user_id FROM players WHERE id = ?'
        ).bind(body.player_id).all();
        if (players.length === 0 || (players[0] as any).user_id !== userToken) {
          return json({ error: 'Forbidden' }, 403, origin);
        }

        // Get current round
        const { results: rooms } = await env.DB.prepare(
          'SELECT round FROM rooms WHERE room_code = ?'
        ).bind(body.room_code).all();

        const round = rooms.length > 0 ? (rooms[0] as any).round : 1;

        // Upsert
        await env.DB.prepare(
          'INSERT OR REPLACE INTO night_actions (room_code, round, player_id, target_id, action_type) VALUES (?, ?, ?, ?, ?)'
        ).bind(body.room_code, round, body.player_id, body.target_id || null, body.action_type).run();

        return json({ success: true }, 200, origin);
      }

      // ── day_votes ──
      if (path === '/api/day-votes' && method === 'POST') {
        const body: any = await request.json();
        const userToken = auth.token;

        const { results: players } = await env.DB.prepare(
          'SELECT id, user_id FROM players WHERE id = ?'
        ).bind(body.voter_id).all();
        if (players.length === 0 || (players[0] as any).user_id !== userToken) {
          return json({ error: 'Forbidden' }, 403, origin);
        }

        const { results: rooms } = await env.DB.prepare(
          'SELECT round FROM rooms WHERE room_code = ?'
        ).bind(body.room_code).all();
        const round = rooms.length > 0 ? (rooms[0] as any).round : 1;

        await env.DB.prepare(
          'INSERT OR REPLACE INTO day_votes (room_code, round, voter_id, target_id) VALUES (?, ?, ?, ?)'
        ).bind(body.room_code, round, body.voter_id, body.target_id).run();

        return json({ success: true }, 200, origin);
      }

      // ── assign roles ──
      if (path === '/api/assign-roles' && method === 'POST') {
        return await handleAssignRoles(request, env, origin);
      }

      // ── process night ──
      if (path === '/api/process-night' && method === 'POST') {
        return await handleProcessNight(request, env, origin);
      }

      // ── process day ──
      if (path === '/api/process-day' && method === 'POST') {
        return await handleProcessDay(request, env, origin);
      }

      return json({ error: 'Not found' }, 404, origin);
    } catch (err: any) {
      return json({ error: err.message || 'Internal error' }, 500, origin);
    }
  },
};

// ═══════════════════════════════════════════
// GAME LOGIC
// ═══════════════════════════════════════════

async function handleAssignRoles(request: Request, env: Env, origin: string): Promise<Response> {
  const body: any = await request.json();
  const { room_code } = body;
  if (!room_code) return json({ error: 'room_code required' }, 400, origin);

  const { results: players } = await env.DB.prepare(
    'SELECT id FROM players WHERE room_code = ?'
  ).bind(room_code).all();

  if (players.length < 6) return json({ error: `Need at least 6 players, got ${players.length}` }, 400, origin);

  const count = players.length;
  const numWerewolves = count <= 7 ? 2 : Math.floor(count / 4);
  const numSeer = 1;
  const numDoctor = 1;

  let roles: string[] = [];
  for (let i = 0; i < count; i++) {
    if (i < numWerewolves) roles.push('werewolf');
    else if (i < numWerewolves + numSeer) roles.push('seer');
    else if (i < numWerewolves + numSeer + numDoctor) roles.push('doctor');
    else roles.push('villager');
  }

  // Fisher-Yates
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  // Delete old roles
  await env.DB.prepare('DELETE FROM player_roles WHERE room_code = ?').bind(room_code).run();

  // Insert new roles
  const stmt = env.DB.prepare(
    'INSERT INTO player_roles (player_id, room_code, role) VALUES (?, ?, ?)'
  );
  const batch = players.map((p: any, i: number) => stmt.bind(p.id, room_code, roles[i]));
  await env.DB.batch(batch);

  // Update room
  await env.DB.prepare('UPDATE rooms SET phase = ?, round = 1 WHERE room_code = ?')
    .bind('night', room_code).run();

  return json({ success: true, playerCount: count }, 200, origin);
}

async function handleProcessNight(request: Request, env: Env, origin: string): Promise<Response> {
  const body: any = await request.json();
  const { room_code } = body;
  if (!room_code) return json({ error: 'room_code required' }, 400, origin);

  const { results: rooms } = await env.DB.prepare(
    'SELECT id, round FROM rooms WHERE room_code = ?'
  ).bind(room_code).all();
  if (rooms.length === 0) return json({ error: 'Room not found' }, 404, origin);

  const round = (rooms[0] as any).round;

  const { results: actions } = await env.DB.prepare(
    'SELECT player_id, target_id, action_type FROM night_actions WHERE room_code = ? AND round = ?'
  ).bind(room_code, round).all();

  const kills = actions.filter((a: any) => a.action_type === 'kill');
  const protects = actions.filter((a: any) => a.action_type === 'protect');

  // Plurality kill vote
  const voteCount: Record<number, number> = {};
  kills.forEach((k: any) => {
    if (k.target_id) voteCount[k.target_id] = (voteCount[k.target_id] || 0) + 1;
  });

  let victimId: number | null = null;
  let maxVotes = 0;
  for (const [id, count] of Object.entries(voteCount)) {
    if (count > maxVotes) { maxVotes = count; victimId = Number(id); }
  }

  const protectedIds = new Set(protects.filter((p: any) => p.target_id).map((p: any) => p.target_id));
  const saved = victimId !== null && protectedIds.has(victimId);

  let killedName: string | null = null;
  if (victimId !== null && !saved) {
    await env.DB.prepare('UPDATE players SET alive = 0 WHERE id = ?').bind(victimId).run();
    const { results: victim } = await env.DB.prepare('SELECT name FROM players WHERE id = ?').bind(victimId).all();
    if (victim.length > 0) killedName = (victim[0] as any).name;
  }

  // Win check
  const winner = await checkWinCondition(env, room_code);

  if (winner) {
    await env.DB.prepare('UPDATE rooms SET phase = ?, winner = ? WHERE room_code = ?')
      .bind('victory', winner, room_code).run();
    return json({ killedPlayer: killedName ? { name: killedName } : null, saved, winner }, 200, origin);
  }

  await env.DB.prepare('UPDATE rooms SET phase = ? WHERE room_code = ?')
    .bind('day_discussion', room_code).run();

  return json({ killedPlayer: killedName ? { name: killedName } : null, saved }, 200, origin);
}

async function handleProcessDay(request: Request, env: Env, origin: string): Promise<Response> {
  const body: any = await request.json();
  const { room_code } = body;
  if (!room_code) return json({ error: 'room_code required' }, 400, origin);

  const { results: rooms } = await env.DB.prepare(
    'SELECT id, round FROM rooms WHERE room_code = ?'
  ).bind(room_code).all();
  if (rooms.length === 0) return json({ error: 'Room not found' }, 404, origin);
  const round = (rooms[0] as any).round;

  const { results: votes } = await env.DB.prepare(
    'SELECT voter_id, target_id FROM day_votes WHERE room_code = ? AND round = ?'
  ).bind(room_code, round).all();

  const tally: Record<number, number> = {};
  votes.forEach((v: any) => {
    if (v.target_id) tally[v.target_id] = (tally[v.target_id] || 0) + 1;
  });

  let eliminatedId: number | null = null;
  let maxVotes = 0;
  for (const [id, count] of Object.entries(tally)) {
    if (count > maxVotes) { maxVotes = count; eliminatedId = Number(id); }
  }

  let eliminatedName: string | null = null;
  let eliminatedRole: string | null = null;

  if (eliminatedId !== null) {
    await env.DB.prepare('UPDATE players SET alive = 0 WHERE id = ?').bind(eliminatedId).run();
    const { results: ep } = await env.DB.prepare('SELECT name FROM players WHERE id = ?').bind(eliminatedId).all();
    if (ep.length > 0) eliminatedName = (ep[0] as any).name;

    const { results: pr } = await env.DB.prepare('SELECT role FROM player_roles WHERE player_id = ?').bind(eliminatedId).all();
    if (pr.length > 0) eliminatedRole = (pr[0] as any).role;
  }

  const winner = await checkWinCondition(env, room_code);

  if (winner) {
    await env.DB.prepare('UPDATE rooms SET phase = ?, winner = ? WHERE room_code = ?')
      .bind('victory', winner, room_code).run();
    return json({
      eliminatedPlayer: eliminatedName ? { name: eliminatedName, role: eliminatedRole } : null,
      voteTally: tally,
      winner,
    }, 200, origin);
  }

  // Next round
  await env.DB.prepare('UPDATE rooms SET phase = ?, round = round + 1 WHERE room_code = ?')
    .bind('night', room_code).run();

  // Clean up old actions
  await env.DB.prepare('DELETE FROM night_actions WHERE room_code = ? AND round = ?').bind(room_code, round).run();
  await env.DB.prepare('DELETE FROM day_votes WHERE room_code = ? AND round = ?').bind(room_code, round).run();

  return json({
    eliminatedPlayer: eliminatedName ? { name: eliminatedName, role: eliminatedRole } : null,
    voteTally: tally,
  }, 200, origin);
}

async function checkWinCondition(env: Env, room_code: string): Promise<string | null> {
  const { results: allPlayers } = await env.DB.prepare(
    'SELECT id FROM players WHERE room_code = ? AND alive = 1'
  ).bind(room_code).all();

  const aliveIds = allPlayers.map((p: any) => p.id);
  if (aliveIds.length === 0) return 'werewolf'; // should not happen

  const { results: roles } = await env.DB.prepare(
    'SELECT player_id, role FROM player_roles WHERE room_code = ?'
  ).bind(room_code).all();

  const aliveSet = new Set(aliveIds);
  const werewolfCount = roles.filter((r: any) => r.role === 'werewolf' && aliveSet.has(r.player_id)).length;
  const villagerCount = aliveIds.length - werewolfCount;

  if (werewolfCount >= villagerCount && werewolfCount > 0) return 'werewolf';
  if (werewolfCount === 0) return 'village';
  return null;
}
