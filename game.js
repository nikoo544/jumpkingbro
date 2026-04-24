// Game Engine for Mario Jump King Online
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = 800;
canvas.height = 600;

// Game State
const state = {
    myPlayer: null,
    otherPlayers: new Map(),
    platforms: [],
    npcs: [],
    items: [],
    coins: 0,
    maxHeight: 0,
    particles: [],
    camera: { x: 0, y: 0, targetY: 0 },
    assets: {},
    peer: null,
    connections: new Map(),
    isLobby: true,
    dashCooldown: 0,
    leaderboard: [],
    socket: null
};

// Asset Loading
async function loadAssets() {
    const images = ['background.png', 'player.png', 'tiles.png'];
    const promises = images.map(src => {
        return new Promise((resolve) => {
            const img = new Image();
            img.src = src;
            img.onload = () => {
                state.assets[src.split('.')[0]] = img;
                resolve();
            };
        });
    });
    await Promise.all(promises);
}

// Player Class
class Player {
    constructor(id, x, y, color = '#ff4d4d', isLocal = false) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.width = 40;
        this.height = 60;
        this.vx = 0;
        this.vy = 0;
        this.color = color;
        this.isLocal = isLocal;
        this.onGround = false;
        this.charge = 0;
        this.isCharging = false;
        this.facing = 1; // 1 for right, -1 for left
        this.animFrame = 0;
        this.state = 'idle'; // idle, charging, jumping, falling
        this.lastSentHeight = 0;
    }

    update() {
        if (this.isLocal) {
            this.handleInput();
        }

        // Gravity
        this.vy += 0.5;
        this.y += this.vy;
        this.x += this.vx;

        // Platform Collisions
        this.onGround = false;
        state.platforms.forEach(p => {
            if (this.x < p.x + p.w && this.x + this.width > p.x &&
                this.y < p.y + p.h && this.y + this.height > p.y) {
                
                // Horizontal collision
                const overlapX = Math.min(this.x + this.width - p.x, p.x + p.w - this.x);
                const overlapY = Math.min(this.y + this.height - p.y, p.y + p.h - this.y);

                if (overlapX < overlapY) {
                    if (this.x + this.width / 2 < p.x + p.w / 2) {
                        this.x = p.x - this.width;
                    } else {
                        this.x = p.x + p.w;
                    }
                    this.vx *= -0.5; // Bounce off walls
                } else {
                    if (this.y + this.height / 2 < p.y + p.h / 2) {
                        this.y = p.y - this.height;
                        this.vy = 0;
                        this.onGround = true;
                        if (!this.isCharging) this.vx = 0;
                    } else {
                        this.y = p.y + p.h;
                        this.vy = 0.1;
                    }
                }
            }
        });

        // World boundaries
        if (this.x < 0) this.x = 0;
        if (this.x + this.width > canvas.width) this.x = canvas.width - this.width;
        if (this.y + this.height > 2000) { // Deep fall reset
            this.y = state.platforms[0].y - 100;
            this.x = 400;
            this.vy = 0;
        }

        // Camera follow (vertical only)
        if (this.isLocal) {
            const screenY = this.y - state.camera.y;
            if (screenY < 200) {
                state.camera.y = this.y - 200;
            } else if (screenY > 400) {
                state.camera.y = this.y - 400;
            }
        }

        // Animation State
        if (!this.onGround) {
            this.state = this.vy < 0 ? 'jumping' : 'falling';
        } else if (this.isCharging) {
            this.state = 'charging';
        } else {
            this.state = 'idle';
        }

        if (this.isLocal && (Math.abs(this.vx) > 0.1 || Math.abs(this.vy) > 0.1 || this.isCharging)) {
            broadcastState(this);
        }
    }

    handleInput() {
        const keys = window.keys || {};

        if (this.onGround) {
            if (keys['Space']) {
                this.isCharging = true;
                this.charge = Math.min(this.charge + 0.2, 15);
            } else if (this.isCharging) {
                // Jump!
                this.vy = -this.charge;
                if (keys['KeyA']) this.vx = -5;
                if (keys['KeyD']) this.vx = 5;
                this.isCharging = false;
                this.charge = 0;
            } else {
                if (keys['KeyA']) {
                    this.x -= 3;
                    this.facing = -1;
                }
                if (keys['KeyD']) {
                    this.x += 3;
                    this.facing = 1;
                }
            }
        }

        // Dash logic
        if (state.dashCooldown > 0) state.dashCooldown--;
    }

    dash(targetX, targetY) {
        if (state.dashCooldown > 0) return;

        // Calculate direction
        const dx = targetX - (this.x + this.width / 2);
        const dy = targetY - (this.y + this.height / 2);
        const dist = Math.hypot(dx, dy);
        
        // Apply dash velocity
        const dashPower = 15;
        this.vx = (dx / dist) * dashPower;
        this.vy = (dy / dist) * dashPower;
        
        state.dashCooldown = 60; // 1 second cooldown at 60fps
        
        // VFX
        createParticles(this.x + this.width/2, this.y + this.height/2, this.color, 15);
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);

        // Solid Color Sprite (Back to basics for clarity and juice)
        ctx.fillStyle = this.color;
        ctx.shadowBlur = this.isCharging ? 20 : 10;
        ctx.shadowColor = this.color;
        
        // Squish and stretch effect
        let drawH = this.height;
        let drawW = this.width;
        let offY = 0;
        
        if (this.isCharging) {
            const chargeFactor = this.charge / 15;
            drawH -= chargeFactor * 20;
            drawW += chargeFactor * 10;
            offY = chargeFactor * 20;
        }

        ctx.fillRect(0, offY, drawW, drawH);
        
        // Eyes for personality
        ctx.fillStyle = 'white';
        const eyeX = this.facing === 1 ? drawW - 15 : 5;
        ctx.fillRect(eyeX, offY + 10, 8, 8);
        
        if (this.isLocal) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.strokeRect(-2, offY - 2, drawW + 4, drawH + 4);
        }

        ctx.restore();
    }
}

// Multiplayer Logic (Socket.io)
function initMultiplayer() {
    state.socket = io();

    state.socket.on('connect', () => {
        const id = state.socket.id;
        document.getElementById('player-id').innerText = `ID: ${id.substring(0, 5)}`;
        document.getElementById('player-count').innerText = `Conectando...`;
        
        if (!state.myPlayer) {
            state.myPlayer = new Player(id, 400, 500, '#ff4d4d', true);
            state.socket.emit('newPlayer', {
                x: state.myPlayer.x,
                y: state.myPlayer.y,
                state: state.myPlayer.state,
                color: state.myPlayer.color
            });
        }
    });

    state.socket.on('currentPlayers', (serverPlayers) => {
        Object.keys(serverPlayers).forEach((id) => {
            if (id !== state.socket.id) {
                const pData = serverPlayers[id];
                const p = new Player(id, pData.x, pData.y, pData.color || '#4d94ff');
                state.otherPlayers.set(id, p);
            }
        });
        updatePlayerCount();
    });

    state.socket.on('playerJoined', (pData) => {
        if (pData.id !== state.socket.id) {
            const p = new Player(pData.id, pData.x, pData.y, pData.color || '#4d94ff');
            state.otherPlayers.set(pData.id, p);
            updatePlayerCount();
        }
    });

    state.socket.on('playerMoved', (pData) => {
        const p = state.otherPlayers.get(pData.id);
        if (p) {
            p.x = pData.x;
            p.y = pData.y;
            p.state = pData.state;
        }
    });

    state.socket.on('playerLeft', (id) => {
        state.otherPlayers.delete(id);
        updatePlayerCount();
    });

    state.socket.on('leaderboardUpdate', (serverBoard) => {
        state.leaderboard = serverBoard;
        renderLeaderboard();
    });
}

function renderLeaderboard() {
    const list = document.getElementById('rank-list');
    list.innerHTML = '';
    state.leaderboard.forEach((entry, i) => {
        const li = document.createElement('li');
        const name = entry.id === state.socket?.id ? "Tú" : entry.id.substring(0, 5);
        li.innerHTML = `<span>${i + 1}. ${name}</span> <span>${entry.height}m</span>`;
        list.appendChild(li);
    });
}

function broadcastState(player) {
    if (!state.socket || !state.socket.connected) return;
    state.socket.emit('playerUpdate', {
        x: player.x,
        y: player.y,
        state: player.state
    });
    
    // Also update height on server if it changed significantly
    if (Math.abs(player.lastSentHeight - state.maxHeight) > 1) {
        state.socket.emit('updateHeight', state.maxHeight);
        player.lastSentHeight = state.maxHeight;
    }
}

function updatePlayerCount() {
    const count = state.otherPlayers.size + 1;
    document.getElementById('player-count').innerText = `${count} Jugadores Online`;
}

function updatePlayerCount() {
    const count = state.connections.size + 1;
    document.getElementById('player-count').innerText = `${count} Jugadores Online`;
}

// NPC Class
class NPC {
    constructor(x, y, name, text) {
        this.x = x;
        this.y = y;
        this.w = 40;
        this.h = 60;
        this.name = name;
        this.text = text;
    }

    draw(time) {
        const float = Math.sin(time / 500) * 5;
        ctx.fillStyle = '#ffcc00';
        ctx.fillRect(this.x, this.y + float, this.w, this.h);
        ctx.fillStyle = 'white';
        ctx.font = '12px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, this.x + this.w / 2, this.y - 10 + float);
    }
}

class Flower {
    constructor(x, y, isCoin = false) {
        this.x = x;
        this.y = y;
        this.isCoin = isCoin;
        this.collected = false;
    }
    draw(time) {
        if (this.collected) return;
        const sway = Math.sin(time / 1000 + this.x) * 2;
        const bounce = Math.sin(time / 500) * 5;
        
        if (this.isCoin) {
            ctx.fillStyle = '#ffcc00';
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#ffcc00';
            ctx.beginPath();
            ctx.arc(this.x + 15, this.y + 15 + bounce, 10, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillStyle = '#ff66cc';
            ctx.fillRect(this.x + sway, this.y, 10, 20);
        }
    }
}

function createParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        state.particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            life: 1.0,
            color
        });
    }
}

function initLevel() {
    // Ground
    state.platforms.push({ x: 0, y: 560, w: 800, h: 100 });
    
    // Vertical Level Generation (Jump King style)
    let lastY = 560;
    for (let i = 0; i < 100; i++) {
        const x = Math.random() * 600 + 50;
        const y = lastY - (Math.random() * 80 + 120);
        const w = Math.random() * 100 + 80;
        state.platforms.push({ x, y, w, h: 20 });
        
        // Add coins randomly
        if (Math.random() > 0.7) {
            state.items.push(new Flower(x + w/2 - 15, y - 40, true));
        }
        lastY = y;
    }

    // NPCs
    state.npcs.push(new NPC(50, 500, "Vendedor", "¡Bienvenido a la tienda! Presiona E para abrir."));
    state.npcs.push(new NPC(700, 500, "Sabio", "Usa CLIC para hacer un DASH hacia el ratón."));

    // Flowers
    for (let i = 0; i < 10; i++) {
        state.items.push(new Flower(150 + i * 150, 530));
    }
}

// Click for Dash
canvas.addEventListener('mousedown', e => {
    if (state.myPlayer) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top + state.camera.y;
        state.myPlayer.dash(mouseX, mouseY);
    }
});

// UI Interaction
window.addEventListener('keydown', e => {
    if (e.code === 'KeyE') {
        // Check NPC proximity
        state.npcs.forEach(npc => {
            const dist = Math.hypot(state.myPlayer.x - npc.x, state.myPlayer.y - npc.y);
            if (dist < 100) {
                if (npc.name === "Vendedor") {
                    document.getElementById('shop-modal').classList.toggle('hidden');
                } else {
                    showDialog(npc.text);
                }
            }
        });
    }
});

function showDialog(text) {
    const box = document.getElementById('dialog-box');
    const txt = document.getElementById('dialog-text');
    txt.innerText = text;
    box.classList.remove('hidden');
    setTimeout(() => box.classList.add('hidden'), 3000);
}

document.querySelector('.close-btn').onclick = () => {
    document.getElementById('shop-modal').classList.add('hidden');
};

// Input Handling
window.keys = {};
window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);

// Main Loop
async function start() {
    initLevel();
    initMultiplayer();
    
    // Non-blocking asset load
    loadAssets().then(() => console.log("Assets cargados."));

    function loop(time) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Solid Background (Indigo Sky)
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(0, -state.camera.y);

        // Draw Flowers
        state.items.forEach(flower => flower.draw(time));

        // Update & Draw Platforms
        ctx.fillStyle = '#444';
        state.platforms.forEach(p => {
            // Use tileset if available
            if (state.assets.tiles) {
                ctx.drawImage(state.assets.tiles, 0, 0, 64, 64, p.x, p.y, p.w, p.h);
            } else {
                ctx.fillRect(p.x, p.y, p.w, p.h);
            }
        });

        // Update & Draw Players
        if (state.myPlayer) {
            state.myPlayer.update();
            state.myPlayer.draw();
        }

        state.otherPlayers.forEach(p => {
            p.draw();
        });

        // Update & Draw Particles
        for (let i = state.particles.length - 1; i >= 0; i--) {
            const p = state.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.02;
            if (p.life <= 0) {
                state.particles.splice(i, 1);
                continue;
            }
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.life;
            ctx.fillRect(p.x, p.y, 4, 4);
            ctx.globalAlpha = 1.0;
        }

        // Draw NPCs
        state.npcs.forEach(npc => npc.draw(time));

        // Check for coin collection
        if (state.myPlayer) {
            state.items.forEach(item => {
                if (item.isCoin && !item.collected) {
                    const dist = Math.hypot(state.myPlayer.x - item.x, state.myPlayer.y - item.y);
                    if (dist < 40) {
                        item.collected = true;
                        state.coins += 10;
                        createParticles(item.x, item.y, '#ffcc00', 10);
                        document.getElementById('coin-count').innerText = state.coins;
                    }
                }
            });
            
            // Update Height
            const currentHeight = Math.floor((560 - state.myPlayer.y) / 10);
            if (currentHeight > state.maxHeight) {
                state.maxHeight = currentHeight;
                document.getElementById('height-count').innerText = state.maxHeight;
            }
        }

        ctx.restore();

        // HUD - Dash Cooldown
        if (state.dashCooldown > 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.fillRect(20, 570, 100, 10);
            ctx.fillStyle = '#4d94ff';
            ctx.fillRect(20, 570, (1 - state.dashCooldown / 60) * 100, 10);
            ctx.fillStyle = 'white';
            ctx.font = '10px Outfit';
            ctx.fillText("DASH READY", 20, 565);
        }

        // Charge Bar for Jump King
        if (state.myPlayer && state.myPlayer.isCharging) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.fillRect(state.myPlayer.x, state.myPlayer.y - 15, state.myPlayer.width, 10);
            ctx.fillStyle = '#ffcc00';
            ctx.fillRect(state.myPlayer.x, state.myPlayer.y - 15, (state.myPlayer.charge / 15) * state.myPlayer.width, 10);
        }

        requestAnimationFrame(loop);
    }
    loop();
}

start();
