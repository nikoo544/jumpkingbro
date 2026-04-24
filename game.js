const state = {
    myPlayer: null,
    otherPlayers: new Map(),
    platforms: [],
    goals: [],
    particles: [],
    trail: [],
    camera: { x: 0, y: 500, zoom: 0.8 }, // Start camera at floor level
    coins: 0,
    maxHeight: 0,
    dashCooldown: 0,
    leaderboard: [],
    socket: null,
    playerName: '',
    playerColor: '#ff4d4d',
    isAiming: false,
    shake: 0,
    myEmoji: null,
    emojiTimer: 0
};

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const keys = {};

// Player Class (The Juicy Ball)
class Player {
    constructor(id, x, y, color = '#ff4d4d', isLocal = false) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.r = 20;
        this.vx = 0;
        this.vy = 0;
        this.color = color;
        this.isLocal = isLocal;
        this.name = '';
        this.emoji = null;
        this.hook = { active: false, targetX: 0, targetY: 0 };
        this.lastSentHeight = 0;
        this.trail = [];
    }

    update() {
        this.vy += 0.45; // Gravity
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.985; // Friction

        // Trail logic
        if (this.isLocal) {
            this.trail.push({ x: this.x, y: this.y });
            if (this.trail.length > 15) this.trail.shift();
        }

        // Platform collisions
        const platformsToCheck = state.platforms.length > 0 ? state.platforms : [{x: -1000, y: 560, w: 3000, h: 200}];
        platformsToCheck.forEach(p => {
            if (this.x + this.r > p.x && this.x - this.r < p.x + p.w &&
                this.y + this.r > p.y && this.y - this.r < p.y + p.h) {
                
                const prevY = this.y - this.vy;
                if (prevY + this.r <= p.y) {
                    this.vy *= -0.6;
                    this.y = p.y - this.r;
                    if (Math.abs(this.vy) > 1.5) createParticles(this.x, this.y, '#fff', 5);
                } else if (prevY - this.r >= p.y + p.h) {
                    this.vy *= -0.6;
                    this.y = p.y + p.h + this.r;
                } else {
                    this.vx *= -0.6;
                    this.x = (this.x < p.x) ? p.x - this.r : p.x + p.w + this.r;
                }
            }
        });

        // Hook pull
        if (this.isLocal && this.hook.active && window.isRightClickHeld) {
            const dx = this.hook.targetX - this.x;
            const dy = this.hook.targetY - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 30) {
                this.vx += (dx / dist) * 1.0;
                this.vy += (dy / dist) * 1.0;
                this.vx *= 0.96;
                this.vy *= 0.96;
            }
        }

        // Boundaries
        if (this.x < this.r || this.x > 800 - this.r) {
            this.vx *= -0.8;
            this.x = this.x < this.r ? this.r : 800 - this.r;
        }

        // Reset if fall too deep
        if (this.isLocal && this.y > 2000) {
            this.y = 500;
            this.x = 400;
            this.vx = 0;
            this.vy = 0;
            state.camera.y = 500;
        }

        if (this.isLocal) {
            const h = Math.floor((560 - this.y) / 10);
            state.maxHeight = Math.max(state.maxHeight, h);
            document.getElementById('height-count').innerText = state.maxHeight;

            // Camera follow (Smoother)
            const targetCamY = this.y - (300 / state.camera.zoom);
            state.camera.y += (targetCamY - state.camera.y) * 0.1;

            if (state.dashCooldown > 0) state.dashCooldown--;
            if (state.emojiTimer > 0) {
                state.emojiTimer--;
                if (state.emojiTimer === 0) state.myEmoji = null;
            }

            if (Math.abs(this.vx) > 0.05 || Math.abs(this.vy) > 0.05) {
                broadcastState(this);
            }
        }
    }

    hit(vx, vy) {
        this.vx = vx;
        this.vy = vy;
        state.shake = Math.hypot(vx, vy);
        createParticles(this.x, this.y, this.color, 20);
        showImpactText("BOOM!", this.x, this.y);
    }

    dash(targetX, targetY) {
        if (state.dashCooldown > 0) return;
        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const dist = Math.hypot(dx, dy);
        this.vx = (dx / dist) * 20;
        this.vy = (dy / dist) * 20;
        state.dashCooldown = 60;
        state.shake = 10;
        createParticles(this.x, this.y, '#fff', 15);
    }

    draw() {
        ctx.save();
        
        // Hook line
        if (this.isLocal && this.hook.active) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.lineWidth = 3;
            ctx.setLineDash([5, 5]);
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.hook.targetX, this.hook.targetY);
            ctx.stroke();
            ctx.restore();
        }

        // Ball Body
        ctx.fillStyle = 'white';
        ctx.shadowBlur = 20;
        ctx.shadowColor = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 5;
        ctx.stroke();

        // Name Tag
        ctx.fillStyle = 'white';
        ctx.font = 'bold 14px Outfit';
        ctx.textAlign = 'center';
        ctx.shadowBlur = 0;
        ctx.fillText(this.name || 'Player', this.x, this.y - this.r - 15);
        
        const displayEmoji = this.isLocal ? state.myEmoji : this.emoji;
        if (displayEmoji) {
            ctx.font = '30px serif';
            ctx.fillText(displayEmoji, this.x, this.y - this.r - 40);
        }

        ctx.restore();
    }
}

function createParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        state.particles.push({
            x, y, 
            vx: (Math.random() - 0.5) * 15,
            vy: (Math.random() - 0.5) * 15,
            life: 1.0,
            color
        });
    }
}

function showImpactText(text, x, y) {
    state.particles.push({ x, y, vx: (Math.random()-0.5)*4, vy: -5, life: 1.5, text, color: '#fff' });
}

function initMultiplayer() {
    state.socket = io();
    state.socket.on('initLevel', (data) => {
        state.platforms = data.platforms;
        state.goals = data.goals || [];
    });
    state.socket.on('currentPlayers', (serverPlayers) => {
        Object.keys(serverPlayers).forEach((id) => {
            if (id !== state.socket.id) {
                const pData = serverPlayers[id];
                const p = new Player(id, pData.x, pData.y, pData.color);
                p.name = pData.name;
                state.otherPlayers.set(id, p);
            }
        });
    });
    state.socket.on('playerJoined', (pData) => {
        if (pData.id !== state.socket.id) {
            const p = new Player(pData.id, pData.x, pData.y, pData.color);
            p.name = pData.name;
            state.otherPlayers.set(pData.id, p);
        }
    });
    state.socket.on('playerMoved', (pData) => {
        const p = state.otherPlayers.get(pData.id);
        if (p) {
            p.x = pData.x; p.y = pData.y; p.emoji = pData.emoji;
        }
    });
    state.socket.on('playerLeft', (id) => state.otherPlayers.delete(id));
    state.socket.on('leaderboardUpdate', (board) => {
        state.leaderboard = board;
        renderLeaderboard();
    });
}

function renderLeaderboard() {
    const list = document.getElementById('rank-list');
    if (!list) return;
    list.innerHTML = '';
    state.leaderboard.forEach((entry, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${i + 1}. ${entry.name}</span> <span>${entry.height}m</span>`;
        list.appendChild(li);
    });
}

function broadcastState(player) {
    if (!state.socket || !state.socket.connected) return;
    state.socket.emit('playerUpdate', {
        x: player.x, y: player.y, name: state.playerName, color: state.playerColor, emoji: state.myEmoji
    });
    const h = Math.floor((560 - player.y) / 10);
    if (Math.abs(player.lastSentHeight - h) > 1) {
        state.socket.emit('updateHeight', h);
        player.lastSentHeight = h;
    }
}

// Mouse/Input Scaling
const getMousePos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: ((e.clientX - rect.left) * scaleX) / state.camera.zoom,
        y: (((e.clientY - rect.top) * scaleY) + state.camera.y * state.camera.zoom) / state.camera.zoom
    };
};

window.addEventListener('keydown', e => {
    keys[e.code] = true;
    const emojis = { 'Digit1': '😊', 'Digit2': '😂', 'Digit3': '🔥', 'Digit4': '💀' };
    if (emojis[e.code]) { state.myEmoji = emojis[e.code]; state.emojiTimer = 120; }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (state.myPlayer && window.lastMouseX !== undefined) state.myPlayer.dash(window.lastMouseX, window.lastMouseY);
    }
});
window.addEventListener('keyup', e => keys[e.code] = false);

window.isLeftClickHeld = false;
window.isRightClickHeld = false;

canvas.addEventListener('mousedown', e => {
    const pos = getMousePos(e);
    if (e.button === 0) {
        window.isLeftClickHeld = true;
        if (state.myPlayer && Math.hypot(pos.x - state.myPlayer.x, pos.y - state.myPlayer.y) < 100) state.isAiming = true;
    } else if (e.button === 2) {
        window.isRightClickHeld = true;
        state.platforms.forEach(p => {
            if (pos.x > p.x && pos.x < p.x + p.w && pos.y > p.y && pos.y < p.y + p.h) {
                state.myPlayer.hook.active = true;
                state.myPlayer.hook.targetX = pos.x;
                state.myPlayer.hook.targetY = pos.y;
            }
        });
    }
});

window.addEventListener('mouseup', e => {
    if (e.button === 0) {
        if (state.isAiming && state.myPlayer) {
            const pos = getMousePos(e);
            const dx = pos.x - state.myPlayer.x;
            const dy = pos.y - state.myPlayer.y;
            const dist = Math.hypot(dx, dy);
            const power = Math.min(dist / 5, 30);
            state.myPlayer.hit(-dx / dist * power, -dy / dist * power);
        }
        state.isAiming = false;
        window.isLeftClickHeld = false;
    } else if (e.button === 2) {
        window.isRightClickHeld = false;
    }
});

window.addEventListener('mousemove', e => {
    const pos = getMousePos(e);
    window.lastMouseX = pos.x;
    window.lastMouseY = pos.y;
});

canvas.oncontextmenu = (e) => e.preventDefault();

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
        if (!state.myPlayer && state.socket) {
            state.myPlayer = new Player(state.socket.id, 400, 500, state.playerColor, true);
            state.myPlayer.name = state.playerName;
            state.camera.y = 500 - (300 / state.camera.zoom); // Center camera on spawn
            state.socket.emit('newPlayer', { x: 400, y: 500, color: state.playerColor, name: state.playerName });
        }
    };
}

async function start() {
    initMultiplayer();
    initMenu();

    function loop(time) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#0a0a12';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const h = state.myPlayer ? Math.floor((560 - state.myPlayer.y) / 10) : 0;
        
        // Gradient background
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0, h < 1000 ? '#1a1a2e' : '#000');
        grad.addColorStop(1, h < 1000 ? '#16213e' : '#1a1a2e');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.scale(state.camera.zoom, state.camera.zoom);
        
        if (state.shake > 0) {
            ctx.translate((Math.random()-0.5)*state.shake, (Math.random()-0.5)*state.shake);
            state.shake *= 0.9;
        }
        
        // Center camera horizontally, follow vertically
        const offsetX = (canvas.width / state.camera.zoom - 800) / 2;
        ctx.translate(offsetX, -state.camera.y);

        // Draw Lobby Base (Always visible at start)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(-1000, 560, 3000, 200);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 2;
        for(let i=-10; i<20; i++) ctx.strokeRect(i*100, 560, 100, 100);

        if (state.camera.y > 0) {
            ctx.fillStyle = 'white';
            ctx.font = 'bold 80px Outfit';
            ctx.textAlign = 'center';
            ctx.fillText("LOBBY", 400, 530);
        }

        // Platforms & Goals
        state.platforms.forEach(p => {
            ctx.fillStyle = '#111';
            ctx.fillRect(p.x, p.y, p.w, p.h);
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 3;
            ctx.strokeRect(p.x, p.y, p.w, p.h);
        });

        state.goals.forEach(goal => {
            const pulse = Math.sin(time/200) * 10;
            ctx.fillStyle = '#ff4d4d';
            ctx.beginPath();
            ctx.moveTo(goal.x, goal.y + pulse);
            ctx.lineTo(goal.x + 40, goal.y + 20 + pulse);
            ctx.lineTo(goal.x, goal.y + 40 + pulse);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillRect(goal.x, goal.y + pulse, 6, 80);
            ctx.font = 'bold 20px Outfit';
            ctx.fillText(`GOAL ${goal.height}m`, goal.x + 20, goal.y - 20 + pulse);
        });

        // Other Players
        state.otherPlayers.forEach(p => p.draw());

        // Local Player
        if (state.myPlayer) {
            state.myPlayer.update();
            state.myPlayer.draw();
            
            if (state.isAiming) {
                const pos = {x: window.lastMouseX, y: window.lastMouseY};
                const dx = pos.x - state.myPlayer.x;
                const dy = pos.y - state.myPlayer.y;
                const dist = Math.hypot(dx, dy);
                const power = Math.min(dist / 5, 30);
                
                // Trajectory dots
                ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                let tx = state.myPlayer.x;
                let ty = state.myPlayer.y;
                let tvx = -dx / dist * power;
                let tvy = -dy / dist * power;
                for(let i=0; i<40; i++) {
                    tvy += 0.45; tx += tvx; ty += tvy;
                    if (i % 2 === 0) {
                        ctx.beginPath();
                        ctx.arc(tx, ty, 4, 0, Math.PI*2);
                        ctx.fill();
                    }
                }
                // Aim line
                ctx.beginPath();
                ctx.strokeStyle = state.playerColor;
                ctx.lineWidth = 6;
                ctx.moveTo(state.myPlayer.x, state.myPlayer.y);
                ctx.lineTo(state.myPlayer.x - dx/dist*power*5, state.myPlayer.y - dy/dist*power*5);
                ctx.stroke();
            }
        }

        // Particles
        for (let i = state.particles.length - 1; i >= 0; i--) {
            const p = state.particles[i]; p.x += p.vx; p.y += p.vy; p.life -= 0.01;
            if (p.life <= 0) { state.particles.splice(i, 1); continue; }
            if (p.text) { 
                ctx.fillStyle = `rgba(255,255,255,${p.life})`; ctx.font = 'bold 30px Outfit';
                ctx.fillText(p.text, p.x, p.y); 
            } else {
                ctx.fillStyle = p.color; ctx.globalAlpha = p.life;
                ctx.fillRect(p.x, p.y, 6, 6); ctx.globalAlpha = 1.0;
            }
        }

        ctx.restore();
        
        // HUD Overlay (Not scaled by zoom)
        if (state.dashCooldown > 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'; ctx.fillRect(20, 570, 150, 15);
            ctx.fillStyle = state.playerColor; ctx.fillRect(20, 570, (1 - state.dashCooldown / 60) * 150, 15);
        }

        requestAnimationFrame(loop);
    }
    loop();
}

start();
