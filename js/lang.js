// Werewolf i18n - English only
var _lang = 'en';

window.t = function(key) {
  var dict = {
    'landing-title': 'Werewolf',
    'landing-subtitle': 'The Automated Assembly',
    'landing-subtitle-zh': '',
    'create-game': 'Create Game',
    'advertisement': 'Ad Space',
    'lobby-title': 'Room Code',
    'copy-code': 'Copy',
    'total': 'Total',
    'online': 'Online',
    'offline': 'Offline',
    'wolf-count': 'Wolf Count',
    'start-game': 'Start Game',
    'end-game': 'End Game',
    'role-dist': 'Role Distribution',
    'night': '🌙 Night',
    'discussion': '☀️ Discussion',
    'voting': '🗳️ Voting',
    'results': '📢 Results',
    'victory': '🏆 Victory',
    'round': 'Round',
    'alive': 'Alive',
    'dead': 'Dead',
    'vote-tally': 'Vote Tally',
    'no-votes': 'No votes yet',
    'votes': 'votes',
    'process-night': 'Process Night',
    'continue': 'Continue',
    'start-voting': 'Start Voting',
    'process-day': 'Process Day',
    'new-game': 'New Game',
    'villager': 'Villager',
    'werewolf': 'Werewolf',
    'wolf_king': 'Wolf King',
    'seer': 'Seer',
    'doctor': 'Doctor',
    'shooter': 'Shooter',
    'village-wins': 'Village Wins!',
    'werewolf-wins': 'Werewolves Win!',
    'final-words': 'Final Words',
    'doctor-saved': 'The Doctor saved someone!',
    'was-killed': 'was attacked last night',
    'night-falls': 'Night falls...',
    'no-one-died': 'No one died!',
    'was-eliminated': 'was eliminated'
  };
  return dict[key] || key;
};

function setLang(code, btn) {
  _lang = code;
  document.querySelectorAll('.lang-btn').forEach(b => b.className = 'lang-btn');
  if (btn) btn.className = 'lang-btn active';
  refreshTranslations();
}
