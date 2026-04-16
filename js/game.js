/* ================================================================
   game.js — Game room client logic
   Single socket connection. Room is created/joined HERE only.
   ================================================================ */

// ── State ────────────────────────────────────────────────────────
let socket;
let state = {
  roomId:     null,
  myName:     null,
  myId:       null,
  isHost:     false,
  room:       null,
  myCard:     null,
  votingFor:  null,
  hasVoted:   false,
  unreadCount: 0,
};

// ── Bootstrap ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const session = SESSION.load('player');

  // No session at all → back to home
  if (!session || !session.name) {
    window.location.href = '/';
    return;
  }

  state.myName = session.name;
  state.isHost = !!session.isHost;

  // Update static UI
  document.getElementById('self-name-display').textContent = session.name;
  document.getElementById('self-avatar').textContent       = getInitials(session.name);
  document.getElementById('self-avatar').style.background  = avatarGradient(session.name);

  // Connect socket — one connection for the lifetime of this page
  socket = io();
  bindSocketEvents();

  socket.on('connect', () => {
    state.myId = socket.id;

    if (state.isHost) {
      // ── HOST: create the room now (first and only socket) ──────
      socket.emit('create-room', {
        name:       session.name,
        maxPlayers: session.maxPlayers || 6,
        roleConfig: session.roleConfig || 'both',
      }, ({ roomId, error }) => {
        if (error) {
          showToast('Could not create room: ' + error, 'error');
          return;
        }
        state.roomId = roomId;
        // Update URL so the share link is correct — no page reload
        history.replaceState(null, '', `/game.html?room=${roomId}`);
        document.title = `Room ${roomId} — Impostor Game`;
        document.getElementById('room-code-display').textContent = roomId;
        document.getElementById('loading-overlay').style.display = 'none';
      });

    } else {
      // ── JOINER: get room ID from URL ───────────────────────────
      const params = new URLSearchParams(window.location.search);
      const roomId = params.get('room') || session.roomId;

      if (!roomId) {
        showToast('No room code found', 'error');
        setTimeout(() => { window.location.href = '/'; }, 1500);
        return;
      }

      socket.emit('join-room', { roomId, name: session.name }, ({ success, error }) => {
        if (error) {
          showToast(error, 'error');
          setTimeout(() => { window.location.href = `/?room=${roomId}`; }, 1800);
          return;
        }
        state.roomId = roomId;
        document.title = `Room ${roomId} — Impostor Game`;
        document.getElementById('room-code-display').textContent = roomId;
        document.getElementById('loading-overlay').style.display = 'none';
      });
    }
  });

  socket.on('disconnect', () => {
    showToast('Disconnected. Trying to reconnect…', 'warning', 5000);
  });

  socket.on('connect_error', () => {
    showToast('Connection error. Please refresh.', 'error', 5000);
  });
});

// ── Socket Events ─────────────────────────────────────────────────
function bindSocketEvents() {

  socket.on('room-update', (room) => {
    state.room = room;
    const me = room.players.find(p => p.id === socket.id);
    if (me) state.isHost = me.isHost;
    renderAll(room);
  });

  socket.on('your-card', (card) => {
    state.myCard   = card;
    state.hasVoted = false;
    state.votingFor = null;
    renderMyCard(card);
    const cardEl = document.getElementById('my-card');
    cardEl.style.animation = 'none';
    requestAnimationFrame(() => { cardEl.style.animation = 'cardFlip 0.7s ease'; });
    showToast('🃏 Your secret card has been dealt!', 'info', 4000);
  });

  socket.on('new-message', (msg) => {
    appendMessage(msg);
    state.unreadCount++;
    const badge = document.getElementById('unread-badge');
    badge.textContent = state.unreadCount > 9 ? '9+' : state.unreadCount;
    badge.style.display = state.unreadCount > 0 ? 'flex' : 'none';
  });

  socket.on('player-revealed', ({ player, tally, winner }) => {
    showRevealModal(player, tally, winner);
  });
}

// ── Render All ────────────────────────────────────────────────────
function renderAll(room) {
  renderPhaseBadge(room.phase);
  renderRoundInfo(room.roundNumber);
  renderPlayers(room);
  renderActionBar(room);
  renderChatControls(room);
}

// ── Phase Badge ───────────────────────────────────────────────────
function renderPhaseBadge(phase) {
  const b = document.getElementById('phase-badge');
  const labels  = { lobby: 'Lobby', playing: 'In Progress', voting: 'Voting!', revealed: 'Revealed' };
  const classes = { lobby: 'phase-lobby', playing: 'phase-playing', voting: 'phase-voting', revealed: 'phase-revealed' };
  b.textContent = labels[phase] || phase;
  b.className   = `phase-badge ${classes[phase] || 'phase-lobby'}`;
}

// ── Round Info ────────────────────────────────────────────────────
function renderRoundInfo(roundNumber) {
  const el   = document.getElementById('round-info');
  const disp = document.getElementById('round-display');
  if (roundNumber > 0) { el.style.display = 'flex'; disp.textContent = `Round ${roundNumber}`; }
  else el.style.display = 'none';
}

// ── My Card ───────────────────────────────────────────────────────
function renderMyCard(card) {
  const cardEl = document.getElementById('my-card');
  const { role, word } = card;
  const meta = getRoleMeta(role);

  cardEl.className = `my-card card-${role}`;
  cardEl.innerHTML = `
    <div class="card-big-icon">${meta.icon}</div>
    <div class="card-info">
      <div class="card-role-label">Your Secret Card</div>
      <div class="card-role-name">${meta.label}</div>
      <div class="card-word">${role === 'mrwhite' ? '❓ No Word' : escapeHtml(word || '???')}</div>
      <div class="card-tip">${meta.tip}</div>
    </div>
  `;
}

// ── Players Grid ──────────────────────────────────────────────────
function renderPlayers(room) {
  const grid       = document.getElementById('players-grid');
  const countLabel = document.getElementById('player-count-label');
  const hint       = document.getElementById('players-hint');

  const alive = room.players.filter(p => !p.eliminated);
  countLabel.textContent = `(${alive.length}/${room.maxPlayers})`;

  const isVoting     = room.phase === 'voting';
  const me           = room.players.find(p => p.id === socket.id);
  const iAmEliminated = me?.eliminated;

  if (isVoting && !state.hasVoted && !iAmEliminated) {
    hint.textContent = '👆 Click a player card to cast your vote';
  } else if (isVoting && state.hasVoted) {
    hint.textContent = '✅ Vote cast — waiting for others…';
  } else {
    hint.textContent = '';
  }

  // Count votes per player
  const voteCounts = {};
  if (room.votes) {
    Object.entries(room.votes).forEach(([tid, voters]) => { voteCounts[tid] = voters.length; });
  }

  grid.innerHTML = '';
  room.players.forEach(p => {
    const isSelf        = p.id === socket.id;
    const canVote       = isVoting && !state.hasVoted && !iAmEliminated && !p.eliminated && !isSelf;
    const voteCount     = voteCounts[p.id] || 0;

    const card = document.createElement('div');
    card.className = ['player-card', isSelf ? 'self' : '', p.eliminated ? 'eliminated' : '', canVote ? 'vote-target' : ''].join(' ').trim();
    card.id = `player-card-${p.id}`;
    if (canVote) { card.onclick = () => confirmVote(p.id, p.name); card.title = `Click to vote for ${p.name}`; }

    const revealedRole = (p.role && (p.eliminated || room.phase === 'revealed'))
      ? `<span class="pc-role-reveal ${p.role}">${getRoleMeta(p.role).icon} ${getRoleMeta(p.role).label}</span>` : '';

    card.innerHTML = `
      <div class="pc-top">
        <div class="pc-avatar" style="background:${avatarGradient(p.name)}">${getInitials(p.name)}</div>
        <div class="pc-name">${escapeHtml(p.name)}${isSelf ? ' (you)' : ''}</div>
        <div class="pc-status">
          <div class="pc-voted-dot ${p.voted ? 'voted' : ''}" title="${p.voted ? 'Voted' : 'Not voted'}"></div>
        </div>
      </div>
      <div class="pc-badges">
        ${p.isHost ? '<span class="badge badge-host">👑 Host</span>' : ''}
        ${p.eliminated ? '<span class="badge badge-eliminated">Out</span>' : ''}
        ${revealedRole}
        ${room.phase === 'voting' && voteCount > 0 ? `<span class="pc-vote-count">🗳️ ${voteCount}</span>` : ''}
      </div>
    `;
    grid.appendChild(card);
  });
}

// ── Action Bar ────────────────────────────────────────────────────
function renderActionBar(room) {
  const startBtn     = document.getElementById('btn-start-game');
  const votingBtn    = document.getElementById('btn-start-voting');
  const nextRoundBtn = document.getElementById('btn-next-round');
  const resetBtn     = document.getElementById('btn-reset');
  const actionInfo   = document.getElementById('action-info');
  const lobbyWaiting = document.getElementById('lobby-waiting');
  const waitingTitle = document.getElementById('waiting-title');
  const waitingSub   = document.getElementById('waiting-subtitle');

  [startBtn, votingBtn, nextRoundBtn, resetBtn].forEach(b => b.style.display = 'none');

  if (room.phase === 'lobby') {
    lobbyWaiting.style.display = 'flex';
    const enough = room.players.length >= 3;
    if (state.isHost) {
      startBtn.style.display = 'inline-flex';
      startBtn.disabled = !enough;
      actionInfo.textContent = enough
        ? `${room.players.length} / ${room.maxPlayers} players ready`
        : `Need at least 3 players (${room.players.length} joined)`;
      waitingTitle.textContent = enough ? 'Ready to start!' : 'Waiting for players…';
      waitingSub.textContent   = enough ? 'Hit Start Game when everyone is in!' : `Need ${3 - room.players.length} more player(s).`;
    } else {
      actionInfo.textContent   = `${room.players.length} / ${room.maxPlayers} players`;
      waitingTitle.textContent = 'Waiting for host to start…';
      waitingSub.textContent   = 'The host will start the game once everyone has joined.';
    }

  } else if (room.phase === 'playing') {
    lobbyWaiting.style.display = 'none';
    if (state.isHost) {
      votingBtn.style.display = 'inline-flex';
      actionInfo.textContent  = 'Discuss freely, then open voting when ready';
    } else {
      actionInfo.textContent = 'Give hints carefully — then wait for the host to open voting!';
    }

  } else if (room.phase === 'voting') {
    lobbyWaiting.style.display = 'none';
    const alive      = room.players.filter(p => !p.eliminated);
    const totalVotes = alive.filter(p => p.voted).length;
    actionInfo.textContent = `${totalVotes} / ${alive.length} votes cast${!state.hasVoted ? ' — click a player to vote!' : ''}`;

  } else if (room.phase === 'revealed') {
    lobbyWaiting.style.display = 'none';
    if (state.isHost) {
      const canNextRound = room.players.filter(p => !p.eliminated).length >= 3;
      if (canNextRound) nextRoundBtn.style.display = 'inline-flex';
      resetBtn.style.display = 'inline-flex';
      actionInfo.textContent = canNextRound ? 'Continue or start fresh' : 'Game over!';
    } else {
      actionInfo.textContent = 'Waiting for host to start next round…';
    }
  }
}

// ── Chat Controls ─────────────────────────────────────────────────
function renderChatControls(room) {
  const input     = document.getElementById('chat-input');
  const sendBtn   = document.getElementById('chat-send-btn');
  const phaseHint = document.getElementById('chat-phase-hint');
  const me        = room.players.find(p => p.id === socket.id);

  const canChat = room.phase === 'playing' && me && !me.eliminated;
  input.disabled   = !canChat;
  sendBtn.disabled = !canChat;
  input.placeholder = canChat
    ? 'Type your hint or argument…'
    : room.phase === 'lobby' ? 'Chat starts when game begins'
    : 'Chat locked during voting / round end';

  const phaseLabels = { lobby: 'Waiting to start', playing: '💬 Argue & give hints!', voting: '🗳️ Voting in progress', revealed: '📊 Round over' };
  phaseHint.textContent = phaseLabels[room.phase] || '';

  // Render messages on full room-update
  if (room.messages && room.messages.length > 0) {
    const container = document.getElementById('chat-messages');
    const newIds    = new Set(room.messages.map(m => m.id));
    // Only clear + re-render if stale (phase change / reconnect)
    const existingIds = new Set([...container.querySelectorAll('[id^="msg-"]')].map(el => el.id.replace('msg-','')));
    const isStale = room.messages.some(m => !existingIds.has(m.id));
    if (isStale) {
      container.innerHTML = '';
      room.messages.forEach(m => appendMessage(m, false));
      container.scrollTop = container.scrollHeight;
    }
  }
}

function appendMessage(msg, scroll = true) {
  const container = document.getElementById('chat-messages');
  if (document.getElementById(`msg-${msg.id}`)) return; // dedupe

  // Remove placeholder if present
  const ph = container.querySelector('.empty-placeholder');
  if (ph) ph.remove();

  const div = document.createElement('div');
  div.id = `msg-${msg.id}`;

  if (msg.type === 'system') {
    div.className = 'chat-msg system';
    div.innerHTML = `<div class="msg-bubble">${escapeHtml(msg.text)}</div>`;
  } else if (msg.type === 'reveal') {
    div.className = 'chat-msg reveal';
    div.innerHTML = `<div class="msg-bubble">${escapeHtml(msg.text)}</div>`;
  } else {
    const isSelf = msg.senderId === socket?.id;
    div.className = `chat-msg ${isSelf ? 'self' : ''}`;
    div.innerHTML = `
      <div class="msg-meta">
        <span class="msg-sender ${isSelf ? 'self' : ''}">${escapeHtml(msg.senderName)}</span>
        <span class="msg-time">${formatTime(msg.timestamp)}</span>
      </div>
      <div class="msg-bubble">${escapeHtml(msg.text)}</div>
    `;
  }
  container.appendChild(div);
  if (scroll) container.scrollTop = container.scrollHeight;

  // Reset unread when user scrolls to bottom
  const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
  if (atBottom) {
    state.unreadCount = 0;
    document.getElementById('unread-badge').style.display = 'none';
  }
}

// ── Voting ────────────────────────────────────────────────────────
function confirmVote(targetId, targetName) {
  if (state.hasVoted) return;
  if (state.votingFor === targetId) {
    castVote(targetId);
  } else {
    state.votingFor = targetId;
    document.querySelectorAll('.player-card.vote-target').forEach(c => {
      c.style.borderColor = '';
      c.style.boxShadow   = '';
    });
    const card = document.getElementById(`player-card-${targetId}`);
    if (card) {
      card.style.borderColor = '#f59e0b';
      card.style.boxShadow   = '0 0 0 3px rgba(245,158,11,0.35)';
    }
    showToast(`Click ${escapeHtml(targetName)} again to confirm your vote`, 'info', 2500);
  }
}

function castVote(targetId) {
  if (state.hasVoted) return;
  state.hasVoted  = true;
  state.votingFor = null;
  socket.emit('cast-vote', { targetId }, ({ success, error }) => {
    if (error) { state.hasVoted = false; showToast(error, 'error'); }
    else showToast('✅ Vote cast!', 'success', 2000);
  });
}

// ── Chat ──────────────────────────────────────────────────────────
function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function sendMessage() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';
  socket.emit('send-message', { text }, ({ error }) => {
    if (error) showToast(error, 'error');
  });
}

// ── Host Actions ──────────────────────────────────────────────────
function startGame() {
  socket.emit('start-game', {}, ({ error }) => { if (error) showToast(error, 'error'); });
}

function startVoting() {
  socket.emit('start-voting', {}, ({ error }) => {
    if (error) showToast(error, 'error');
    else { state.hasVoted = false; state.votingFor = null; }
  });
}

function nextRound() {
  closeRevealModal();
  socket.emit('next-round', {}, ({ error }) => {
    if (error) { showToast(error, 'error'); return; }
    state.myCard = null;
    state.hasVoted = false;
    state.votingFor = null;
    resetCardUI('Distributing new cards…');
  });
}

function resetRoom() {
  if (!confirm('Reset the game? All progress will be lost.')) return;
  socket.emit('reset-room', {}, ({ error }) => {
    if (error) { showToast(error, 'error'); return; }
    state.myCard = null;
    state.hasVoted = false;
    state.votingFor = null;
    closeRevealModal();
    resetCardUI('Waiting for the host to start the game…');
  });
}

function resetCardUI(msg) {
  const cardEl = document.getElementById('my-card');
  cardEl.className = 'my-card card-waiting';
  cardEl.innerHTML = `
    <div class="card-big-icon">🃏</div>
    <div class="card-info">
      <div class="card-role-label">Your Secret Card</div>
      <div class="card-waiting-text">${msg}</div>
    </div>
  `;
}

// ── Reveal Modal ──────────────────────────────────────────────────
function showRevealModal(player, tally, winner) {
  const overlay = document.getElementById('reveal-modal-overlay');
  overlay.classList.remove('hidden');

  const meta = getRoleMeta(player.role);

  document.getElementById('reveal-player-name').textContent = player.name;
  document.getElementById('reveal-role-icon').textContent   = meta.icon;
  document.getElementById('reveal-role-name').textContent   = meta.label;
  document.getElementById('reveal-role-name').style.color   =
    player.role === 'civilian' ? 'var(--civilian)' : player.role === 'impostor' ? 'var(--impostor)' : 'var(--mrwhite)';

  const wordEl = document.getElementById('reveal-word');
  if (player.role === 'mrwhite') wordEl.innerHTML = 'Had <strong>no word</strong>';
  else if (player.word) wordEl.innerHTML = `Their word was <strong>${escapeHtml(player.word)}</strong>`;
  else wordEl.textContent = '';

  // Reset word reveal state
  window.wordRevealed = false;
  wordEl.style.filter = 'blur(8px)';
  const toggleBtn = document.getElementById('toggle-word-btn');
  if (toggleBtn) toggleBtn.innerHTML = '👁️ Show Word';

  // Vote tally
  const tallyEl = document.getElementById('vote-tally');
  tallyEl.innerHTML = '<div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;">Vote Tally</div>';

  if (state.room) {
    const rows = state.room.players
      .map(p => ({ name: p.name, id: p.id, votes: tally[p.id] || 0 }))
      .sort((a, b) => b.votes - a.votes);

    rows.forEach(r => {
      const row = document.createElement('div');
      row.className = `vote-tally-row ${r.id === player.id ? 'most-voted' : ''}`;
      row.innerHTML = `
        <span>${escapeHtml(r.name)}${r.id === player.id ? ' 👈' : ''}</span>
        <span>${r.votes} vote${r.votes !== 1 ? 's' : ''} ${'🗳️'.repeat(Math.min(r.votes, 6))}</span>
      `;
      tallyEl.appendChild(row);
    });
  }

  // Winner banner
  const banner = document.getElementById('winner-banner');
  if (winner) {
    banner.style.display = 'block';
    banner.className = winner === 'civilians' ? 'winner-banner winner-civilians' : 'winner-banner winner-impostors';
    banner.textContent = winner === 'civilians'
      ? '🎉 Civilians Win! All impostors caught!'
      : '😈 Impostors Win! They outnumber civilians!';
  } else {
    banner.style.display = 'none';
  }

  // Host buttons
  document.getElementById('reveal-next-btn').style.display  = state.isHost && !winner ? 'inline-flex' : 'none';
  document.getElementById('reveal-reset-btn').style.display = state.isHost ? 'inline-flex' : 'none';
}

function closeRevealModal() {
  document.getElementById('reveal-modal-overlay').classList.add('hidden');
}

// ── Reveal Modal ──────────────────────────────────────────────────
function toggleRevealWord() {
  const wordEl = document.getElementById('reveal-word');
  const btnEl = document.getElementById('toggle-word-btn');
  window.wordRevealed = !window.wordRevealed;

  if (window.wordRevealed) {
    wordEl.style.filter = 'none';
    if (btnEl) btnEl.innerHTML = '🙈 Hide Word';
  } else {
    wordEl.style.filter = 'blur(8px)';
    if (btnEl) btnEl.innerHTML = '👁️ Show Word';
  }
}

// ── Room utils ────────────────────────────────────────────────────
async function copyRoomLink() {
  const link = `${window.location.origin}/?room=${state.roomId}`;
  await copyText(link);
  showToast('🔗 Invite link copied!', 'success');
}

function leaveRoom() {
  if (!confirm('Leave this room?')) return;
  SESSION.remove('player');
  socket.disconnect();
  window.location.href = '/';
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
