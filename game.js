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
    socket: null,
    playerName: '',
    playerColor: '#ff4d4d',
    myBall: null,
    otherBalls: new Map(),
    goals: [],
    isAiming: false,
    aimPower: 0,
    shake: 0,
    myEmoji: null,
    emojiTimer: 0
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
        this.name = id === 'local' ? '' : id.substring(0, 5);
        this.hook = { active: false, x: 0, y: 0, targetX: 0, targetY: 0, length: 0 };
        this.emoji = null;
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

        if (this.isLocal && (Math.abs(this.vx) > 0.01 || Math.abs(this.vy) > 0.01 || this.isCharging)) {
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

        // Hook logic (Releasable)
        if (this.hook.active && window.isRightClickHeld) {
            const dx = this.hook.targetX - (this.x + this.width / 2);
            const dy = this.hook.targetY - (this.y + this.height / 2);
            const dist = Math.hypot(dx, dy);
            
            if (dist > 30) {
                this.vx = (dx / dist) * 12;
                this.vy = (dy / dist) * 12;
            } else {
                this.hook.active = false;
            }
        } else if (this.hook.active) {
            this.hook.active = false; // Release if button let go
        }

        if (state.dashCooldown > 0) state.dashCooldown--;
        if (keys['ShiftLeft'] || keys['ShiftRight']) {
            if (window.lastMouseX !== undefined) {
                this.dash(window.lastMouseX, window.lastMouseY);
            }
        }

        if (state.emojiTimer > 0) {
            state.emojiTimer--;
            if (state.emojiTimer === 0) state.myEmoji = null;
        }
    }

    dash(targetX, targetY) {
        if (state.dashCooldown > 0) return;

        const dx = targetX - (this.x + this.width / 2);
        const dy = targetY - (this.y + this.height / 2);
        const dist = Math.hypot(dx, dy);
        
        const dashPower = 15;
        this.vx = (dx / dist) * dashPower;
        this.vy = (dy / dist) * dashPower;
        
        state.dashCooldown = 60;
        createParticles(this.x + this.width/2, this.y + this.height/2, this.color, 15);
    }

    shootHook(targetX, targetY) {
        // Find nearest platform in that direction
        state.platforms.forEach(p => {
            if (targetX > p.x && targetX < p.x + p.w && targetY > p.y && targetY < p.y + p.h) {
                this.hook.active = true;
                this.hook.targetX = targetX;
                this.hook.targetY = targetY;
            }
        });
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
        
        // Name Label
        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, drawW / 2, offY - 10);

        // Emoji
        const displayEmoji = this.isLocal ? state.myEmoji : this.emoji;
        if (displayEmoji) {
            ctx.font = '24px serif';
            ctx.fillText(displayEmoji, drawW / 2, offY - 30);
        }

        // Eyes for personality
        ctx.fillStyle = 'white';
        const eyeX = this.facing === 1 ? drawW - 15 : 5;
        ctx.fillRect(eyeX, offY + 10, 8, 8);
        
        if (this.isLocal) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.strokeRect(-2, offY - 2, drawW + 4, drawH + 4);
        }

        if (this.isLocal && this.hook.active) {
            ctx.beginPath();
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.moveTo(drawW/2, offY + drawH/2);
            ctx.lineTo(this.hook.targetX - this.x, this.hook.targetY - this.y);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.restore();
    }
}

class Ball {
    constructor(id, x, y, color) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.r = 12;
        this.vx = 0;
        this.vy = 0;
        this.color = color;
    }

    update() {
        this.vy += 0.3; // Gravity
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.98; // Friction

        // Platform collisions
        state.platforms.forEach(p => {
            if (this.x + this.r > p.x && this.x - this.r < p.x + p.w &&
                this.y + this.r > p.y && this.y - this.r < p.y + p.h) {
                
                // Bounce
                if (Math.abs(this.y - p.y) < this.r || Math.abs(this.y - (p.y + p.h)) < this.r) {
                    this.vy *= -0.7;
                    this.y = this.y < p.y ? p.y - this.r : p.y + p.h + this.r;
                } else {
                    this.vx *= -0.7;
                    this.x = this.x < p.x ? p.x - this.r : p.x + p.w + this.r;
                }
            }
        });

        if (this.x < 0 || this.x > 800) this.vx *= -1;
    }

    hit(vx, vy) {
        this.vx = vx;
        this.vy = vy;
        createParticles(this.x, this.y, this.color, 10);
    }

    draw() {
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 3;
        ctx.stroke();
    }
}

// Multiplayer Logic (Socket.io)
function initMultiplayer() {
    state.socket = io();

    state.socket.on('connect', () => {
        // Just store the socket, wait for Start Menu to register
        const id = state.socket.id;
    });

    state.socket.on('initLevel', (data) => {
        state.platforms = data.platforms;
        state.items = data.items.map(i => new Flower(i.x, i.y, i.type === 'coin'));
        state.goals = data.goals || [];
        if (state.myPlayer && !state.myBall) {
            state.myBall = new Ball(state.socket.id, state.myPlayer.x, state.myPlayer.y - 50, state.playerColor);
        }
    });

    state.socket.on('currentPlayers', (serverPlayers) => {
        Object.keys(serverPlayers).forEach((id) => {
            if (id !== state.socket.id) {
                const pData = serverPlayers[id];
                const p = new Player(id, pData.x, pData.y, pData.color || '#4d94ff');
                p.name = pData.name || id.substring(0, 5);
                state.otherPlayers.set(id, p);
                
                const b = new Ball(id, pData.x, pData.y - 50, pData.color || '#4d94ff');
                state.otherBalls.set(id, b);
            }
        });
    });

    state.socket.on('playerJoined', (pData) => {
        if (pData.id !== state.socket.id) {
            const p = new Player(pData.id, pData.x, pData.y, pData.color || '#4d94ff');
            p.name = pData.name || pData.id.substring(0, 5);
            state.otherPlayers.set(pData.id, p);
            
            const b = new Ball(pData.id, pData.x, pData.y - 50, pData.color || '#4d94ff');
            state.otherBalls.set(pData.id, b);
        }
    });

    state.socket.on('playerMoved', (pData) => {
        const p = state.otherPlayers.get(pData.id);
        if (p) {
            p.x = pData.x;
            p.y = pData.y;
            p.state = pData.state;
            p.emoji = pData.emoji;
            
            const b = state.otherBalls.get(pData.id);
            if (b && pData.ballX !== undefined) {
                b.x = pData.ballX;
                b.y = pData.ballY;
            }
        }
    });

    state.socket.on('playerLeft', (id) => {
        state.otherPlayers.delete(id);
        state.otherBalls.delete(id);
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
        const name = entry.name || entry.id.substring(0, 5);
        li.innerHTML = `<span>${i + 1}. ${name}</span> <span>${entry.height}m</span>`;
        list.appendChild(li);
    });
}

function broadcastState(player) {
    if (!state.socket || !state.socket.connected) return;
    const data = {
        x: player.x,
        y: player.y,
        state: player.state,
        name: state.playerName,
        color: state.playerColor,
        emoji: state.myEmoji
    };
    
    if (state.myBall) {
        data.ballX = state.myBall.x;
        data.ballY = state.myBall.y;
    }

    state.socket.emit('playerUpdate', data);
    
    // Use ball height for ranking
    const ballHeight = state.myBall ? Math.floor((560 - state.myBall.y) / 10) : 0;
    if (Math.abs(player.lastSentHeight - ballHeight) > 1) {
        state.socket.emit('updateHeight', ballHeight);
        player.lastSentHeight = ballHeight;
    }
}

function updatePlayerCount() {
    // Obsolete
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
    // Initial ground while waiting for server
    state.platforms = [{ x: 0, y: 560, w: 800, h: 100 }];
    
    // NPCs (Keep them local or sync them too, let's keep them local for now)
    state.npcs.push(new NPC(50, 500, "Vendedor", "Tienda pronto..."));
    state.npcs.push(new NPC(700, 500, "Sabio", "Usa CLIC para DASH."));
}

// Mouse Input State
window.isLeftClickHeld = false;
window.isRightClickHeld = false;

canvas.addEventListener('mousedown', e => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top + state.camera.y;

    if (e.button === 0) { // Left click
        window.isLeftClickHeld = true;
        // Check if near ball to start aiming
        if (state.myBall) {
            const dist = Math.hypot(mouseX - state.myBall.x, mouseY - state.myBall.y);
            if (dist < 60) state.isAiming = true;
        }
    } else if (e.button === 2) { // Right click
        window.isRightClickHeld = true;
        if (state.myPlayer) state.myPlayer.shootHook(mouseX, mouseY);
    }
});

window.addEventListener('mouseup', e => {
    if (e.button === 0) { // Release hit
        if (state.isAiming && state.myBall) {
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top + state.camera.y;
            
            const dx = mouseX - state.myBall.x;
            const dy = mouseY - state.myBall.y;
            const dist = Math.hypot(dx, dy);
            const power = Math.min(dist / 5, 25);
            
            state.myBall.hit(-dx / dist * power, -dy / dist * power);
            state.shake = power / 2;
            showImpactText("BOOM!", state.myBall.x, state.myBall.y);
        }
        state.isAiming = false;
        window.isLeftClickHeld = false;
    } else if (e.button === 2) {
        window.isRightClickHeld = false;
    }
});

function showImpactText(text, x, y) {
    state.particles.push({
        x, y, vx: 0, vy: -2, life: 1, text, color: '#fff'
    });
}

window.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    window.lastMouseX = e.clientX - rect.left;
    window.lastMouseY = e.clientY - rect.top + state.camera.y;
});
window.addEventListener('keydown', e => {
    // Emojis
    const emojis = { 'Digit1': '😊', 'Digit2': '😂', 'Digit3': '🔥', 'Digit4': '💀' };
    if (emojis[e.code]) {
        state.myEmoji = emojis[e.code];
        state.emojiTimer = 120; // 2 seconds
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
    initMenu();
    
    // Non-blocking asset load
    loadAssets().then(() => console.log("Assets cargados."));

    function loop(time) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Solid Background (Indigo Sky)
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        
        // Screen Shake
        if (state.shake > 0) {
            ctx.translate((Math.random()-0.5)*state.shake, (Math.random()-0.5)*state.shake);
            state.shake *= 0.9;
        }

        ctx.translate(0, -state.camera.y);

        // Draw Flowers
        state.items.forEach(flower => flower.draw(time));

        // Draw Goals (Flags)
        state.goals.forEach(goal => {
            ctx.fillStyle = '#ff4d4d';
            ctx.beginPath();
            ctx.moveTo(goal.x, goal.y);
            ctx.lineTo(goal.x + 30, goal.y + 15);
            ctx.lineTo(goal.x, goal.y + 30);
            ctx.fill();
            ctx.fillStyle = '#eee';
            ctx.fillRect(goal.x, goal.y, 4, 60);
            
            ctx.fillStyle = 'white';
            ctx.font = 'bold 12px Outfit';
            ctx.fillText(`${goal.height}m`, goal.x + 15, goal.y - 5);
        });

        // Update & Draw Platforms (Solid Color)
        ctx.fillStyle = '#555';
        state.platforms.forEach(p => {
            ctx.fillRect(p.x, p.y, p.w, p.h);
        });

        // Update & Draw Balls
        if (state.myBall) {
            state.myBall.update();
            state.myBall.draw();
            
            // Draw Aim Arrow
            if (state.isAiming) {
                const dx = window.lastMouseX - state.myBall.x;
                const dy = window.lastMouseY - state.myBall.y;
                const dist = Math.hypot(dx, dy);
                const power = Math.min(dist / 5, 25);
                
                ctx.beginPath();
                ctx.strokeStyle = state.playerColor;
                ctx.lineWidth = 4;
                ctx.moveTo(state.myBall.x, state.myBall.y);
                ctx.lineTo(state.myBall.x - dx / dist * power * 5, state.myBall.y - dy / dist * power * 5);
                ctx.stroke();
                
                // Power arc
                ctx.beginPath();
                ctx.arc(state.myBall.x, state.myBall.y, 40, 0, Math.PI * 2 * (power / 25));
                ctx.stroke();
            }
        }
        state.otherBalls.forEach(b => b.draw());

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
            if (p.text) {
                ctx.fillStyle = p.color;
                ctx.font = 'bold 20px Outfit';
                ctx.fillText(p.text, p.x, p.y);
            } else {
                ctx.fillStyle = p.color;
                ctx.globalAlpha = p.life;
                ctx.fillRect(p.x, p.y, 4, 4);
                ctx.globalAlpha = 1.0;
            }
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
            
            // Check for Goal collection
            state.goals.forEach(goal => {
                if (state.myBall) {
                    const dist = Math.hypot(state.myBall.x - goal.x, state.myBall.y - goal.y);
                    if (dist < 40 && !goal.reached) {
                        goal.reached = true;
                        state.coins += 50;
                        showImpactText("GOAL! +50", goal.x, goal.y);
                        createParticles(goal.x, goal.y, '#ffcc00', 30);
                        document.getElementById('coin-count').innerText = state.coins;
                    }
                }
            });
            
            // Update Height (Based on Ball)
            const currentHeight = state.myBall ? Math.floor((560 - state.myBall.y) / 10) : 0;
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

function initMenu() {
    const startMenu = document.getElementById('start-menu');
    const startBtn = document.getElementById('start-btn');
    const colorOpts = document.querySelectorAll('.color-opt');

    colorOpts.forEach(opt => {
        opt.onclick = () => {
            colorOpts.forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            state.playerColor = opt.dataset.color;
        };
    });

    startBtn.onclick = () => {
        state.playerName = document.getElementById('player-name').value || "Invitado";
        startMenu.style.display = 'none';
        
        // Register player on server
        if (!state.myPlayer && state.socket) {
            state.myPlayer = new Player(state.socket.id, 400, 500, state.playerColor, true);
            state.myPlayer.name = state.playerName;
            state.myBall = new Ball(state.socket.id, 400, 450, state.playerColor);
            state.socket.emit('newPlayer', {
                x: state.myPlayer.x,
                y: state.myPlayer.y,
                state: state.myPlayer.state,
                color: state.myPlayer.color,
                name: state.playerName
            });
        }
    };
}

start();
