/* ================================================================
   lobby.js — Landing page logic (create / join room)
   NOTE: No socket connection here! Room creation/joining happens
   entirely in game.js — one socket, one room, no ID mismatch.
   ================================================================ */

// ── On load — check for room code in URL ──────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('room');
  if (roomId) {
    document.getElementById('join-code').value = roomId.toUpperCase();
    showJoin();
  }
  updateRoleExplainer();
  document.getElementById('create-roles').addEventListener('change', updateRoleExplainer);
});

// ── Modal Controls ───────────────────────────────────────────────
function showCreate() {
  document.getElementById('modal-create').classList.remove('hidden');
  setTimeout(() => document.getElementById('create-name').focus(), 100);
}

function showJoin() {
  document.getElementById('modal-join').classList.remove('hidden');
  setTimeout(() => {
    const codeInput = document.getElementById('join-code');
    const nameInput = document.getElementById('join-name');
    if (codeInput.value) nameInput.focus();
    else codeInput.focus();
  }, 100);
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function closeModalOutside(e, id) {
  if (e.target.id === id) closeModal(id);
}

// ── Role config explainer ─────────────────────────────────────────
function updateRoleExplainer() {
  const val = document.getElementById('create-roles').value;
  const el  = document.getElementById('role-explainer');
  const texts = {
    impostor: '🎭 <strong>Impostor Only:</strong> Some players get a similar-but-different word — they must blend in with civilians.',
    mrwhite:  '👁️ <strong>Mr. White Only:</strong> Some players get NO word at all — they must listen carefully and bluff.',
    both:     '🎭👁️ <strong>Both Roles:</strong> The room will have both Impostors (different word) and a Mr. White (no word). Most challenging!',
  };
  el.innerHTML = texts[val] || '';
}

// ── Create Room ───────────────────────────────────────────────────
// Just saves session config then delegates everything to game.js
function handleCreate(e) {
  e.preventDefault();
  const name       = document.getElementById('create-name').value.trim();
  const maxPlayers = document.getElementById('create-max').value;
  const roleConfig = document.getElementById('create-roles').value;

  if (!name) { showToast('Please enter your name', 'error'); return; }

  const btn = document.getElementById('create-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px"></span> Creating…';

  // Save session. No socket here — room is created in game.js
  SESSION.save('player', { name, isHost: true, maxPlayers, roleConfig });

  // Navigate to game page (no room ID in URL yet — game.js will update it)
  window.location.href = '/game.html';
}

// ── Join Room ─────────────────────────────────────────────────────
async function handleJoin(e) {
  e.preventDefault();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  const name = document.getElementById('join-name').value.trim();

  if (!code) { showToast('Please enter a room code', 'error'); return; }
  if (!name) { showToast('Please enter your name', 'error'); return; }
  if (code.length !== 8) { showToast('Room code must be 8 characters', 'error'); return; }

  const btn = document.getElementById('join-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px"></span> Checking room…';

  // Verify room exists first via REST (no socket needed)
  try {
    const res = await fetch(`/api/room/${code}`);
    if (!res.ok) {
      const data = await res.json();
      showToast(data.error || 'Room not found', 'error');
      btn.disabled = false;
      btn.innerHTML = '<span>🚪</span> Join Room';
      return;
    }
    const data = await res.json();
    if (data.phase !== 'lobby') {
      showToast('Game already in progress — you cannot join', 'error');
      btn.disabled = false;
      btn.innerHTML = '<span>🚪</span> Join Room';
      return;
    }
    if (data.playerCount >= data.maxPlayers) {
      showToast('Room is full!', 'error');
      btn.disabled = false;
      btn.innerHTML = '<span>🚪</span> Join Room';
      return;
    }
  } catch {
    showToast('Could not reach the server', 'error');
    btn.disabled = false;
    btn.innerHTML = '<span>🚪</span> Join Room';
    return;
  }

  // Save session — actual socket join happens in game.js (one connection only)
  SESSION.save('player', { name, roomId: code, isHost: false });
  window.location.href = `/game.html?room=${code}`;
}
