/* ============================================
   Game state & constants
   ============================================ */

const PHASES = {
  LOBBY: 'lobby',
  NIGHT: 'night',
  DAY_DISCUSSION: 'day_discussion',
  DAY_VOTE: 'day_vote',
  DAY_RESULTS: 'day_results',
  VICTORY: 'victory'
};

const ROLES = {
  VILLAGER: 'villager',
  WEREWOLF: 'werewolf',
  SEER: 'seer',
  DOCTOR: 'doctor'
};

const ROLE_CONFIG = {
  [ROLES.VILLAGER]: {
    name: 'Villager',
    color: '#4fc3a1',
    team: 'village',
    emoji: '🏘️',
    description: 'Find and eliminate the werewolves. Use your voice and intuition.'
  },
  [ROLES.WEREWOLF]: {
    name: 'Werewolf',
    color: '#e74c3c',
    team: 'werewolf',
    emoji: '🐺',
    description: 'Eliminate the villagers at night. Blend in by day.',
    nightAction: 'Choose a victim to eliminate tonight.'
  },
  [ROLES.SEER]: {
    name: 'Seer',
    color: '#7c4dff',
    team: 'village',
    emoji: '🔮',
    description: 'Each night, investigate one player to learn their true nature.',
    nightAction: 'Select a player to investigate. You will learn if they are a Werewolf.'
  },
  [ROLES.DOCTOR]: {
    name: 'Doctor',
    color: '#ff6b9d',
    team: 'village',
    emoji: '💉',
    description: 'Each night, protect one player from elimination.',
    nightAction: 'Choose a player to protect tonight. They will survive an attack.'
  }
};

const ROLE_POOL = {
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
};

// Default phase durations (seconds)
const PHASE_DURATIONS = {
  [PHASES.NIGHT]: 60,
  [PHASES.DAY_DISCUSSION]: 180,
  [PHASES.DAY_VOTE]: 60,
  [PHASES.DAY_RESULTS]: 15
};

// Generate role distribution for any player count
function getRoleDistribution(playerCount) {
  const keys = Object.keys(ROLE_POOL).map(Number).sort((a, b) => a - b);
  let closest = keys[0];
  for (const k of keys) {
    if (k >= playerCount) { closest = k; break; }
    closest = k;
  }
  const pool = ROLE_POOL[closest];
  const remaining = playerCount - (pool.werewolf + pool.seer + pool.doctor + pool.villager);
  return {
    ...pool,
    villager: pool.villager + Math.max(0, remaining) // surplus = villagers
  };
}
