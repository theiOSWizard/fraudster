const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ──────────────────────────────────────────────────────────────
// Word pairs: [civilian word, impostor word]
// ──────────────────────────────────────────────────────────────
const WORD_PAIRS = [
  ['Apple', 'Pear'],
  ['Guitar', 'Violin'],
  ['Ocean', 'Lake'],
  ['Pizza', 'Burger'],
  ['Lion', 'Tiger'],
  ['Coffee', 'Tea'],
  ['Football', 'Rugby'],
  ['Batman', 'Superman'],
  ['Gold', 'Silver'],
  ['Volcano', 'Earthquake'],
  ['Nurse', 'Doctor'],
  ['Library', 'Bookstore'],
  ['Helicopter', 'Airplane'],
  ['Diamond', 'Ruby'],
  ['Sushi', 'Ramen'],
  ['Castle', 'Fortress'],
  ['Cheetah', 'Leopard'],
  ['Twitter', 'Instagram'],
  ['Chocolate', 'Vanilla'],
  ['Passport', 'ID Card'],
  ['Telescope', 'Microscope'],
  ['Ballet', 'Gymnastics'],
  ['Crocodile', 'Alligator'],
  ['Piano', 'Keyboard'],
  ['Tsunami', 'Tornado'],
  ['Cathedral', 'Mosque'],
  ['Subway', 'Train'],
  ['Champagne', 'Wine'],
  ['Astronaut', 'Cosmonaut'],
  ['Skateboard', 'Surfboard'],
];

// ──────────────────────────────────────────────────────────────
// In-memory state
// ──────────────────────────────────────────────────────────────
const rooms = new Map(); // roomId → Room

function createRoom({ hostId, hostName, maxPlayers, roleConfig }) {
  const roomId = uuidv4().slice(0, 8).toUpperCase();
  const room = {
    id: roomId,
    hostId,
    maxPlayers,
    roleConfig, // 'impostor' | 'mrwhite' | 'both'
    players: [],         // { id, name, role, word, voted, eliminated, isHost }
    messages: [],
    phase: 'lobby',      // lobby | playing | voting | revealed
    votes: {},           // targetId → [voterIds]
    roundNumber: 0,
    civilianWord: null,
    impostorWord: null,
    createdAt: Date.now(),
  };
  rooms.set(roomId, room);
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function getRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.find(p => p.id === socketId)) return room;
  }
  return null;
}

function sanitizeRoom(room) {
  // Remove sensitive word data before sending to clients
  return {
    id: room.id,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    roleConfig: room.roleConfig,
    phase: room.phase,
    roundNumber: room.roundNumber,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      eliminated: p.eliminated,
      voted: p.voted,
      // Only reveal role/word if eliminated or phase === 'revealed'
      role: (p.eliminated || room.phase === 'revealed') ? p.role : undefined,
      word: (p.eliminated || room.phase === 'revealed') ? p.word : undefined,
    })),
    messages: room.messages,
    votes: room.votes,
  };
}

function assignRoles(room) {
  const pair = WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];
  room.civilianWord = pair[0];
  room.impostorWord = pair[1];

  const activePlayers = room.players.filter(p => !p.eliminated);
  const shuffled = [...activePlayers].sort(() => Math.random() - 0.5);

  const totalCount = shuffled.length;

  // Determine how many special roles to assign
  let specialCount = totalCount <= 4 ? 1 : totalCount <= 6 ? 2 : 3;

  let impostorCount = 0;
  let mrWhiteCount = 0;

  if (room.roleConfig === 'impostor') {
    impostorCount = specialCount;
  } else if (room.roleConfig === 'mrwhite') {
    mrWhiteCount = specialCount;
  } else { // both
    mrWhiteCount = Math.floor(specialCount / 2);
    impostorCount = specialCount - mrWhiteCount;
  }

  let assigned = 0;
  for (let i = 0; i < shuffled.length; i++) {
    const p = shuffled[i];
    if (assigned < impostorCount) {
      p.role = 'impostor';
      p.word = room.impostorWord;
      assigned++;
    } else if (assigned < impostorCount + mrWhiteCount) {
      p.role = 'mrwhite';
      p.word = null; // Mr. White gets no word
      assigned++;
    } else {
      p.role = 'civilian';
      p.word = room.civilianWord;
    }
    p.voted = false;
  }
}

function tallyVotes(room) {
  const tally = {};
  room.players.forEach(p => { tally[p.id] = 0; });
  Object.entries(room.votes).forEach(([targetId, voters]) => {
    tally[targetId] = voters.length;
  });
  let maxVotes = 0;
  let mostVotedId = null;
  Object.entries(tally).forEach(([id, count]) => {
    if (count > maxVotes) {
      maxVotes = count;
      mostVotedId = id;
    }
  });
  return { tally, mostVotedId, maxVotes };
}

function checkWinCondition(room) {
  const alive = room.players.filter(p => !p.eliminated);
  const aliveImpostors = alive.filter(p => p.role === 'impostor' || p.role === 'mrwhite');
  const aliveCivilians = alive.filter(p => p.role === 'civilian');

  if (aliveImpostors.length === 0) return 'civilians';
  if (aliveImpostors.length >= aliveCivilians.length) return 'impostors';
  return null;
}

// ──────────────────────────────────────────────────────────────
// REST: Check if room exists
// ──────────────────────────────────────────────────────────────
app.get('/api/room/:roomId', (req, res) => {
  const room = getRoom(req.params.roomId.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ exists: true, phase: room.phase, maxPlayers: room.maxPlayers, playerCount: room.players.length });
});

// ──────────────────────────────────────────────────────────────
// Socket.io
// ──────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Socket connected: ${socket.id}`);

  // ── CREATE ROOM ──────────────────────────────────────────────
  socket.on('create-room', ({ name, maxPlayers, roleConfig }, cb) => {
    const room = createRoom({
      hostId: socket.id,
      hostName: name,
      maxPlayers: parseInt(maxPlayers),
      roleConfig,
    });

    const player = {
      id: socket.id,
      name,
      isHost: true,
      role: null,
      word: null,
      eliminated: false,
      voted: false,
    };
    room.players.push(player);
    socket.join(room.id);
    console.log(`[Room] ${room.id} created by ${name}`);
    cb({ roomId: room.id });
    io.to(room.id).emit('room-update', sanitizeRoom(room));
  });

  // ── JOIN ROOM ─────────────────────────────────────────────────
  socket.on('join-room', ({ roomId, name }, cb) => {
    const room = getRoom(roomId.toUpperCase());
    if (!room) return cb({ error: 'Room not found' });
    if (room.phase !== 'lobby') return cb({ error: 'Game already started' });
    if (room.players.length >= room.maxPlayers) return cb({ error: 'Room is full' });
    if (room.players.find(p => p.name.toLowerCase() === name.toLowerCase())) {
      return cb({ error: 'Name already taken in this room' });
    }

    const player = {
      id: socket.id,
      name,
      isHost: false,
      role: null,
      word: null,
      eliminated: false,
      voted: false,
    };
    room.players.push(player);
    socket.join(room.id);

    const joinMsg = {
      id: uuidv4(),
      type: 'system',
      text: `${name} joined the room`,
      timestamp: Date.now(),
    };
    room.messages.push(joinMsg);

    console.log(`[Room] ${name} joined ${room.id}`);
    cb({ success: true });
    io.to(room.id).emit('room-update', sanitizeRoom(room));
  });

  // ── START GAME ────────────────────────────────────────────────
  socket.on('start-game', (_, cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return cb?.({ error: 'Not in a room' });
    if (room.hostId !== socket.id) return cb?.({ error: 'Only host can start' });
    if (room.players.length < 3) return cb?.({ error: 'Need at least 3 players' });
    if (room.phase !== 'lobby') return cb?.({ error: 'Game already started' });

    room.phase = 'playing';
    room.roundNumber++;
    room.votes = {};
    room.players.forEach(p => { p.voted = false; });

    assignRoles(room);

    const startMsg = {
      id: uuidv4(),
      type: 'system',
      text: '🎮 Game started! Each player has received their secret card. Give hints one by one, then vote!',
      timestamp: Date.now(),
    };
    room.messages.push(startMsg);

    // Send personalised card to each player
    room.players.forEach(p => {
      io.to(p.id).emit('your-card', {
        role: p.role,
        word: p.word,
      });
    });

    io.to(room.id).emit('room-update', sanitizeRoom(room));
    cb?.({ success: true });
  });

  // ── SEND CHAT MESSAGE ─────────────────────────────────────────
  socket.on('send-message', ({ text }, cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.eliminated) return;
    if (room.phase !== 'playing') return;

    const msg = {
      id: uuidv4(),
      type: 'chat',
      senderId: socket.id,
      senderName: player.name,
      text: text.trim().slice(0, 200),
      timestamp: Date.now(),
    };
    room.messages.push(msg);
    if (room.messages.length > 200) room.messages.shift();

    io.to(room.id).emit('new-message', msg);
    cb?.({ success: true });
  });

  // ── START VOTING ──────────────────────────────────────────────
  socket.on('start-voting', (_, cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return cb?.({ error: 'Not in a room' });
    if (room.hostId !== socket.id) return cb?.({ error: 'Only host can start voting' });
    if (room.phase !== 'playing') return cb?.({ error: 'Not in playing phase' });

    room.phase = 'voting';
    room.votes = {};
    room.players.forEach(p => { p.voted = false; });

    const voteMsg = {
      id: uuidv4(),
      type: 'system',
      text: '🗳️ Voting has begun! Cast your vote for who you think is the Impostor!',
      timestamp: Date.now(),
    };
    room.messages.push(voteMsg);

    io.to(room.id).emit('room-update', sanitizeRoom(room));
    cb?.({ success: true });
  });

  // ── CAST VOTE ─────────────────────────────────────────────────
  socket.on('cast-vote', ({ targetId }, cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return cb?.({ error: 'Not in a room' });
    if (room.phase !== 'voting') return cb?.({ error: 'Not in voting phase' });

    const voter = room.players.find(p => p.id === socket.id);
    if (!voter || voter.eliminated) return cb?.({ error: 'Cannot vote' });
    if (voter.voted) return cb?.({ error: 'Already voted' });

    const target = room.players.find(p => p.id === targetId && !p.eliminated);
    if (!target) return cb?.({ error: 'Invalid target' });
    if (targetId === socket.id) return cb?.({ error: 'Cannot vote for yourself' });

    voter.voted = true;
    if (!room.votes[targetId]) room.votes[targetId] = [];
    room.votes[targetId].push(socket.id);

    const voteMsg = {
      id: uuidv4(),
      type: 'system',
      text: `${voter.name} has voted`,
      timestamp: Date.now(),
    };
    room.messages.push(voteMsg);

    // Check if all active players have voted
    const activePlayers = room.players.filter(p => !p.eliminated);
    const allVoted = activePlayers.every(p => p.voted);

    io.to(room.id).emit('room-update', sanitizeRoom(room));

    if (allVoted) {
      // Auto-reveal
      const { tally, mostVotedId, maxVotes } = tallyVotes(room);
      const eliminated = room.players.find(p => p.id === mostVotedId);
      if (eliminated) {
        eliminated.eliminated = true;
        room.phase = 'revealed';

        const revealMsg = {
          id: uuidv4(),
          type: 'reveal',
          text: `🃏 ${eliminated.name} received the most votes (${maxVotes})! Their card is revealed!`,
          revealedPlayer: {
            id: eliminated.id,
            name: eliminated.name,
            role: eliminated.role,
            word: eliminated.word,
          },
          timestamp: Date.now(),
        };
        room.messages.push(revealMsg);

        const winner = checkWinCondition(room);
        if (winner) {
          const winMsg = {
            id: uuidv4(),
            type: 'system',
            text: winner === 'civilians'
              ? '🎉 Civilians win! All impostors have been eliminated!'
              : '😈 Impostors win! They now outnumber the civilians!',
            timestamp: Date.now(),
          };
          room.messages.push(winMsg);
          room.phase = 'revealed';
        }

        io.to(room.id).emit('room-update', sanitizeRoom(room));
        io.to(room.id).emit('player-revealed', {
          player: {
            id: eliminated.id,
            name: eliminated.name,
            role: eliminated.role,
            word: eliminated.word,
          },
          tally,
          winner,
        });
      }
    }

    cb?.({ success: true });
  });

  // ── NEXT ROUND ────────────────────────────────────────────────
  socket.on('next-round', (_, cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return cb?.({ error: 'Not in a room' });
    if (room.hostId !== socket.id) return cb?.({ error: 'Only host can start next round' });
    if (room.phase !== 'revealed') return cb?.({ error: 'Not in revealed phase' });

    const alive = room.players.filter(p => !p.eliminated);
    if (alive.length < 3) return cb?.({ error: 'Not enough players for a new round' });

    room.phase = 'playing';
    room.roundNumber++;
    room.votes = {};
    room.players.forEach(p => {
      if (!p.eliminated) p.voted = false;
    });

    assignRoles(room);

    const roundMsg = {
      id: uuidv4(),
      type: 'system',
      text: `🔄 Round ${room.roundNumber} started! New roles distributed.`,
      timestamp: Date.now(),
    };
    room.messages.push(roundMsg);

    room.players.forEach(p => {
      if (!p.eliminated) {
        io.to(p.id).emit('your-card', {
          role: p.role,
          word: p.word,
        });
      }
    });

    io.to(room.id).emit('room-update', sanitizeRoom(room));
    cb?.({ success: true });
  });

  // ── RESET ROOM ────────────────────────────────────────────────
  socket.on('reset-room', (_, cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return cb?.({ error: 'Not in a room' });
    if (room.hostId !== socket.id) return cb?.({ error: 'Only host can reset' });

    room.phase = 'lobby';
    room.roundNumber = 0;
    room.votes = {};
    room.messages = [];
    room.civilianWord = null;
    room.impostorWord = null;
    room.players.forEach(p => {
      p.role = null;
      p.word = null;
      p.eliminated = false;
      p.voted = false;
    });

    io.to(room.id).emit('room-update', sanitizeRoom(room));
    cb?.({ success: true });
  });

  // ── DISCONNECT ────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // Remove player
    room.players = room.players.filter(p => p.id !== socket.id);

    const leaveMsg = {
      id: uuidv4(),
      type: 'system',
      text: `${player.name} left the room`,
      timestamp: Date.now(),
    };
    room.messages.push(leaveMsg);

    // If host left, assign new host
    if (room.hostId === socket.id && room.players.length > 0) {
      room.players[0].isHost = true;
      room.hostId = room.players[0].id;
      const newHostMsg = {
        id: uuidv4(),
        type: 'system',
        text: `${room.players[0].name} is now the host`,
        timestamp: Date.now(),
      };
      room.messages.push(newHostMsg);
    }

    if (room.players.length === 0) {
      rooms.delete(room.id);
      console.log(`[Room] ${room.id} deleted (empty)`);
      return;
    }

    io.to(room.id).emit('room-update', sanitizeRoom(room));
    console.log(`[-] ${player.name} disconnected from ${room.id}`);
  });
});

// ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Impostor Game server running on http://localhost:${PORT}`);
});
