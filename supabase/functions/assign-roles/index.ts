// ============================================
// assign-roles Edge Function
// Called by host to shuffle and assign roles
// ============================================
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const { room_code } = await req.json()
    if (!room_code) {
      return new Response(JSON.stringify({ error: 'room_code required' }), { status: 400 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get all players in room
    const { data: players, error: pErr } = await supabase
      .from('players')
      .select('id')
      .eq('room_code', room_code)

    if (pErr) throw pErr
    if (!players || players.length < 4) {
      return new Response(JSON.stringify({ error: 'Need at least 4 players' }), { status: 400 })
    }

    const count = players.length

    // Build role pool - same distribution as JS client
    const rolePool = {
      4:  { werewolf: 1, seer: 1, doctor: 1, villager: 1 },
      6:  { werewolf: 2, seer: 1, doctor: 1, villager: 2 },
      8:  { werewolf: 2, seer: 1, doctor: 1, villager: 4 },
      10: { werewolf: 2, seer: 1, doctor: 1, villager: 6 },
      12: { werewolf: 3, seer: 1, doctor: 1, villager: 7 },
      15: { werewolf: 3, seer: 1, doctor: 1, villager: 10 },
      20: { werewolf: 4, seer: 1, doctor: 1, villager: 14 },
      30: { werewolf: 5, seer: 1, doctor: 1, villager: 23 },
      40: { werewolf: 6, seer: 1, doctor: 1, villager: 32 },
      50: { werewolf: 7, seer: 1, doctor: 1, villager: 41 },
      75: { werewolf: 9, seer: 2, doctor: 2, villager: 62 },
      100: { werewolf: 12, seer: 2, doctor: 2, villager: 84 }
    }

    const keys = Object.keys(rolePool).map(Number).sort((a, b) => a - b)
    let closest = keys[0]
    for (const k of keys) {
      if (k >= count) { closest = k; break }
      closest = k
    }

    const pool = rolePool[closest]
    const roles = [
      ...Array(pool.werewolf).fill('werewolf'),
      ...Array(pool.seer).fill('seer'),
      ...Array(pool.doctor).fill('doctor'),
      ...Array(count - pool.werewolf - pool.seer - pool.doctor).fill('villager')
    ]

    // Fisher-Yates shuffle
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]]
    }

    // Insert roles
    const roleInserts = players.map((p, i) => ({
      player_id: p.id,
      room_code,
      role: roles[i]
    }))

    // Delete existing roles first (re-shuffle)
    await supabase.from('player_roles').delete().eq('room_code', room_code)

    const { error: rErr } = await supabase.from('player_roles').insert(roleInserts)
    if (rErr) throw rErr

    // Update room phase to night
    const { error: uErr } = await supabase
      .from('rooms')
      .update({ phase: 'night', round: 1, phase_ends_at: new Date(Date.now() + 60000).toISOString() })
      .eq('room_code', room_code)

    if (uErr) throw uErr

    // Broadcast to channel
    const channel = supabase.channel(`room:${room_code}`)
    await channel.send({
      type: 'broadcast',
      event: 'phase_change',
      payload: { phase: 'night', round: 1 }
    })

    return new Response(JSON.stringify({ success: true, playerCount: count }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
