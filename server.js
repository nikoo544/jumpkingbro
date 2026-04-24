const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, './')));

let players = {};
let leaderboard = [];
let platforms = [];
let goals = [];

// High-Safety Level Generation
function generateLevel() {
    platforms = [];
    goals = [];
    
    // Solid Base Floor
    platforms.push({ x: 0, y: 560, w: 800, h: 200, type: 'base' });
    
    let lastY = 560;
    for (let i = 0; i < 300; i++) {
        const w = 100 + Math.random() * 80;
        const x = Math.random() * (800 - w);
        const y = lastY - (120 + Math.random() * 80);
        
        platforms.push({ x, y, w, h: 30, id: i });
        
        // Goals every 30 platforms
        if (i > 0 && i % 30 === 0) {
            goals.push({ x: x + w/2 - 20, y: y - 80, height: Math.floor((560 - y)/10) });
        }
        lastY = y;
    }
}
generateLevel();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Send level immediately
    socket.emit('initLevel', { platforms, goals });

    socket.on('newPlayer', (data) => {
        players[socket.id] = {
            id: socket.id,
            x: data.x,
            y: data.y,
            name: data.name || 'Invitado',
            color: data.color || '#ff4d4d',
            height: 0,
            emoji: null
        };
        io.emit('currentPlayers', players);
    });

    socket.on('playerUpdate', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].emoji = data.emoji;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('updateHeight', (h) => {
        if (players[socket.id]) {
            players[socket.id].height = h;
            updateLeaderboard();
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
        updateLeaderboard();
    });
});

function updateLeaderboard() {
    leaderboard = Object.values(players)
        .sort((a, b) => b.height - a.height)
        .slice(0, 5)
        .map(p => ({ name: p.name, height: p.height }));
    io.emit('leaderboardUpdate', leaderboard);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
