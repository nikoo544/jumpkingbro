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

io.on('connection', (socket) => {
    console.log('Jugador conectado:', socket.id);

    // Send existing players to the new one
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
