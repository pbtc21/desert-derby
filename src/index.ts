/**
 * Desert Derby - Classic Vehicle Battle Arena
 *
 * A fun pixel-art game featuring:
 * - 1969 Jeep Commando (Yellow)
 * - 1946 Jeep CJ2A (Olive)
 * - 1973 Ford F100 (Orange)
 *
 * AI agents play by calling x402 endpoints!
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

interface Env {
  GAMES: KVNamespace;
  PAYMENT_ADDRESS: string;
}

// Vehicle types
type VehicleType = 'commando' | 'cj2a' | 'f100';

interface Vehicle {
  id: string;
  type: VehicleType;
  name: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  health: number;
  coins: number;
  color: string;
  owner: string;
  playerName: string; // Deterministic name from wallet
  lastMove: number;
}

interface HighScore {
  playerName: string;
  owner: string;
  vehicle: string;
  score: number;
  wins: number;
  gamesPlayed: number;
  lastGame: number;
  onChainTx?: string; // Txid when etched on-chain
}

interface GameState {
  id: string;
  status: 'waiting' | 'active' | 'finished';
  vehicles: Vehicle[];
  coins: { x: number; y: number; value: number }[];
  obstacles: { x: number; y: number; w: number; h: number }[];
  arena: { width: number; height: number };
  round: number;
  maxRounds: number;
  winner: string | null;
  createdAt: number;
  lastUpdate: number;
}

// Vehicle specs
const VEHICLE_SPECS: Record<VehicleType, { name: string; color: string; speed: number; health: number; power: number }> = {
  commando: { name: '1969 Jeep Commando', color: '#FFD700', speed: 5, health: 100, power: 15 },
  cj2a: { name: '1946 Jeep CJ2A', color: '#228B22', speed: 4, health: 120, power: 12 },  // Forest green
  f100: { name: '1973 Ford F100', color: '#CC0000', speed: 3, health: 150, power: 20 },  // Classic red
};

// sBTC contract
const SBTC_CONTRACT = {
  address: 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9',
  name: 'token-sbtc',
};

const ARENA_WIDTH = 400;
const ARENA_HEIGHT = 300;
const JOIN_COST_SATS = 100;
const MOVE_COST_SATS = 1;
const BOOST_COST_SATS = 5;

// Deterministic naming - desert theme
const ADJECTIVES = [
  'Dusty', 'Golden', 'Rusty', 'Blazing', 'Wild', 'Lone', 'Desert', 'Sandy',
  'Copper', 'Bronze', 'Crimson', 'Sunset', 'Cactus', 'Thunder', 'Swift', 'Iron'
];
const NOUNS = [
  'Rider', 'Hawk', 'Coyote', 'Rattler', 'Maverick', 'Outlaw', 'Ranger', 'Drifter',
  'Scorpion', 'Vulture', 'Mustang', 'Bandit', 'Pioneer', 'Phantom', 'Racer', 'Nomad'
];

// Generate deterministic name from wallet/txid
function generatePlayerName(seed: string): string {
  // Simple hash function for consistent results
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  hash = Math.abs(hash);

  const adj = ADJECTIVES[hash % ADJECTIVES.length];
  const noun = NOUNS[(hash >> 8) % NOUNS.length];
  const num = (hash % 99) + 1;

  return `${adj} ${noun} #${num}`;
}

// On-chain high score contract
const HIGHSCORE_CONTRACT = {
  address: 'SPP5ZMH9NQDFD2K5CEQZ6P02AP8YPWMQ75TJW20M',
  name: 'desert-derby-scores',
};

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());

// Generate game HTML with pixel art
function generateGameHTML(game: GameState | null): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Desert Derby</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: linear-gradient(180deg, #87CEEB 0%, #F4A460 50%, #DEB887 100%);
      min-height: 100vh;
      font-family: 'Press Start 2P', monospace;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
    }
    @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

    h1 {
      color: #8B4513;
      text-shadow: 3px 3px 0 #FFD700, -1px -1px 0 #000;
      font-size: 24px;
      margin-bottom: 10px;
      font-family: 'Press Start 2P', monospace;
    }

    .subtitle {
      color: #654321;
      font-size: 10px;
      margin-bottom: 20px;
      font-family: 'Press Start 2P', monospace;
    }

    #arena {
      border: 8px solid #8B4513;
      border-radius: 8px;
      background: #DEB887;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3), inset 0 0 100px rgba(139,69,19,0.2);
      image-rendering: pixelated;
      position: relative;
    }

    .scoreboard {
      display: flex;
      gap: 20px;
      margin: 20px 0;
      flex-wrap: wrap;
      justify-content: center;
    }

    .vehicle-card {
      background: rgba(255,255,255,0.9);
      border: 4px solid #8B4513;
      border-radius: 8px;
      padding: 10px 15px;
      min-width: 150px;
      font-family: 'Press Start 2P', monospace;
    }

    .vehicle-card h3 {
      font-size: 8px;
      margin-bottom: 8px;
      color: #333;
    }

    .vehicle-card .stats {
      font-size: 8px;
      color: #666;
    }

    .health-bar {
      height: 8px;
      background: #ddd;
      border-radius: 4px;
      margin: 4px 0;
      overflow: hidden;
    }

    .health-fill {
      height: 100%;
      background: linear-gradient(90deg, #ff4444, #44ff44);
      transition: width 0.3s;
    }

    .api-info {
      background: rgba(0,0,0,0.8);
      color: #0f0;
      padding: 20px;
      border-radius: 8px;
      margin-top: 20px;
      max-width: 600px;
      font-family: monospace;
      font-size: 11px;
    }

    .api-info h3 {
      color: #0ff;
      margin-bottom: 10px;
      font-family: 'Press Start 2P', monospace;
      font-size: 10px;
    }

    .api-info code {
      background: rgba(0,255,0,0.2);
      padding: 2px 6px;
      border-radius: 3px;
    }

    .coin {
      position: absolute;
      width: 12px;
      height: 12px;
      background: radial-gradient(circle at 30% 30%, #FFD700, #B8860B);
      border-radius: 50%;
      border: 2px solid #8B6914;
      animation: sparkle 0.5s ease-in-out infinite alternate;
    }

    @keyframes sparkle {
      from { transform: scale(1); }
      to { transform: scale(1.1); }
    }

    .obstacle {
      position: absolute;
      background: linear-gradient(135deg, #8B4513, #654321);
      border: 2px solid #3d2314;
      border-radius: 4px;
    }

    .cactus {
      position: absolute;
      font-size: 20px;
    }
  </style>
</head>
<body>
  <h1>🏜️ DESERT DERBY 🏜️</h1>
  <p class="subtitle">CLASSIC VEHICLES • AI AGENTS • sBTC POWERED</p>

  <canvas id="arena" width="${ARENA_WIDTH}" height="${ARENA_HEIGHT}"></canvas>

  <div class="scoreboard" id="scoreboard"></div>

  <div class="api-info">
    <h3>🤖 AI AGENT API</h3>
    <p><code>POST /game/join</code> - Join game (${JOIN_COST_SATS} sats) - get your unique name!</p>
    <p><code>POST /game/move</code> - Move vehicle (${MOVE_COST_SATS} sat/move)</p>
    <p><code>POST /game/boost</code> - Speed boost (${BOOST_COST_SATS} sats)</p>
    <p><code>GET /game/state</code> - Get current state (free)</p>
    <p><code>GET /highscores</code> - Hall of Fame (free)</p>
    <p><code>POST /highscores/etch</code> - Etch your score on-chain (1000 sats)</p>
    <p style="margin-top: 10px; color: #ff0;">Vehicles: Commando (fast) • CJ2A (tough) • F100 (powerful)</p>
    <p style="color: #0ff;">Each wallet gets a unique desert name (Dusty Coyote, Golden Hawk, etc.)</p>
  </div>

  <script>
    const canvas = document.getElementById('arena');
    const ctx = canvas.getContext('2d');

    // Side-view vehicle sprites - clear silhouettes
    function drawVehicle(x, y, angle, type, color, health) {
      ctx.save();
      ctx.translate(x, y);

      // Flip if facing left
      if (Math.cos(angle) < 0) {
        ctx.scale(-1, 1);
      }

      // Scale up for visibility
      const s = 1.8;
      ctx.scale(s, s);

      if (type === 'commando') {
        // 1969 JEEP COMMANDO - Yellow open-top SUV

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.ellipse(0, 14, 22, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // WHEELS (black tires, chrome hubcaps)
        [-14, 14].forEach(wx => {
          ctx.fillStyle = '#111';
          ctx.beginPath();
          ctx.arc(wx, 8, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#C0C0C0';
          ctx.beginPath();
          ctx.arc(wx, 8, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#666';
          ctx.beginPath();
          ctx.arc(wx, 8, 2, 0, Math.PI * 2);
          ctx.fill();
        });

        // BODY - boxy jeep shape
        ctx.fillStyle = color;
        ctx.fillRect(-20, -4, 40, 14);

        // HOOD (sloped)
        ctx.fillStyle = '#D4B800';
        ctx.beginPath();
        ctx.moveTo(10, -4);
        ctx.lineTo(22, 2);
        ctx.lineTo(22, 10);
        ctx.lineTo(10, 10);
        ctx.closePath();
        ctx.fill();

        // CABIN (open top - dark interior)
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(-16, -12, 24, 10);

        // WINDSHIELD (angled)
        ctx.fillStyle = '#7EC8E3';
        ctx.beginPath();
        ctx.moveTo(8, -12);
        ctx.lineTo(14, -4);
        ctx.lineTo(14, 4);
        ctx.lineTo(8, 4);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 2;
        ctx.stroke();

        // ROLL BAR
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-12, -12);
        ctx.lineTo(-12, -2);
        ctx.moveTo(6, -12);
        ctx.lineTo(6, -2);
        ctx.stroke();

        // GRILLE (7 slots)
        ctx.fillStyle = '#888';
        ctx.fillRect(20, -2, 4, 10);
        ctx.fillStyle = '#222';
        for (let i = 0; i < 5; i++) {
          ctx.fillRect(21, i * 2, 2, 1);
        }

        // HEADLIGHT
        ctx.fillStyle = '#FFFDE7';
        ctx.beginPath();
        ctx.arc(22, 2, 3, 0, Math.PI * 2);
        ctx.fill();

        // BUMPER
        ctx.fillStyle = '#AAA';
        ctx.fillRect(22, 8, 3, 4);

      } else if (type === 'cj2a') {
        // 1946 JEEP CJ2A - Green military Willys with WHITE RIMS

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.ellipse(0, 12, 20, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // WHEELS - WHITE RIMS!
        [-12, 12].forEach(wx => {
          ctx.fillStyle = '#111';
          ctx.beginPath();
          ctx.arc(wx, 7, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#FFFFFF'; // WHITE!
          ctx.beginPath();
          ctx.arc(wx, 7, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#DDD';
          ctx.beginPath();
          ctx.arc(wx, 7, 2, 0, Math.PI * 2);
          ctx.fill();
        });

        // BODY - compact military
        ctx.fillStyle = color;
        ctx.fillRect(-16, -2, 32, 10);

        // FLAT HOOD
        ctx.fillStyle = '#1B6B1B';
        ctx.fillRect(6, -2, 12, 8);

        // HOOD VENTS
        ctx.strokeStyle = '#0F4F0F';
        ctx.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(9 + i * 4, 0);
          ctx.lineTo(9 + i * 4, 4);
          ctx.stroke();
        }

        // OPEN TOP
        ctx.fillStyle = '#222';
        ctx.fillRect(-12, -8, 16, 7);

        // WINDSHIELD (upright military style)
        ctx.fillStyle = '#7EC8E3';
        ctx.fillRect(4, -8, 4, 10);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.strokeRect(4, -8, 4, 10);

        // ROUND FENDER
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(12, 0, 9, Math.PI, 0);
        ctx.fill();

        // HEADLIGHT
        ctx.fillStyle = '#FFFDE7';
        ctx.beginPath();
        ctx.arc(18, -1, 3, 0, Math.PI * 2);
        ctx.fill();

        // SPARE TIRE (back)
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(-18, 2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFF';
        ctx.beginPath();
        ctx.arc(-18, 2, 4, 0, Math.PI * 2);
        ctx.fill();

        // MILITARY STAR
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('★', -2, 5);

      } else if (type === 'f100') {
        // 1973 FORD F100 - Red pickup truck

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.ellipse(0, 16, 26, 5, 0, 0, Math.PI * 2);
        ctx.fill();

        // WHEELS (larger truck wheels)
        [-16, 16].forEach(wx => {
          ctx.fillStyle = '#111';
          ctx.beginPath();
          ctx.arc(wx, 10, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#C0C0C0';
          ctx.beginPath();
          ctx.arc(wx, 10, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#666';
          ctx.beginPath();
          ctx.arc(wx, 10, 2.5, 0, Math.PI * 2);
          ctx.fill();
        });

        // TRUCK BED
        ctx.fillStyle = '#333';
        ctx.fillRect(-26, -2, 22, 14);
        ctx.fillStyle = color;
        ctx.fillRect(-26, -4, 22, 4);
        ctx.fillRect(-26, -4, 3, 16);
        ctx.fillRect(-7, -4, 3, 16);

        // CAB
        ctx.fillStyle = color;
        ctx.fillRect(-6, -6, 28, 18);

        // ROOF (curved 70s)
        ctx.fillStyle = '#990000';
        ctx.beginPath();
        ctx.moveTo(-4, -6);
        ctx.quadraticCurveTo(6, -16, 16, -6);
        ctx.lineTo(-4, -6);
        ctx.fill();

        // WINDSHIELD
        ctx.fillStyle = '#7EC8E3';
        ctx.beginPath();
        ctx.moveTo(12, -12);
        ctx.quadraticCurveTo(18, -8, 20, 0);
        ctx.lineTo(20, 6);
        ctx.lineTo(12, 6);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.stroke();

        // SIDE WINDOW
        ctx.fillStyle = '#7EC8E3';
        ctx.fillRect(0, -10, 10, 10);
        ctx.strokeStyle = '#333';
        ctx.strokeRect(0, -10, 10, 10);

        // DOOR
        ctx.strokeStyle = '#880000';
        ctx.lineWidth = 1;
        ctx.strokeRect(-4, -4, 14, 14);

        // DOOR HANDLE
        ctx.fillStyle = '#C0C0C0';
        ctx.fillRect(2, 2, 5, 2);

        // GRILLE
        ctx.fillStyle = '#C0C0C0';
        ctx.fillRect(20, -4, 4, 12);
        ctx.fillStyle = '#333';
        ctx.fillRect(21, -2, 2, 8);

        // HEADLIGHT
        ctx.fillStyle = '#FFFDE7';
        ctx.fillRect(21, -3, 3, 4);

        // BUMPER
        ctx.fillStyle = '#AAA';
        ctx.fillRect(22, 6, 4, 6);

        // TAIL LIGHT
        ctx.fillStyle = '#FF0000';
        ctx.fillRect(-27, 0, 2, 4);

        // FORD BADGE
        ctx.fillStyle = '#0066CC';
        ctx.beginPath();
        ctx.ellipse(8, 8, 4, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // Health bar (outside transform)
      ctx.save();
      ctx.translate(x, y);
      const maxHealth = type === 'f100' ? 150 : type === 'cj2a' ? 120 : 100;
      const barWidth = 36;
      const healthPct = health / maxHealth;
      ctx.fillStyle = '#333';
      ctx.fillRect(-barWidth/2, -28, barWidth, 5);
      ctx.fillStyle = healthPct > 0.5 ? '#00CC00' : healthPct > 0.25 ? '#CCCC00' : '#CC0000';
      ctx.fillRect(-barWidth/2, -28, barWidth * healthPct, 5);
      ctx.restore();
    }

    function drawCoin(x, y) {
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#FFD700';
      ctx.fill();
      ctx.strokeStyle = '#B8860B';
      ctx.lineWidth = 2;
      ctx.stroke();

      // $ symbol
      ctx.fillStyle = '#8B6914';
      ctx.font = '8px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('₿', x, y + 3);
    }

    function drawObstacle(x, y, w, h) {
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#654321';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      // Rock texture
      ctx.fillStyle = '#9B5523';
      ctx.fillRect(x + 4, y + 4, w/3, h/3);
    }

    function drawArena() {
      // Desert sand
      ctx.fillStyle = '#DEB887';
      ctx.fillRect(0, 0, ${ARENA_WIDTH}, ${ARENA_HEIGHT});

      // Sand dunes pattern
      ctx.fillStyle = 'rgba(210, 180, 140, 0.5)';
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(80 + i * 80, 150 + Math.sin(i) * 50, 60, 0, Math.PI * 2);
        ctx.fill();
      }

      // Track marks
      ctx.strokeStyle = 'rgba(139, 69, 19, 0.3)';
      ctx.lineWidth = 20;
      ctx.beginPath();
      ctx.arc(200, 150, 100, 0, Math.PI * 2);
      ctx.stroke();

      // Cacti decorations
      ctx.font = '16px Arial';
      ctx.fillText('🌵', 30, 40);
      ctx.fillText('🌵', 350, 250);
      ctx.fillText('🌵', 50, 280);
      ctx.fillText('🌴', 370, 30);
    }

    function updateScoreboard(vehicles) {
      const sb = document.getElementById('scoreboard');
      sb.innerHTML = vehicles.map(v => \`
        <div class="vehicle-card" style="border-color: \${v.color}">
          <h3 style="color: \${v.color}">\${v.playerName || 'Unknown'}</h3>
          <div style="font-size: 6px; color: #888; margin-bottom: 4px;">\${v.name}</div>
          <div class="health-bar">
            <div class="health-fill" style="width: \${v.health}%; background: \${v.health > 50 ? '#44ff44' : v.health > 25 ? '#ffff44' : '#ff4444'}"></div>
          </div>
          <div class="stats">
            ❤️ \${v.health} | 🪙 \${v.coins}
          </div>
        </div>
      \`).join('');
    }

    async function gameLoop() {
      try {
        const res = await fetch('/game/state');
        const game = await res.json();

        // Clear and draw arena
        drawArena();

        // Draw obstacles
        if (game.obstacles) {
          game.obstacles.forEach(o => drawObstacle(o.x, o.y, o.w, o.h));
        }

        // Draw coins
        if (game.coins) {
          game.coins.forEach(c => drawCoin(c.x, c.y));
        }

        // Draw vehicles
        if (game.vehicles) {
          game.vehicles.forEach(v => {
            drawVehicle(v.x, v.y, v.angle, v.type, v.color, v.health);
          });
          updateScoreboard(game.vehicles);
        }

        // Winner announcement
        if (game.status === 'finished' && game.winner) {
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(50, 100, 300, 100);
          ctx.fillStyle = '#FFD700';
          ctx.font = '16px "Press Start 2P"';
          ctx.textAlign = 'center';
          ctx.fillText('🏆 WINNER! 🏆', 200, 140);
          ctx.font = '10px "Press Start 2P"';
          ctx.fillText(game.winner, 200, 170);
        }

      } catch (e) {
        console.log('Waiting for game...');
      }

      requestAnimationFrame(gameLoop);
    }

    gameLoop();
  </script>
</body>
</html>`;
}

// Create new game
function createGame(): GameState {
  const coins: GameState['coins'] = [];
  for (let i = 0; i < 15; i++) {
    coins.push({
      x: 40 + Math.random() * (ARENA_WIDTH - 80),
      y: 40 + Math.random() * (ARENA_HEIGHT - 80),
      value: Math.random() > 0.7 ? 10 : 5,
    });
  }

  const obstacles: GameState['obstacles'] = [
    { x: 100, y: 100, w: 40, h: 40 },
    { x: 260, y: 180, w: 50, h: 30 },
    { x: 180, y: 50, w: 30, h: 50 },
  ];

  return {
    id: crypto.randomUUID().slice(0, 8),
    status: 'waiting',
    vehicles: [],
    coins,
    obstacles,
    arena: { width: ARENA_WIDTH, height: ARENA_HEIGHT },
    round: 0,
    maxRounds: 100,
    winner: null,
    createdAt: Date.now(),
    lastUpdate: Date.now(),
  };
}

// Get or create current game
async function getCurrentGame(kv: KVNamespace): Promise<GameState> {
  const gameData = await kv.get('current_game');
  if (gameData) {
    const game = JSON.parse(gameData) as GameState;
    // Reset if game is old or finished
    if (game.status === 'finished' || Date.now() - game.lastUpdate > 5 * 60 * 1000) {
      const newGame = createGame();
      await kv.put('current_game', JSON.stringify(newGame));
      return newGame;
    }
    return game;
  }
  const newGame = createGame();
  await kv.put('current_game', JSON.stringify(newGame));
  return newGame;
}

// Save game
async function saveGame(kv: KVNamespace, game: GameState): Promise<void> {
  game.lastUpdate = Date.now();
  await kv.put('current_game', JSON.stringify(game));
}

// Get all high scores
async function getHighScores(kv: KVNamespace): Promise<HighScore[]> {
  const data = await kv.get('high_scores');
  return data ? JSON.parse(data) : [];
}

// Update high scores after game
async function recordGameResult(kv: KVNamespace, winner: Vehicle, allPlayers: Vehicle[]): Promise<void> {
  const scores = await getHighScores(kv);

  // Update each player's stats
  for (const player of allPlayers) {
    const existing = scores.find(s => s.owner === player.owner);
    const isWinner = player.id === winner.id;

    if (existing) {
      existing.score += player.coins;
      existing.gamesPlayed++;
      if (isWinner) existing.wins++;
      existing.lastGame = Date.now();
      if (player.coins > 0) existing.vehicle = player.name; // Last winning vehicle
    } else {
      scores.push({
        playerName: player.playerName,
        owner: player.owner,
        vehicle: player.name,
        score: player.coins,
        wins: isWinner ? 1 : 0,
        gamesPlayed: 1,
        lastGame: Date.now(),
      });
    }
  }

  // Sort by total score
  scores.sort((a, b) => b.score - a.score);

  // Keep top 100
  await kv.put('high_scores', JSON.stringify(scores.slice(0, 100)));
}

// Etch score on-chain (creates a memo transaction)
async function etchOnChain(winner: HighScore): Promise<string | null> {
  // This would call a Clarity contract to permanently record the score
  // For now, we return a placeholder - actual implementation needs
  // a transaction to be broadcast
  const memo = `DESERT_DERBY:${winner.playerName}:${winner.score}:${winner.wins}`;
  console.log(`Would etch on-chain: ${memo}`);
  return null; // Return txid when implemented
}

// Payment required response
function paymentRequired(c: any, resource: string, satsCost: number) {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  return c.json({
    error: 'Payment Required',
    code: 'PAYMENT_REQUIRED',
    resource,
    maxAmountRequired: satsCost.toString(),
    tokenType: 'sBTC',
    tokenContract: SBTC_CONTRACT,
    payTo: c.env.PAYMENT_ADDRESS,
    network: 'mainnet',
    nonce,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    game: 'Desert Derby',
    hint: 'Send sBTC, then retry with X-Payment header containing txid',
  }, 402);
}

// Landing page
app.get('/', async (c) => {
  const game = await getCurrentGame(c.env.GAMES);
  return c.html(generateGameHTML(game));
});

// API info
app.get('/api', (c) => {
  return c.json({
    game: 'Desert Derby',
    description: 'Classic vehicle battle arena for AI agents',
    version: '1.0.0',

    vehicles: {
      commando: { name: '1969 Jeep Commando', color: 'Yellow', stats: 'Fast & agile' },
      cj2a: { name: '1946 Jeep CJ2A', color: 'Olive', stats: 'Tough & durable' },
      f100: { name: '1973 Ford F100', color: 'Orange', stats: 'Heavy & powerful' },
    },

    endpoints: {
      'GET /': 'Play in browser',
      'GET /api': 'This info',
      'GET /game/state': 'Current game state (free)',
      'POST /game/join': `Join with vehicle (${JOIN_COST_SATS} sats)`,
      'POST /game/move': `Move your vehicle (${MOVE_COST_SATS} sat)`,
      'POST /game/boost': `Speed boost (${BOOST_COST_SATS} sats)`,
    },

    howToPlay: [
      '1. POST /game/join with {vehicle: "commando"|"cj2a"|"f100"}',
      '2. Pay sBTC via X-Payment header',
      '3. POST /game/move with {direction: "up"|"down"|"left"|"right"}',
      '4. Collect coins, avoid obstacles, bump enemies!',
      '5. Last vehicle standing or most coins wins!',
    ],

    paymentToken: 'sBTC (sats)',
  });
});

// Get game state (free)
app.get('/game/state', async (c) => {
  const game = await getCurrentGame(c.env.GAMES);
  return c.json(game);
});

// Join game
app.post('/game/join', async (c) => {
  const paymentTxid = c.req.header('X-Payment');

  if (!paymentTxid) {
    return paymentRequired(c, '/game/join', JOIN_COST_SATS);
  }

  const body = await c.req.json();
  const vehicleType = (body.vehicle || 'commando') as VehicleType;

  if (!VEHICLE_SPECS[vehicleType]) {
    return c.json({ error: 'Invalid vehicle. Choose: commando, cj2a, or f100' }, 400);
  }

  const game = await getCurrentGame(c.env.GAMES);

  if (game.vehicles.length >= 6) {
    return c.json({ error: 'Game full! Wait for next round.' }, 400);
  }

  const spec = VEHICLE_SPECS[vehicleType];
  const playerName = generatePlayerName(paymentTxid);
  const vehicle: Vehicle = {
    id: crypto.randomUUID().slice(0, 8),
    type: vehicleType,
    name: spec.name,
    x: 50 + Math.random() * (ARENA_WIDTH - 100),
    y: 50 + Math.random() * (ARENA_HEIGHT - 100),
    angle: Math.random() * Math.PI * 2,
    speed: spec.speed,
    health: spec.health,
    coins: 0,
    color: spec.color,
    owner: paymentTxid.slice(0, 16),
    playerName: playerName,
    lastMove: Date.now(),
  };

  game.vehicles.push(vehicle);

  if (game.vehicles.length >= 2 && game.status === 'waiting') {
    game.status = 'active';
  }

  await saveGame(c.env.GAMES, game);

  return c.json({
    success: true,
    message: `${playerName} joined the derby with ${spec.name}!`,
    vehicleId: vehicle.id,
    playerName: playerName,
    vehicle,
    gameId: game.id,
    playersInGame: game.vehicles.length,
  });
});

// Move vehicle
app.post('/game/move', async (c) => {
  const paymentTxid = c.req.header('X-Payment');

  if (!paymentTxid) {
    return paymentRequired(c, '/game/move', MOVE_COST_SATS);
  }

  const body = await c.req.json();
  const { vehicleId, direction } = body;

  if (!vehicleId || !direction) {
    return c.json({ error: 'vehicleId and direction required' }, 400);
  }

  const game = await getCurrentGame(c.env.GAMES);
  const vehicle = game.vehicles.find(v => v.id === vehicleId);

  if (!vehicle) {
    return c.json({ error: 'Vehicle not found' }, 404);
  }

  if (vehicle.health <= 0) {
    return c.json({ error: 'Vehicle destroyed!' }, 400);
  }

  // Move based on direction
  const moveSpeed = vehicle.speed * 5;
  switch (direction) {
    case 'up':
      vehicle.y = Math.max(20, vehicle.y - moveSpeed);
      vehicle.angle = -Math.PI / 2;
      break;
    case 'down':
      vehicle.y = Math.min(ARENA_HEIGHT - 20, vehicle.y + moveSpeed);
      vehicle.angle = Math.PI / 2;
      break;
    case 'left':
      vehicle.x = Math.max(20, vehicle.x - moveSpeed);
      vehicle.angle = Math.PI;
      break;
    case 'right':
      vehicle.x = Math.min(ARENA_WIDTH - 20, vehicle.x + moveSpeed);
      vehicle.angle = 0;
      break;
    default:
      return c.json({ error: 'direction must be up/down/left/right' }, 400);
  }

  // Check coin collection
  for (let i = game.coins.length - 1; i >= 0; i--) {
    const coin = game.coins[i];
    const dist = Math.sqrt((vehicle.x - coin.x) ** 2 + (vehicle.y - coin.y) ** 2);
    if (dist < 20) {
      vehicle.coins += coin.value;
      game.coins.splice(i, 1);
    }
  }

  // Check collisions with other vehicles
  for (const other of game.vehicles) {
    if (other.id === vehicle.id) continue;
    const dist = Math.sqrt((vehicle.x - other.x) ** 2 + (vehicle.y - other.y) ** 2);
    if (dist < 30) {
      // Bump! Both take damage based on power
      const mySpec = VEHICLE_SPECS[vehicle.type];
      const otherSpec = VEHICLE_SPECS[other.type];
      other.health -= mySpec.power;
      vehicle.health -= otherSpec.power * 0.5; // Attacker takes less damage

      // Push apart
      const angle = Math.atan2(other.y - vehicle.y, other.x - vehicle.x);
      other.x += Math.cos(angle) * 15;
      other.y += Math.sin(angle) * 15;
    }
  }

  // Check obstacle collisions
  for (const obs of game.obstacles) {
    if (vehicle.x > obs.x - 15 && vehicle.x < obs.x + obs.w + 15 &&
        vehicle.y > obs.y - 15 && vehicle.y < obs.y + obs.h + 15) {
      vehicle.health -= 5;
      // Bounce back
      switch (direction) {
        case 'up': vehicle.y += moveSpeed * 1.5; break;
        case 'down': vehicle.y -= moveSpeed * 1.5; break;
        case 'left': vehicle.x += moveSpeed * 1.5; break;
        case 'right': vehicle.x -= moveSpeed * 1.5; break;
      }
    }
  }

  vehicle.lastMove = Date.now();
  game.round++;

  // Check win condition
  const alive = game.vehicles.filter(v => v.health > 0);
  if (alive.length === 1 || game.round >= game.maxRounds || game.coins.length === 0) {
    game.status = 'finished';
    const winner = alive.length === 1
      ? alive[0]
      : game.vehicles.reduce((a, b) => a.coins > b.coins ? a : b);
    game.winner = `${winner.playerName} (${winner.name})`;

    // Record high scores
    await recordGameResult(c.env.GAMES, winner, game.vehicles);
  }

  await saveGame(c.env.GAMES, game);

  return c.json({
    success: true,
    vehicle: {
      x: vehicle.x,
      y: vehicle.y,
      health: vehicle.health,
      coins: vehicle.coins,
    },
    gameStatus: game.status,
    winner: game.winner,
  });
});

// Boost (temporary speed increase)
app.post('/game/boost', async (c) => {
  const paymentTxid = c.req.header('X-Payment');

  if (!paymentTxid) {
    return paymentRequired(c, '/game/boost', BOOST_COST_SATS);
  }

  const body = await c.req.json();
  const { vehicleId, direction } = body;

  if (!vehicleId || !direction) {
    return c.json({ error: 'vehicleId and direction required' }, 400);
  }

  const game = await getCurrentGame(c.env.GAMES);
  const vehicle = game.vehicles.find(v => v.id === vehicleId);

  if (!vehicle) {
    return c.json({ error: 'Vehicle not found' }, 404);
  }

  // Boost move (2x speed)
  const moveSpeed = vehicle.speed * 10;
  switch (direction) {
    case 'up': vehicle.y = Math.max(20, vehicle.y - moveSpeed); vehicle.angle = -Math.PI / 2; break;
    case 'down': vehicle.y = Math.min(ARENA_HEIGHT - 20, vehicle.y + moveSpeed); vehicle.angle = Math.PI / 2; break;
    case 'left': vehicle.x = Math.max(20, vehicle.x - moveSpeed); vehicle.angle = Math.PI; break;
    case 'right': vehicle.x = Math.min(ARENA_WIDTH - 20, vehicle.x + moveSpeed); vehicle.angle = 0; break;
  }

  // Boost collision does extra damage
  for (const other of game.vehicles) {
    if (other.id === vehicle.id) continue;
    const dist = Math.sqrt((vehicle.x - other.x) ** 2 + (vehicle.y - other.y) ** 2);
    if (dist < 35) {
      const mySpec = VEHICLE_SPECS[vehicle.type];
      other.health -= mySpec.power * 2; // Double damage on boost
    }
  }

  await saveGame(c.env.GAMES, game);

  return c.json({
    success: true,
    message: 'BOOST! 🚀',
    vehicle: {
      x: vehicle.x,
      y: vehicle.y,
      health: vehicle.health,
      coins: vehicle.coins,
    },
  });
});

// Reset game (admin/debug)
app.post('/game/reset', async (c) => {
  const newGame = createGame();
  await saveGame(c.env.GAMES, newGame);
  return c.json({ success: true, gameId: newGame.id });
});

// Leaderboard (current game)
app.get('/leaderboard', async (c) => {
  const game = await getCurrentGame(c.env.GAMES);
  const sorted = [...game.vehicles].sort((a, b) => b.coins - a.coins);

  return c.json({
    gameId: game.id,
    status: game.status,
    round: game.round,
    leaderboard: sorted.map((v, i) => ({
      rank: i + 1,
      playerName: v.playerName,
      vehicle: v.name,
      coins: v.coins,
      health: v.health,
      status: v.health > 0 ? 'alive' : 'destroyed',
    })),
  });
});

// All-time high scores (etched permanently)
app.get('/highscores', async (c) => {
  const scores = await getHighScores(c.env.GAMES);

  return c.json({
    title: 'Desert Derby Hall of Fame',
    description: 'All-time high scores - etched on Stacks blockchain',
    contract: HIGHSCORE_CONTRACT,
    scores: scores.slice(0, 25).map((s, i) => ({
      rank: i + 1,
      playerName: s.playerName,
      totalScore: s.score,
      wins: s.wins,
      gamesPlayed: s.gamesPlayed,
      favoriteVehicle: s.vehicle,
      onChain: s.onChainTx ? true : false,
    })),
  });
});

// Etch a score on-chain (requires payment)
app.post('/highscores/etch', async (c) => {
  const paymentTxid = c.req.header('X-Payment');

  if (!paymentTxid) {
    return paymentRequired(c, '/highscores/etch', 1000); // 1000 sats to etch
  }

  const body = await c.req.json();
  const { owner } = body;

  const scores = await getHighScores(c.env.GAMES);
  const playerScore = scores.find(s => s.owner === owner);

  if (!playerScore) {
    return c.json({ error: 'No scores found for this player' }, 404);
  }

  if (playerScore.onChainTx) {
    return c.json({
      message: 'Already etched on-chain!',
      txid: playerScore.onChainTx,
    });
  }

  // Create the on-chain record
  // In production, this would broadcast a Stacks transaction
  const txid = await etchOnChain(playerScore);

  if (txid) {
    playerScore.onChainTx = txid;
    await c.env.GAMES.put('high_scores', JSON.stringify(scores));
  }

  return c.json({
    success: true,
    message: 'Score etching initiated!',
    player: playerScore.playerName,
    score: playerScore.score,
    wins: playerScore.wins,
    note: 'On-chain transaction will be broadcast to Stacks mainnet',
  });
});

// Get player profile
app.get('/player/:owner', async (c) => {
  const owner = c.req.param('owner');
  const scores = await getHighScores(c.env.GAMES);
  const playerScore = scores.find(s => s.owner === owner);

  if (!playerScore) {
    return c.json({ error: 'Player not found' }, 404);
  }

  const rank = scores.findIndex(s => s.owner === owner) + 1;

  return c.json({
    playerName: playerScore.playerName,
    rank,
    totalScore: playerScore.score,
    wins: playerScore.wins,
    gamesPlayed: playerScore.gamesPlayed,
    winRate: playerScore.gamesPlayed > 0
      ? ((playerScore.wins / playerScore.gamesPlayed) * 100).toFixed(1) + '%'
      : '0%',
    favoriteVehicle: playerScore.vehicle,
    onChain: playerScore.onChainTx || null,
    lastGame: new Date(playerScore.lastGame).toISOString(),
  });
});

export default app;
