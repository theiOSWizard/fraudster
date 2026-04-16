# 🕵️ Impostor Game

A **real-time multiplayer social deduction game** built with Node.js + Socket.io.

---

## 🎮 How to Play

### Roles
| Role | Description |
|------|-------------|
| 🏙️ **Civilian** | Gets the real secret word. Give hints without revealing too much! |
| 🎭 **Impostor** | Gets a *similar but different* word. Blend in with civilians! |
| 👁️ **Mr. White** | Gets **no word**. Listen, guess, and bluff your way through! |

### Game Flow
1. **Host creates a room** — picks max players and which special roles to include
2. **Players join via shared link** — enter a name, no account needed
3. **Host starts the game** — everyone receives their secret card privately
4. **Discussion phase** — players chat, give one-word hints, and argue
5. **Host opens voting** — everyone clicks a player card to vote
6. **Reveal** — player with the most votes is eliminated and their card is flipped!
7. Keep going until one side wins!

---

## 🚀 Running Locally

```bash
npm install
npm start
# Visit http://localhost:3000
```

For development with auto-reload:
```bash
npm run dev
```

---

## 📁 Project Structure

```
impostor-game/
├── server.js              # Express + Socket.io server
├── package.json
├── public/
│   ├── index.html         # Landing / lobby page
│   ├── game.html          # Game room page
│   ├── css/
│   │   ├── style.css      # Global design system
│   │   ├── lobby.css      # Lobby page styles
│   │   └── game.css       # Game room styles
│   └── js/
│       ├── utils.js       # Shared utilities
│       ├── lobby.js       # Create/join room logic
│       └── game.js        # In-game logic
```

---

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| PORT    | 3000    | Server port (`PORT=8080 npm start`) |
| Max Players | 4–12 | Configurable per room |
| Role Config | Both | Impostor only / Mr. White only / Both |

---

## 🧠 Win Conditions

- **Civilians win** when all impostors/Mr. Whites are eliminated
- **Impostors win** when they equal or outnumber the civilians

---

## 🛠 Tech Stack

- **Backend:** Node.js, Express, Socket.io, UUID
- **Frontend:** Vanilla HTML/CSS/JS (no framework)
- **Design:** Glassmorphism dark theme, Google Fonts (Outfit + JetBrains Mono)
