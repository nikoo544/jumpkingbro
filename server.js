const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(__dirname));

const players = {};
let leaderboard = [];
let platforms = [];
let items = [];

// Generate platforms once on server start
function generateLevel() {
    platforms = [{ x: 0, y: 560, w: 800, h: 100 }];
    let lastY = 560;
    for (let i = 0; i < 200; i++) {
        const x = Math.random() * 600 + 50;
        const y = lastY - (Math.random() * 80 + 120);
        const w = Math.random() * 100 + 80;
        platforms.push({ x, y, w, h: 20 });
        
        if (Math.random() > 0.6) {
            items.push({ x: x + w/2 - 15, y: y - 40, type: 'coin' });
        }
        lastY = y;
    }
}
generateLevel();

io.on('connection', (socket) => {
    console.log('Jugador conectado:', socket.id);

    // Send level and current state to new player
    socket.emit('initLevel', { platforms, items });
    socket.emit('currentPlayers', players);
    socket.emit('leaderboardUpdate', leaderboard);

    // Handle new player registration
    socket.on('newPlayer', (playerData) => {
        players[socket.id] = {
            id: socket.id,
            x: playerData.x,
            y: playerData.y,
            state: playerData.state,
            color: playerData.color,
            height: 0
        };
        socket.broadcast.emit('playerJoined', players[socket.id]);
    });

    // Handle movement updates
    socket.on('playerUpdate', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].state = data.state;
            
            // Broadcast to everyone else
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    // Handle ranking updates
    socket.on('updateHeight', (height) => {
        if (players[socket.id]) {
            players[socket.id].height = height;
            updateLeaderboard(socket.id, height);
        }
    });

    socket.on('disconnect', () => {
        console.log('Jugador desconectado:', socket.id);
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

function updateLeaderboard(id, height) {
    const entry = leaderboard.find(e => e.id === id);
    if (entry) {
        if (height > entry.height) entry.height = height;
    } else {
        leaderboard.push({ id, height });
    }
    
    leaderboard.sort((a, b) => b.height - a.height);
    leaderboard = leaderboard.slice(0, 5);
    io.emit('leaderboardUpdate', leaderboard);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
