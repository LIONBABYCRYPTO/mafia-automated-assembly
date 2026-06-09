// ============================================
// process-day Edge Function
// Tallies elimination votes, reveals role, checks win
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

    // 1. Get all votes for this round
    const { data: votes } = await supabase
      .from('day_votes')
      .select('voter_id, target_id')
      .eq('room_code', room_code)
      .eq('round', round)

    if (!votes || votes.length === 0) {
      // No votes - nobody is eliminated
      return await proceedToNight(supabase, room_code, round, null)
    }

    // 2. Tally votes
    const tally: Record<number, number> = {}
    for (const v of votes) {
      if (v.target_id) {
        tally[v.target_id] = (tally[v.target_id] || 0) + 1
      }
    }

    // 3. Find most voted (plurality - ties = no elimination)
    let maxVotes = 0
    let eliminatedId: number | null = null
    let tie = false

    for (const [targetId, count] of Object.entries(tally)) {
      if (count > maxVotes) {
        maxVotes = count
        eliminatedId = Number(targetId)
        tie = false
      } else if (count === maxVotes) {
        tie = true
      }
    }

    if (tie || eliminatedId === null) {
      // Tie or no votes - nobody eliminated
      return await proceedToNight(supabase, room_code, round, null)
    }

    // 4. Eliminate the player
    await supabase.from('players').update({ alive: false }).eq('id', eliminatedId)

    // 5. Get their role (it's revealed now since alive=false)
    const { data: eliminatedRole } = await supabase
      .from('player_roles')
      .select('role')
      .eq('player_id', eliminatedId)
      .single()

    const { data: eliminatedPlayer } = await supabase
      .from('players')
      .select('id, name')
      .eq('id', eliminatedId)
      .single()

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
        payload: {
          winner,
          phase: 'victory',
          eliminatedPlayer: eliminatedPlayer ? { id: eliminatedPlayer.id, name: eliminatedPlayer.name } : null,
          eliminatedRole: eliminatedRole?.role || 'villager',
          voteTally: tally
        }
      })

      return new Response(JSON.stringify({
        success: true,
        eliminatedPlayer: { id: eliminatedPlayer!.id, name: eliminatedPlayer!.name },
        eliminatedRole: eliminatedRole?.role || 'villager',
        voteTally: tally,
        winner
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    // 7. Proceed to next night
    return await proceedToNight(supabase, room_code, round, {
      id: eliminatedPlayer!.id,
      name: eliminatedPlayer!.name,
      role: eliminatedRole?.role || 'villager'
    }, tally)
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})

async function proceedToNight(
  supabase: any,
  room_code: string,
  round: number,
  eliminatedPlayer: { id: number; name: string; role: string } | null,
  voteTally?: Record<number, number>
) {
  const nextRound = round + 1
  const phaseEnds = new Date(Date.now() + 60000).toISOString() // 60s night

  await supabase
    .from('rooms')
    .update({ phase: 'night', round: nextRound, phase_ends_at: phaseEnds })
    .eq('room_code', room_code)

  // Clear night actions from previous round
  await supabase.from('night_actions').delete().eq('room_code', room_code).eq('round', round)
  await supabase.from('day_votes').delete().eq('room_code', room_code).eq('round', round)

  const channel = supabase.channel(`room:${room_code}`)
  await channel.send({
    type: 'broadcast',
    event: 'day_result',
    payload: {
      phase: 'night',
      round: nextRound,
      eliminatedPlayer,
      voteTally: voteTally || null
    }
  })

  return new Response(JSON.stringify({
    success: true,
    eliminatedPlayer,
    phase: 'night',
    nextRound
  }), { headers: { 'Content-Type': 'application/json' } })
}
