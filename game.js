const state = {
    myPlayer: null,
    otherPlayers: new Map(),
    platforms: [],
    goals: [],
    particles: [],
    cameraY: 0,
    shake: 0,
    playerName: '',
    playerColor: '#ff4d4d',
    isAiming: false,
    socket: null,
    maxHeight: 0
};

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const keys = {};

class Player {
    constructor(id, x, y, color, isLocal = false) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.r = 20;
        this.vx = 0;
        this.vy = 0;
        this.color = color;
        this.isLocal = isLocal;
        this.name = '';
        this.hook = { active: false, tx: 0, ty: 0 };
    }

    update() {
        this.vy += 0.4; // Gravity
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.98; // Air friction

        // COLLISION: Simple and solid
        const checkPlatforms = state.platforms.length > 0 ? state.platforms : [{x:0, y:560, w:800, h:100}];
        checkPlatforms.forEach(p => {
            if (this.x + this.r > p.x && this.x - this.r < p.x + p.w &&
                this.y + this.r > p.y && this.y - this.r < p.y + p.h) {
                
                const prevY = this.y - this.vy;
                if (prevY + this.r <= p.y) {
                    this.y = p.y - this.r;
                    this.vy *= -0.5;
                } else if (prevY - this.r >= p.y + p.h) {
                    this.y = p.y + p.h + this.r;
                    this.vy = 0.5;
                } else {
                    this.x = (this.x < p.x + p.w/2) ? p.x - this.r : p.x + p.w + this.r;
                    this.vx *= -0.5;
                }
            }
        });

        // HOOK
        if (this.isLocal && this.hook.active && window.isRightClickHeld) {
            const dx = this.hook.tx - this.x;
            const dy = this.hook.ty - this.y;
            const dist = Math.hypot(dx, dy);
            this.vx += (dx / dist) * 0.8;
            this.vy += (dy / dist) * 0.8;
            this.vx *= 0.96; this.vy *= 0.96;
        }

        // BOUNDARIES
        if (this.x < this.r) { this.x = this.r; this.vx = Math.abs(this.vx) * 0.5; }
        if (this.x > 800 - this.r) { this.x = 800 - this.r; this.vx = -Math.abs(this.vx) * 0.5; }

        if (this.isLocal) {
            // CAMERA
            const targetCam = this.y - 300;
            state.cameraY += (targetCam - state.cameraY) * 0.1;

            // SYNC
            if (Math.abs(this.vx) > 0.1 || Math.abs(this.vy) > 0.1) {
                state.socket.emit('playerUpdate', { x: this.x, y: this.y, color: this.color, name: this.name });
            }
            
            const h = Math.floor((560 - this.y) / 10);
            if (h > state.maxHeight) {
                state.maxHeight = h;
                state.socket.emit('updateHeight', h);
                document.getElementById('height-count').innerText = h;
            }
        }
    }

    draw() {
        ctx.save();
        if (this.isLocal && this.hook.active) {
            ctx.beginPath(); ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.setLineDash([5,5]);
            ctx.moveTo(this.x, this.y); ctx.lineTo(this.hook.tx, this.hook.ty); ctx.stroke();
        }
        ctx.fillStyle = 'white'; ctx.shadowBlur = 15; ctx.shadowColor = this.color;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = this.color; ctx.lineWidth = 4; ctx.stroke();
        ctx.fillStyle = 'white'; ctx.font = 'bold 12px Outfit'; ctx.textAlign = 'center';
        ctx.fillText(this.name || 'Yo', this.x, this.y - this.r - 10);
        ctx.restore();
    }
}

function initMultiplayer() {
    state.socket = io();
    state.socket.on('initLevel', d => { state.platforms = d.platforms; state.goals = d.goals; });
    state.socket.on('currentPlayers', ps => {
        Object.keys(ps).forEach(id => {
            if (id !== state.socket.id && !state.otherPlayers.has(id)) {
                const p = new Player(id, ps[id].x, ps[id].y, ps[id].color);
                p.name = ps[id].name;
                state.otherPlayers.set(id, p);
            }
        });
    });
    state.socket.on('playerMoved', d => {
        let p = state.otherPlayers.get(d.id);
        if (p) { p.x = d.x; p.y = d.y; }
    });
    state.socket.on('playerLeft', id => state.otherPlayers.delete(id));
    state.socket.on('leaderboardUpdate', b => {
        const list = document.getElementById('rank-list');
        list.innerHTML = b.map((e, i) => `<li><span>${i+1}. ${e.name}</span><span>${e.height}m</span></li>`).join('');
    });
}

function getMouse(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left), y: (e.clientY - rect.top) + state.cameraY };
}

canvas.addEventListener('mousedown', e => {
    const m = getMouse(e);
    if (e.button === 0) {
        if (state.myPlayer && Math.hypot(m.x - state.myPlayer.x, m.y - state.myPlayer.y) < 100) state.isAiming = true;
    } else if (e.button === 2) {
        window.isRightClickHeld = true;
        state.platforms.forEach(p => {
            if (m.x > p.x && m.x < p.x + p.w && m.y > p.y && m.y < p.y + p.h) {
                state.myPlayer.hook.active = true; state.myPlayer.hook.tx = m.x; state.myPlayer.hook.ty = m.y;
            }
        });
    }
});
window.addEventListener('mouseup', e => {
    if (e.button === 0 && state.isAiming) {
        const m = getMouse(e);
        const dx = m.x - state.myPlayer.x; const dy = m.y - state.myPlayer.y;
        const dist = Math.hypot(dx, dy); const power = Math.min(dist / 5, 25);
        state.myPlayer.vx = -dx/dist*power; state.myPlayer.vy = -dy/dist*power;
        state.isAiming = false;
    }
    if (e.button === 2) window.isRightClickHeld = false;
});
window.addEventListener('mousemove', e => { const m = getMouse(e); window.mx = m.x; window.my = m.y; });
window.addEventListener('keydown', e => {
    if (e.code === 'ShiftLeft' && state.myPlayer) {
        const dx = window.mx - state.myPlayer.x; const dy = window.my - state.myPlayer.y;
        const dist = Math.hypot(dx, dy);
        state.myPlayer.vx = dx/dist*15; state.myPlayer.vy = dy/dist*15;
    }
});
canvas.oncontextmenu = e => e.preventDefault();

function initMenu() {
    const startBtn = document.getElementById('start-btn');
    const colorOpts = document.querySelectorAll('.color-opt');
    colorOpts.forEach(o => o.onclick = () => {
        colorOpts.forEach(x => x.classList.remove('selected'));
        o.classList.add('selected'); state.playerColor = o.dataset.color;
    });
    startBtn.onclick = () => {
        state.playerName = document.getElementById('player-name').value || "Yo";
        document.getElementById('start-menu').style.display = 'none';
        state.myPlayer = new Player(state.socket.id, 400, 500, state.playerColor, true);
        state.myPlayer.name = state.playerName;
        state.socket.emit('newPlayer', { x: 400, y: 500, color: state.playerColor, name: state.playerName });
    };
}

function loop() {
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle = '#0f0f1b'; ctx.fillRect(0,0,800,600);
    
    ctx.save();
    ctx.translate(0, -state.cameraY);
    
    // Background Lobby Area
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(-100, 460, 1000, 200);
    ctx.fillStyle = 'white'; ctx.font = '900 60px Outfit'; ctx.textAlign = 'center';
    ctx.fillText("LOBBY", 400, 530);

    state.platforms.forEach(p => {
        ctx.fillStyle = '#222'; ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = '#444'; ctx.lineWidth = 2; ctx.strokeRect(p.x, p.y, p.w, p.h);
    });

    state.goals.forEach(g => {
        ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.moveTo(g.x, g.y);
        ctx.lineTo(g.x+30, g.y+15); ctx.lineTo(g.x, g.y+30); ctx.fill();
        ctx.fillStyle = '#eee'; ctx.fillRect(g.x, g.y, 4, 60);
    });

    state.otherPlayers.forEach(p => p.draw());
    if (state.myPlayer) {
        state.myPlayer.update(); state.myPlayer.draw();
        if (state.isAiming) {
            const dx = window.mx - state.myPlayer.x; const dy = window.my - state.myPlayer.y;
            const dist = Math.hypot(dx, dy); const power = Math.min(dist / 5, 25);
            ctx.beginPath(); ctx.strokeStyle = state.playerColor; ctx.lineWidth = 5;
            ctx.moveTo(state.myPlayer.x, state.myPlayer.y);
            ctx.lineTo(state.myPlayer.x - dx/dist*power*5, state.myPlayer.y - dy/dist*power*5);
            ctx.stroke();
        }
    }
    
    ctx.restore();
    requestAnimationFrame(loop);
}

initMultiplayer();
initMenu();
loop();
