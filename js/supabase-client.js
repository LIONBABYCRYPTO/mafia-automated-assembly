/* ============================================
   Supabase client & room helpers
   ============================================ */
const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 10 } }
    });
  }
  return _supabase;
}

async function getAnonJWT(client) {
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw new Error('Auth: ' + error.message);
  return data.session.access_token;
}

function getRoomChannel(roomCode) {
  return getSupabase().channel(`room:${roomCode}`, {
    config: { broadcast: { self: true } }
  });
}

async function callEdgeFunction(name, body, jwt) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
