/* ================================================================
   utils.js — Shared client-side utilities
   ================================================================ */

// ── Toast notifications ──────────────────────────────────────────
function showToast(msg, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  toast.textContent = `${icons[type] || ''} ${msg}`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 310);
  }, duration);
}

// ── Format timestamp ─────────────────────────────────────────────
function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Avatar initials ──────────────────────────────────────────────
function getInitials(name = '') {
  return name.trim().slice(0, 2).toUpperCase() || '??';
}

// ── Avatar color from name ───────────────────────────────────────
const AVATAR_COLORS = [
  ['#9352ff','#7c3aed'],
  ['#ff5294','#be185d'],
  ['#52d4ff','#0891b2'],
  ['#f59e0b','#d97706'],
  ['#4ade80','#16a34a'],
  ['#fb923c','#ea580c'],
  ['#a78bfa','#7c3aed'],
  ['#34d399','#059669'],
];
function avatarGradient(name = '') {
  const idx = Math.abs(name.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % AVATAR_COLORS.length;
  const [a, b] = AVATAR_COLORS[idx];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

// ── Role metadata ────────────────────────────────────────────────
const ROLE_META = {
  civilian: {
    icon: '🏙️',
    label: 'Civilian',
    colorClass: 'civilian',
    tip: 'You know the real word. Give hints without being too obvious — the impostor is listening!',
  },
  impostor: {
    icon: '🎭',
    label: 'Impostor',
    colorClass: 'impostor',
    tip: 'You have a similar but DIFFERENT word. Blend in, sound convincing, and avoid detection!',
  },
  mrwhite: {
    icon: '👁️',
    label: 'Mr. White',
    colorClass: 'mrwhite',
    tip: 'You have NO word! Listen carefully to clues, guess what word others have, and bluff!',
  },
};

function getRoleMeta(role) {
  return ROLE_META[role] || { icon: '🃏', label: 'Unknown', colorClass: '', tip: '' };
}

// ── Copy to clipboard ────────────────────────────────────────────
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return true;
  }
}

// ── Session storage helpers ──────────────────────────────────────
const SESSION = {
  save(key, val) { sessionStorage.setItem(key, JSON.stringify(val)); },
  load(key) {
    try { return JSON.parse(sessionStorage.getItem(key)); }
    catch { return null; }
  },
  remove(key) { sessionStorage.removeItem(key); },
};
