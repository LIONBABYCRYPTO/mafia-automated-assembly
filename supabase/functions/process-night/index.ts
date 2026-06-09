// ============================================
// process-night Edge Function
// Resolves night actions: werewolf kills, doctor save, seer peek
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

    // Get current round
    const { data: room } = await supabase.from('rooms').select('round').eq('room_code', room_code).single()
    const round = room?.round || 1

    // 1. Get night actions for this round
    const { data: actions } = await supabase
      .from('night_actions')
      .select('player_id, target_id, action_type')
      .eq('room_code', room_code)
      .eq('round', round)

    const kills = (actions || []).filter(a => a.action_type === 'kill')
    const protects = (actions || []).filter(a => a.action_type === 'protect')
    const investigates = (actions || []).filter(a => a.action_type === 'investigate')

    // 2. Resolve kill: most-voted victim
    // Werewolves each pick a target; plurality wins
    const killVotes: Record<number, number> = {}
    for (const k of kills) {
      if (k.target_id) {
        killVotes[k.target_id] = (killVotes[k.target_id] || 0) + 1
      }
    }

    let victimId: number | null = null
    let maxVotes = 0
    for (const [targetId, count] of Object.entries(killVotes)) {
      if (count > maxVotes) {
        maxVotes = count
        victimId = Number(targetId)
      }
    }

    // 3. Check doctor save
    const protectedIds = new Set(protects.filter(p => p.target_id).map(p => p.target_id!))
    const saved = victimId !== null && protectedIds.has(victimId)

    // 4. Execute kill (if not saved)
    let killedPlayer = null
    if (victimId !== null && !saved) {
      await supabase.from('players').update({ alive: false }).eq('id', victimId)

      const { data: victim } = await supabase
        .from('players')
        .select('id, name')
        .eq('id', victimId)
        .single()
      killedPlayer = victim
    }

    // 5. Seer investigation results (stored but we can broadcast individually)
    const seerResults = []
    for (const inv of investigates) {
      if (inv.target_id) {
        const { data: target } = await supabase
          .from('player_roles')
          .select('role')
          .eq('player_id', inv.target_id)
          .single()

        seerResults.push({
          seer_player_id: inv.player_id,
          target_id: inv.target_id,
          is_werewolf: target?.role === 'werewolf'
        })
      }
    }

    // 6. Check win condition
    const { data: alivePlayers } = await supabase
      .from('players')
      .select('id')
      .eq('room_code', room_code)
      .eq('alive', true)

    const { data: aliveWerewolves } = await supabase
      .from('player_roles')
      .select('player_id')
      .eq('room_code', room_code)
      .in('player_id', (alivePlayers || []).map(p => p.id))
      .eq('role', 'werewolf')

    // Also count non-werewolf alive
    const aliveCount = (alivePlayers || []).length
    const werewolfCount = (aliveWerewolves || []).length
    const villagerCount = aliveCount - werewolfCount

    let winner = null
    if (werewolfCount >= villagerCount && werewolfCount > 0) {
      winner = 'werewolf'
    } else if (werewolfCount === 0) {
      winner = 'village'
    }

    if (winner) {
      await supabase.from('rooms').update({ phase: 'victory', winner }).eq('room_code', room_code)

      const channel = supabase.channel(`room:${room_code}`)
      await channel.send({
        type: 'broadcast',
        event: 'victory',
        payload: { winner, phase: 'victory' }
      })

      return new Response(JSON.stringify({
        success: true,
        killedPlayer: killedPlayer ? { id: killedPlayer.id, name: killedPlayer.name } : null,
        saved,
        winner,
        seerResults
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    // 7. Update room to day discussion
    const phaseEnds = new Date(Date.now() + 180000).toISOString() // 3 min discussion
    await supabase
      .from('rooms')
      .update({ phase: 'day_discussion', phase_ends_at: phaseEnds })
      .eq('room_code', room_code)

    // 8. Broadcast results
    const channel = supabase.channel(`room:${room_code}`)
    await channel.send({
      type: 'broadcast',
      event: 'night_result',
      payload: {
        phase: 'day_discussion',
        round,
        killedPlayer: killedPlayer ? { id: killedPlayer.id, name: killedPlayer.name } : null,
        saved,
        seerResults
      }
    })

    return new Response(JSON.stringify({
      success: true,
      killedPlayer: killedPlayer ? { id: killedPlayer.id, name: killedPlayer.name } : null,
      saved,
      seerResults,
      aliveCount,
      werewolfCount
    }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
