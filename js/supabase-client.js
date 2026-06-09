/* ============================================
   Supabase client config
   ============================================ */

const SUPABASE_URL = window.SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'your-anon-key-here';

// Create Supabase client
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
});

// Room channel helper
function getRoomChannel(roomCode) {
  return supabaseClient.channel(`room:${roomCode}`, {
    config: {
      broadcast: { self: true }
    }
  });
}
