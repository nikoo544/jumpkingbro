const state = {
    myPlayer: null,
    otherPlayers: new Map(),
    platforms: [],
    goals: [],
    particles: [],
    trail: [],
    camera: { x: 0, y: 0, zoom: 1 },
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
        this.r = 18;
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
        this.vy += 0.4; // Gravity
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.985; // Friction

        // Add to trail
        if (this.isLocal) {
            this.trail.push({ x: this.x, y: this.y, life: 1.0 });
            if (this.trail.length > 20) this.trail.shift();
        }

        // Platform collisions (Solid Rects)
        state.platforms.forEach(p => {
            if (this.x + this.r > p.x && this.x - this.r < p.x + p.w &&
                this.y + this.r > p.y && this.y - this.r < p.y + p.h) {
                
                const prevX = this.x - this.vx;
                const prevY = this.y - this.vy;

                if (prevY + this.r <= p.y || prevY - this.r >= p.y + p.h) {
                    this.vy *= -0.65;
                    this.y = prevY + this.r <= p.y ? p.y - this.r : p.y + p.h + this.r;
                    if (Math.abs(this.vy) > 2) createParticles(this.x, this.y, '#fff', 5);
                } else {
                    this.vx *= -0.65;
                    this.x = prevX + this.r <= p.x ? p.x - this.r : p.x + p.w + this.r;
                    if (Math.abs(this.vx) > 2) createParticles(this.x, this.y, '#fff', 5);
                }
            }
        });

        // Hook pull
        if (this.isLocal && this.hook.active && window.isRightClickHeld) {
            const dx = this.hook.targetX - this.x;
            const dy = this.hook.targetY - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 30) {
                this.vx += (dx / dist) * 0.9;
                this.vy += (dy / dist) * 0.9;
                this.vx *= 0.96;
                this.vy *= 0.96;
            }
        } else if (this.isLocal) {
            this.hook.active = false;
        }

        if (this.x < this.r || this.x > 800 - this.r) {
            this.vx *= -0.8;
            this.x = this.x < this.r ? this.r : 800 - this.r;
            createParticles(this.x, this.y, '#fff', 3);
        }

        if (this.isLocal) {
            const h = Math.floor((560 - this.y) / 10);
            state.maxHeight = Math.max(state.maxHeight, h);
            document.getElementById('height-count').innerText = state.maxHeight;

            // Smooth Camera
            const targetCamY = this.y - 300;
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
        state.shake = Math.hypot(vx, vy) / 2;
        createParticles(this.x, this.y, this.color, 20);
        showImpactText("CRACK!", this.x, this.y);
    }

    dash(targetX, targetY) {
        if (state.dashCooldown > 0) return;
        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const dist = Math.hypot(dx, dy);
        this.vx = (dx / dist) * 18;
        this.vy = (dy / dist) * 18;
        state.dashCooldown = 60;
        state.shake = 5;
        createParticles(this.x, this.y, '#fff', 15);
    }

    draw() {
        ctx.save();
        
        // Draw Trail
        if (this.isLocal) {
            ctx.beginPath();
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 10;
            ctx.lineCap = 'round';
            this.trail.forEach((t, i) => {
                ctx.globalAlpha = (i / this.trail.length) * 0.5;
                if (i === 0) ctx.moveTo(t.x, t.y);
                else ctx.lineTo(t.x, t.y);
            });
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // Hook line
        if (this.isLocal && this.hook.active) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.hook.targetX, this.hook.targetY);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Ball Body (Neon Look)
        ctx.fillStyle = 'white';
        ctx.shadowBlur = 20;
        ctx.shadowColor = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 4;
        ctx.stroke();

        // Name & Emoji
        ctx.fillStyle = 'white';
        ctx.font = 'bold 13px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, this.x, this.y - this.r - 12);
        
        const displayEmoji = this.isLocal ? state.myEmoji : this.emoji;
        if (displayEmoji) {
            ctx.font = '26px serif';
            ctx.fillText(displayEmoji, this.x, this.y - this.r - 35);
        }

        ctx.restore();
    }
}

// Particles & VFX
function createParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        state.particles.push({
            x, y, 
            vx: (Math.random() - 0.5) * 12,
            vy: (Math.random() - 0.5) * 12,
            life: 1.0,
            color
        });
    }
}

function showImpactText(text, x, y) {
    state.particles.push({ x, y, vx: (Math.random()-0.5)*2, vy: -3, life: 1.5, text, color: '#fff' });
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
        if (state.myPlayer && Math.hypot(mouseX - state.myPlayer.x, mouseY - state.myPlayer.y) < 80) state.isAiming = true;
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
            const power = Math.min(dist / 5, 28);
            state.myPlayer.hit(-dx / dist * power, -dy / dist * power);
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

function start() {
    initMultiplayer();
    initMenu();

    function loop(time) {
        const h = state.myPlayer ? Math.floor((560 - state.myPlayer.y) / 10) : 0;
        
        // Dynamic Gradient Background (Night to Space)
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        if (h < 500) {
            grad.addColorStop(0, '#1a1a2e'); // Deep Blue
            grad.addColorStop(1, '#16213e');
        } else if (h < 1500) {
            grad.addColorStop(0, '#0f3460'); // Midnight
            grad.addColorStop(1, '#1a1a2e');
        } else {
            grad.addColorStop(0, '#000000'); // Space
            grad.addColorStop(1, '#0f3460');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        if (state.shake > 0) {
            ctx.translate((Math.random()-0.5)*state.shake, (Math.random()-0.5)*state.shake);
            state.shake *= 0.85;
        }
        ctx.translate(0, -state.camera.y);

        // Draw Lobby Area (Grid floor and light)
        if (state.camera.y > -200) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
            for(let i=0; i<8; i++) {
                ctx.fillRect(i*100, 460, 2, 100);
            }
            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.font = 'bold 60px Outfit';
            ctx.textAlign = 'center';
            ctx.fillText("LOBBY", 400, 520);
            ctx.font = '20px Outfit';
            ctx.fillText("¡Lanza tu bola hacia arriba!", 400, 550);
        }

        // Draw Goals
        state.goals.forEach(goal => {
            const pulse = Math.sin(time/200) * 5;
            ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.moveTo(goal.x, goal.y + pulse);
            ctx.lineTo(goal.x + 35, goal.y + 18 + pulse); ctx.lineTo(goal.x, goal.y + 35 + pulse); ctx.fill();
            ctx.fillStyle = '#eee'; ctx.fillRect(goal.x, goal.y + pulse, 5, 65);
            ctx.fillStyle = 'white'; ctx.font = 'bold 14px Outfit'; ctx.fillText(`GOAL: ${goal.height}m`, goal.x + 20, goal.y - 10 + pulse);
            
            // Goal Light
            ctx.save();
            ctx.globalAlpha = 0.2;
            ctx.fillStyle = '#ff4d4d';
            ctx.beginPath();
            ctx.arc(goal.x, goal.y + 30, 80, 0, Math.PI*2);
            ctx.fill();
            ctx.restore();
        });

        // Draw Platforms (Normal Rects)
        state.platforms.forEach(p => {
            ctx.fillStyle = '#222';
            ctx.fillRect(p.x, p.y, p.w, p.h);
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 2;
            ctx.strokeRect(p.x, p.y, p.w, p.h);
        });

        if (state.myPlayer) {
            state.myPlayer.update();
            state.myPlayer.draw();
            
            // Trajectory Line while aiming
            if (state.isAiming) {
                const dx = window.lastMouseX - state.myPlayer.x;
                const dy = window.lastMouseY - state.myPlayer.y;
                const dist = Math.hypot(dx, dy);
                const power = Math.min(dist / 5, 28);
                
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.lineWidth = 3;
                ctx.setLineDash([5, 8]);
                
                let tx = state.myPlayer.x;
                let ty = state.myPlayer.y;
                let tvx = -dx / dist * power;
                let tvy = -dy / dist * power;
                
                ctx.moveTo(tx, ty);
                for(let i=0; i<30; i++) {
                    tvy += 0.4;
                    tx += tvx;
                    ty += tvy;
                    ctx.lineTo(tx, ty);
                }
                ctx.stroke();
                ctx.setLineDash([]);

                // Visual Power Ring
                ctx.beginPath();
                ctx.strokeStyle = state.playerColor;
                ctx.lineWidth = 6;
                ctx.arc(state.myPlayer.x, state.myPlayer.y, 45, 0, Math.PI * 2 * (power / 28));
                ctx.stroke();
            }
        }
        state.otherPlayers.forEach(p => p.draw());

        // Particles
        for (let i = state.particles.length - 1; i >= 0; i--) {
            const p = state.particles[i]; p.x += p.vx; p.y += p.vy; p.life -= 0.015;
            if (p.life <= 0) { state.particles.splice(i, 1); continue; }
            if (p.text) { 
                ctx.fillStyle = `rgba(255,255,255,${p.life})`; 
                ctx.font = 'bold 22px Outfit'; ctx.fillText(p.text, p.x, p.y); 
            }
            else { 
                ctx.fillStyle = p.color; ctx.globalAlpha = p.life; 
                ctx.fillRect(p.x, p.y, 5, 5); ctx.globalAlpha = 1.0; 
            }
        }

        if (state.myPlayer) {
            state.goals.forEach(goal => {
                const dist = Math.hypot(state.myPlayer.x - goal.x, state.myPlayer.y - goal.y);
                if (dist < 60 && !goal.reached) {
                    goal.reached = true; state.coins += 100;
                    showImpactText("LEVEL UP!", goal.x, goal.y);
                    createParticles(goal.x, goal.y, '#ffcc00', 50);
                    document.getElementById('coin-count').innerText = state.coins;
                }
            });
        }
        ctx.restore();
        
        // HUD Energy Bar
        if (state.dashCooldown > 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'; ctx.fillRect(20, 570, 100, 12);
            ctx.fillStyle = state.playerColor; ctx.fillRect(20, 570, (1 - state.dashCooldown / 60) * 100, 12);
        }
        requestAnimationFrame(loop);
    }
    loop();
}

start();
