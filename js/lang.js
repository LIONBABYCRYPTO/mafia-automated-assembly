// Werewolf Game - Translations
const LANG = {
  en: {
    // Join page
    'join-title': 'Join Werewolf',
    'join-subtitle': 'Enter your username to join the game.',
    'username-placeholder': 'Enter your username',
    'join-btn': 'Join Game',
    'join-error': 'Failed to join. Check the room code.',
    'enter-code-label': 'Room Code',
    'enter-code-placeholder': 'Enter room code',
    'scan-to-join': 'or scan the QR code',

    // Waiting
    'waiting-title': 'Waiting for host...',
    'waiting-subtitle': 'The game will start when the host begins.',
    'players-joined': 'players joined',
    'connected': 'Connected',
    'disconnected': 'Disconnected',

    // Lobby (host)
    'lobby-title': 'Room Code',
    'copy-code': '📋 Copy Code',
    'scan-qr': 'Scan to join',
    'total': 'Total',
    'online': 'Online',
    'offline': 'Offline',
    'alive': 'Alive',
    'dead': 'Dead',
    'round': 'Round',
    'start-game': '▶ Start Game',
    'end-game': '✕ End Game',
    'new-game': '🔄 New Game',
    'wolf-count': 'Werewolves:',
    'role-dist': 'Role Distribution',
    'waiting-players': 'Waiting for players...',
    'create-game': '🎮 Create Game',
    'landing-title': 'Werewolf',
    'landing-subtitle': 'A game of deception and deduction',
    'landing-subtitle-zh': '欺骗与推理的游戏',
    'players': 'Players',
    'kick': 'Kick',

    // Game phases
    'night': 'Night',
    'night-falls': 'Night falls...',
    'day': 'Day',
    'discussion': 'Discussion',
    'voting': 'Voting',
    'results': 'Results',
    'victory': 'Victory',
    'process-night': '🌙 Process Night',
    'process-day': '☠️ Eliminate',
    'continue': '▶ Continue',
    'start-voting': '🗳️ Start Voting',

    // Game messages
    'doctor-saved': '💉 No one died — the Doctor saved them!',
    'no-one-died': '🌅 No one died',
    'was-killed': 'was killed',
    'was-eliminated': 'was eliminated!',
    'killed-by-mark': 'killed by the Wolf King\'s mark!',
    'vote-tally': 'Vote Tally',
    'no-votes': 'No votes cast',
    'votes': 'votes',
    'village-wins': '🏆 Village Wins!',
    'werewolf-wins': '🐺 Werewolves Win!',
    'final-words': 'Final Words',
    'player-list': 'Players',

    // Roles
    'villager': 'Villager',
    'werewolf': 'Werewolf',
    'wolf_king': 'Wolf King',
    'seer': 'Seer',
    'doctor': 'Doctor',
    'shooter': 'Shooter',

    'villager-desc': 'Use your intuition to find the werewolves during the day.',
    'werewolf-desc': 'Each night, choose a victim with your pack.',
    'wolf_king-desc': 'Each night, kill with your pack and secretly mark one target. If you die, your marked target dies too.',
    'seer-desc': 'Each night, investigate one player to learn if they are Good or Bad.',
    'doctor-desc': 'Each night, protect one player from the werewolves. Cannot protect yourself or the same player twice in a row.',
    'shooter-desc': 'You have no night action, but if eliminated, you may take one revenge shot.',

    'team-village': 'Village Team',
    'team-werewolf': 'Werewolf Team',

    // Night actions
    'choose-target': 'Choose your target',
    'choose-kill': 'Choose a victim to kill',
    'choose-mark': 'Choose a player to mark',
    'choose-protect': 'Choose a player to protect',
    'choose-investigate': 'Choose a player to investigate',
    'choose-revenge': 'Choose your revenge target',
    'confirm-action': 'Confirm',
    'action-submitted': '✅ Action submitted',
    'targeting': 'targeting',
    'waiting-others': 'Waiting for other players...',
    'close-eyes': 'Close your eyes and wait...',
    'got-it': 'Got it!',
    'investigation-result': 'Investigation Result',
    'good': '🤝 Good',
    'bad': '☠️ Bad',
    'mark-placed': '🎯 Mark placed',
    'villager-waiting': 'As a Villager, you have no night action. Wait for the night to end.',

    // Shooter
    'revenge-title': '💀 Revenge Shot',
    'revenge-desc': 'You have one revenge shot! Choose who to take down with you.',
    'shoot': '🔫 Shoot',

    // Death / Final words
    'you-died': '💀 You are dead',
    'your-role-was': 'Your role was:',
    'final-words-label': 'Your final words:',
    'final-words-placeholder': 'Write your final words...',
    'submit': 'Submit',
    'spectating': '👁️ Spectating',

    // Werewolf chat
    'wolf-chat': '🐺 Wolf Chat',
    'wolf-chat-placeholder': 'Message the pack...',
    'send': 'Send',

    // General
    'en': 'EN',
    'zh': '中文',
    'advertisement': 'Advertisement — Support Werewolf',
    'play-again': '🔄 Play Again',
    'leave': 'Leave Game',
    'you': '(You)',
    'unknown': 'Unknown',
  },

  zh: {
    'join-title': '加入狼人游戏',
    'join-subtitle': '输入您的用户名加入游戏。',
    'username-placeholder': '输入您的用户名',
    'join-btn': '加入游戏',
    'join-error': '加入失败，请检查房间代码。',
    'enter-code-label': '房间代码',
    'enter-code-placeholder': '输入房间代码',
    'scan-to-join': '或扫描二维码',

    'waiting-title': '等待主持人...',
    'waiting-subtitle': '主持人开始后游戏将开始。',
    'players-joined': '名玩家已加入',
    'connected': '已连接',
    'disconnected': '已断开',

    'lobby-title': '房间代码',
    'copy-code': '📋 复制代码',
    'scan-qr': '扫码加入',
    'total': '总数',
    'online': '在线',
    'offline': '离线',
    'alive': '存活',
    'dead': '死亡',
    'round': '回合',
    'start-game': '▶ 开始游戏',
    'end-game': '✕ 结束游戏',
    'new-game': '🔄 新游戏',
    'wolf-count': '狼人数量:',
    'role-dist': '角色分布',
    'waiting-players': '等待玩家加入...',
    'create-game': '🎮 创建游戏',
    'landing-title': '狼人游戏',
    'landing-subtitle': '欺骗与推理的游戏',
    'landing-subtitle-zh': '',
    'players': '玩家',
    'kick': '踢出',

    'night': '夜晚',
    'night-falls': '夜幕降临...',
    'day': '白天',
    'discussion': '讨论',
    'voting': '投票',
    'results': '结果',
    'victory': '胜利',
    'process-night': '🌙 处理夜晚',
    'process-day': '☠️ 执行淘汰',
    'continue': '▶ 继续',
    'start-voting': '🗳️ 开始投票',

    'doctor-saved': '💉 无人死亡 — 医生拯救了他们！',
    'no-one-died': '🌅 无人死亡',
    'was-killed': '被杀了',
    'was-eliminated': '被淘汰了！',
    'killed-by-mark': '被狼王的标记杀死！',
    'vote-tally': '投票统计',
    'no-votes': '无人投票',
    'votes': '票',
    'village-wins': '🏆 村民胜利！',
    'werewolf-wins': '🐺 狼人胜利！',
    'final-words': '遗言',
    'player-list': '玩家列表',

    'villager': '村民',
    'werewolf': '狼人',
    'wolf_king': '狼王',
    'seer': '预言家',
    'doctor': '医生',
    'shooter': '枪手',

    'villager-desc': '在白天用你的直觉找出狼人。',
    'werewolf-desc': '每晚与你的同伴选择一名受害者。',
    'wolf_king-desc': '每晚与狼群一起杀戮，并秘密标记一个目标。如果你死亡，被标记的目标也会死亡。',
    'seer-desc': '每晚可以查看一名玩家的阵营是好人还是坏人。',
    'doctor-desc': '每晚可以保护一名玩家免受狼人攻击。不能保护自己，也不能连续两晚保护同一人。',
    'shooter-desc': '没有夜间行动，但如果你被淘汰，你可以进行一次复仇射击。',

    'team-village': '村民阵营',
    'team-werewolf': '狼人阵营',

    'choose-target': '选择目标',
    'choose-kill': '选择要杀害的受害者',
    'choose-mark': '选择要标记的玩家',
    'choose-protect': '选择要保护的玩家',
    'choose-investigate': '选择要调查的玩家',
    'choose-revenge': '选择复仇目标',
    'confirm-action': '确认',
    'action-submitted': '✅ 已提交行动',
    'targeting': '目标',
    'waiting-others': '等待其他玩家...',
    'close-eyes': '闭上眼睛等待...',
    'got-it': '知道了！',
    'investigation-result': '调查结果',
    'good': '🤝 好人',
    'bad': '☠️ 坏人',
    'mark-placed': '🎯 标记已放置',
    'villager-waiting': '作为村民，你没有夜间行动。请等待夜晚结束。',

    'revenge-title': '💀 复仇射击',
    'revenge-desc': '你还有一次复仇射击机会！选择谁和你一起倒下。',
    'shoot': '🔫 射击',

    'you-died': '💀 你已死亡',
    'your-role-was': '你的角色是:',
    'final-words-label': '你的遗言:',
    'final-words-placeholder': '写下你的遗言...',
    'submit': '提交',
    'spectating': '👁️ 观战中',

    'wolf-chat': '🐺 狼群聊天',
    'wolf-chat-placeholder': '给狼群发消息...',
    'send': '发送',

    'en': 'EN',
    'zh': '中文',
    'advertisement': '广告 — 支持狼人游戏',
    'play-again': '🔄 再玩一次',
    'leave': '离开游戏',
    'you': '(你)',
    'unknown': '未知',
  }
};

let lang = localStorage.getItem('werewolf_lang') || 'en';

function t(key) {
  return (LANG[lang] && LANG[lang][key]) || (LANG.en && LANG.en[key]) || key;
}

function setLang(l) {
  lang = l;
  localStorage.setItem('werewolf_lang', l);
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
}
