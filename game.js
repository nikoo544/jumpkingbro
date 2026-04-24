const state = {
    myPlayer: null,
    otherPlayers: new Map(),
    platforms: [],
    items: [],
    goals: [],
    particles: [],
    npcs: [],
    camera: { x: 0, y: 0 },
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
    emojiTimer: 0,
    assets: { unicorn: null, anime: null, fantasy: null }
};

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const keys = {};

// Asset Loading
async function loadAssets() {
    const loadImg = (src) => new Promise((resolve) => {
        const img = new Image();
        img.src = src;
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null); // Fallback to solid if image fails
    });

    state.assets.unicorn = await loadImg('unicorn.png');
    state.assets.anime = await loadImg('anime.png');
    state.assets.fantasy = await loadImg('fantasy.png');
}

// Player Class (The Ball)
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
    }

    update() {
        this.vy += 0.35; // Gravity
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.98; // Friction

        // Platform collisions
        state.platforms.forEach(p => {
            if (this.x + this.r > p.x && this.x - this.r < p.x + p.w &&
                this.y + this.r > p.y && this.y - this.r < p.y + p.h) {
                
                const prevX = this.x - this.vx;
                const prevY = this.y - this.vy;

                if (prevY + this.r <= p.y || prevY - this.r >= p.y + p.h) {
                    this.vy *= -0.6;
                    this.y = prevY + this.r <= p.y ? p.y - this.r : p.y + p.h + this.r;
                } else {
                    this.vx *= -0.6;
                    this.x = prevX + this.r <= p.x ? p.x - this.r : p.x + p.w + this.r;
                }
            }
        });

        // Hook pull
        if (this.isLocal && this.hook.active && window.isRightClickHeld) {
            const dx = this.hook.targetX - this.x;
            const dy = this.hook.targetY - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 30) {
                this.vx += (dx / dist) * 0.8;
                this.vy += (dy / dist) * 0.8;
                this.vx *= 0.95;
                this.vy *= 0.95;
            }
        } else if (this.isLocal) {
            this.hook.active = false;
        }

        if (this.x < this.r || this.x > 800 - this.r) {
            this.vx *= -0.8;
            this.x = this.x < this.r ? this.r : 800 - this.r;
        }

        if (this.isLocal) {
            const h = Math.floor((560 - this.y) / 10);
            state.maxHeight = Math.max(state.maxHeight, h);
            document.getElementById('height-count').innerText = state.maxHeight;

            // Camera follow
            const screenY = this.y - state.camera.y;
            if (screenY < 200) state.camera.y = this.y - 200;
            if (screenY > 400) state.camera.y = this.y - 400;

            if (state.dashCooldown > 0) state.dashCooldown--;
            if (state.emojiTimer > 0) {
                state.emojiTimer--;
                if (state.emojiTimer === 0) state.myEmoji = null;
            }

            if (Math.abs(this.vx) > 0.01 || Math.abs(this.vy) > 0.01) {
                broadcastState(this);
            }
        }
    }

    hit(vx, vy) {
        this.vx = vx;
        this.vy = vy;
        createParticles(this.x, this.y, this.color, 15);
    }

    dash(targetX, targetY) {
        if (state.dashCooldown > 0) return;
        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const dist = Math.hypot(dx, dy);
        this.vx = (dx / dist) * 15;
        this.vy = (dy / dist) * 15;
        state.dashCooldown = 60;
        createParticles(this.x, this.y, this.color, 15);
    }

    draw() {
        ctx.save();
        
        if (this.isLocal && this.hook.active) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.setLineDash([5, 5]);
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.hook.targetX, this.hook.targetY);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.fillStyle = 'white';
        ctx.shadowBlur = 15;
        ctx.shadowColor = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, this.x, this.y - this.r - 10);
        
        const displayEmoji = this.isLocal ? state.myEmoji : this.emoji;
        if (displayEmoji) {
            ctx.font = '24px serif';
            ctx.fillText(displayEmoji, this.x, this.y - this.r - 30);
        }

        ctx.restore();
    }
}

// Particles & VFX
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

function showImpactText(text, x, y) {
    state.particles.push({ x, y, vx: 0, vy: -2, life: 1, text, color: '#fff' });
}

// Multiplayer
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
                p.name = pData.name || '...';
                state.otherPlayers.set(id, p);
            }
        });
    });

    state.socket.on('playerJoined', (pData) => {
        if (pData.id !== state.socket.id) {
            const p = new Player(pData.id, pData.x, pData.y, pData.color);
            p.name = pData.name || '...';
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

// Input
window.addEventListener('keydown', e => {
    keys[e.code] = true;
    const emojis = { 'Digit1': '😊', 'Digit2': '😂', 'Digit3': '🔥', 'Digit4': '💀' };
    if (emojis[e.code]) {
        state.myEmoji = emojis[e.code];
        state.emojiTimer = 120;
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (state.myPlayer && window.lastMouseX !== undefined) state.myPlayer.dash(window.lastMouseX, window.lastMouseY);
    }
});
window.addEventListener('keyup', e => keys[e.code] = false);

window.isLeftClickHeld = false;
window.isRightClickHeld = false;

canvas.addEventListener('mousedown', e => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top + state.camera.y;

    if (e.button === 0) {
        window.isLeftClickHeld = true;
        if (state.myPlayer && Math.hypot(mouseX - state.myPlayer.x, mouseY - state.myPlayer.y) < 100) state.isAiming = true;
    } else if (e.button === 2) {
        window.isRightClickHeld = true;
        state.platforms.forEach(p => {
            if (mouseX > p.x && mouseX < p.x + p.w && mouseY > p.y && mouseY < p.y + p.h) {
                state.myPlayer.hook.active = true;
                state.myPlayer.hook.targetX = mouseX;
                state.myPlayer.hook.targetY = mouseY;
            }
        });
    }
});

window.addEventListener('mouseup', e => {
    if (e.button === 0) {
        if (state.isAiming && state.myPlayer) {
            const rect = canvas.getBoundingClientRect();
            const dx = (e.clientX - rect.left) - state.myPlayer.x;
            const dy = (e.clientY - rect.top + state.camera.y) - state.myPlayer.y;
            const dist = Math.hypot(dx, dy);
            const power = Math.min(dist / 5, 25);
            state.myPlayer.hit(-dx / dist * power, -dy / dist * power);
            state.shake = power / 2;
            showImpactText("BOOM!", state.myPlayer.x, state.myPlayer.y);
        }
        state.isAiming = false;
        window.isLeftClickHeld = false;
    } else if (e.button === 2) {
        window.isRightClickHeld = false;
    }
});

window.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    window.lastMouseX = e.clientX - rect.left;
    window.lastMouseY = e.clientY - rect.top + state.camera.y;
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
            state.socket.emit('newPlayer', { x: state.myPlayer.x, y: state.myPlayer.y, color: state.myPlayer.color, name: state.playerName });
        }
    };
}

async function start() {
    await loadAssets();
    initMultiplayer();
    initMenu();

    function loop(time) {
        const h = state.myPlayer ? Math.floor((560 - state.myPlayer.y) / 10) : 0;
        let bgColor = '#1a1a2e';
        if (h > 200) bgColor = '#2e1a2e';
        if (h > 400) bgColor = '#1a2e1a';
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        if (state.shake > 0) {
            ctx.translate((Math.random()-0.5)*state.shake, (Math.random()-0.5)*state.shake);
            state.shake *= 0.9;
        }
        ctx.translate(0, -state.camera.y);

        state.goals.forEach(goal => {
            ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.moveTo(goal.x, goal.y);
            ctx.lineTo(goal.x + 30, goal.y + 15); ctx.lineTo(goal.x, goal.y + 30); ctx.fill();
            ctx.fillStyle = '#eee'; ctx.fillRect(goal.x, goal.y, 4, 60);
            ctx.fillStyle = 'white'; ctx.font = 'bold 12px Outfit'; ctx.fillText(`META: ${goal.height}m`, goal.x + 15, goal.y - 5);
        });

        state.platforms.forEach(p => {
            const sprite = state.assets[p.type];
            if (sprite) ctx.drawImage(sprite, p.x, p.y, p.w, p.h);
            else { ctx.fillStyle = '#555'; ctx.fillRect(p.x, p.y, p.w, p.h); }
        });

        if (state.myPlayer) {
            state.myPlayer.update();
            state.myPlayer.draw();
            if (state.isAiming) {
                const dx = window.lastMouseX - state.myPlayer.x;
                const dy = window.lastMouseY - state.myPlayer.y;
                const dist = Math.hypot(dx, dy);
                const power = Math.min(dist / 5, 25);
                ctx.beginPath(); ctx.strokeStyle = state.playerColor; ctx.lineWidth = 4;
                ctx.moveTo(state.myPlayer.x, state.myPlayer.y);
                ctx.lineTo(state.myPlayer.x - dx/dist*power*5, state.myPlayer.y - dy/dist*power*5); ctx.stroke();
            }
        }
        state.otherPlayers.forEach(p => p.draw());

        for (let i = state.particles.length - 1; i >= 0; i--) {
            const p = state.particles[i]; p.x += p.vx; p.y += p.vy; p.life -= 0.02;
            if (p.life <= 0) { state.particles.splice(i, 1); continue; }
            if (p.text) { ctx.fillStyle = p.color; ctx.font = 'bold 20px Outfit'; ctx.fillText(p.text, p.x, p.y); }
            else { ctx.fillStyle = p.color; ctx.globalAlpha = p.life; ctx.fillRect(p.x, p.y, 4, 4); ctx.globalAlpha = 1.0; }
        }

        if (state.myPlayer) {
            state.goals.forEach(goal => {
                const dist = Math.hypot(state.myPlayer.x - goal.x, state.myPlayer.y - goal.y);
                if (dist < 50 && !goal.reached) {
                    goal.reached = true; state.coins += 100;
                    showImpactText("SUCCESS!", goal.x, goal.y);
                    createParticles(goal.x, goal.y, '#ffcc00', 40);
                    document.getElementById('coin-count').innerText = state.coins;
                }
            });
        }
        ctx.restore();
        if (state.dashCooldown > 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'; ctx.fillRect(20, 570, 100, 10);
            ctx.fillStyle = state.playerColor; ctx.fillRect(20, 570, (1 - state.dashCooldown / 60) * 100, 10);
        }
        requestAnimationFrame(loop);
    }
    loop();
}

start();
