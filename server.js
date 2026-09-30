const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let validPasses = new Set();
let activePlayers = []; // { id, name, passUsed, alive: true }
let gameState = 'LOBBY'; // LOBBY, PLAYING, FINISHED
let currentQuestionIndex = 0;
let prizeAmount = "100";
let questionTimer = null;

// Banco de Preguntas por Dificultad
const questions = [
    // FÁCIL
    { level: 'FÁCIL', q: '¿Cuál es el planeta más cercano al Sol?', options: ['Venus', 'Mercurio', 'Marte', 'Júliter'], correct: 1 },
    { level: 'FÁCIL', q: '¿Cuántos minutos tiene una hora?', options: ['50', '100', '60', '120'], correct: 2 },
    { level: 'FÁCIL', q: '¿De qué color es la bandera de México en la franja izquierda?', options: ['Blanco', 'Rojo', 'Verde', 'Amarillo'], correct: 2 },
    
    // MEDIO
    { level: 'MEDIO', q: '¿En qué año comenzó la Segunda Guerra Mundial?', options: ['1914', '1939', '1945', '1929'], correct: 1 },
    { level: 'MEDIO', q: '¿Cuál es el elemento químico con el símbolo "Au"?', options: ['Plata', 'Cobre', 'Oro', 'Aluminio'], correct: 2 },
    { level: 'MEDIO', q: '¿Cuál es el océano más grande del mundo?', options: ['Atlántico', 'Índico', 'Pacífico', 'Ártico'], correct: 2 },

    // DIFÍCIL
    { level: 'DIFÍCIL', q: '¿Cuál es el hueso más largo del cuerpo humano?', options: ['Fémur', 'Tibia', 'Húmero', 'Radio'], correct: 0 },
    { level: 'DIFÍCIL', q: '¿Qué científico propuso la Teoría de la Relatividad General?', options: ['Isaac Newton', 'Nikola Tesla', 'Albert Einstein', 'Galileo Galilei'], correct: 2 }
];

function prefixes() {
    const p = ['PASS', 'VIP', 'ROYALE', 'GOLD', 'TICKET'];
    return p[Math.floor(Math.random() * p.length)];
}

io.on('connection', (socket) => {
    socket.emit('update-admin-data', {
        players: activePlayers,
        passesCount: validPasses.size,
        gameState,
        prizeAmount
    });

    // Administradora cambia el monto del premio
    socket.on('admin-set-prize', (amount) => {
        prizeAmount = amount;
        io.emit('update-prize', prizeAmount);
    });

    // Administradora genera pase desechable
    socket.on('admin-generate-pass', () => {
        const pass = `${prefixes()}-${Math.floor(1000 + Math.random() * 9000)}`;
        validPasses.add(pass);
        socket.emit('pass-created', pass);
    });

    // Jugador se une
    socket.on('player-join', (data) => {
        if (gameState !== 'LOBBY') {
            socket.emit('join-error', 'La partida ya está en curso.');
            return;
        }

        const cleanPass = data.pass.trim().toUpperCase();
        const cleanName = data.name.trim();

        if (!validPasses.has(cleanPass)) {
            socket.emit('join-error', 'Pase inválido o ya fue utilizado.');
            return;
        }

        validPasses.delete(cleanPass); // Pase desechable consumido

        const newPlayer = { id: socket.id, name: cleanName, passUsed: cleanPass, alive: true };
        activePlayers.push(newPlayer);

        socket.emit('join-success', { name: cleanName, prize: prizeAmount });

        io.emit('update-admin-data', {
            players: activePlayers,
            passesCount: validPasses.size,
            gameState,
            prizeAmount
        });
    });

    // Administradora inicia la partida
    socket.on('admin-start', () => {
        if (activePlayers.length === 0) return;
        gameState = 'PLAYING';
        currentQuestionIndex = 0;
        sendQuestion();
    });

    // Respuestas del jugador
    socket.on('submit-answer', (optionIndex) => {
        const player = activePlayers.find(p => p.id === socket.id);
        if (!player || !player.alive) return;

        const currentQ = questions[currentQuestionIndex];
        if (optionIndex !== currentQ.correct) {
            player.alive = false; // ELIMINADO
            socket.emit('player-eliminated', 'Has seleccionado una respuesta incorrecta.');
            checkWinners();
        } else {
            socket.emit('answer-accepted');
        }
    });

    // Administradora reinicia sala
    socket.on('admin-reset', () => {
        if (questionTimer) clearInterval(questionTimer);
        validPasses.clear();
        activePlayers = [];
        gameState = 'LOBBY';
        io.emit('reset-client');
        io.emit('update-admin-data', { players: [], passesCount: 0, gameState, prizeAmount });
    });

    socket.on('disconnect', () => {
        activePlayers = activePlayers.filter(p => p.id !== socket.id);
        io.emit('update-admin-data', { players: activePlayers, passesCount: validPasses.size, gameState, prizeAmount });
    });
});

function sendQuestion() {
    if (currentQuestionIndex >= questions.length) {
        endGame();
        return;
    }

    const aliveCount = activePlayers.filter(p => p.alive).length;
    if (aliveCount <= 1 && activePlayers.length > 1) {
        endGame();
        return;
    }

    const q = questions[currentQuestionIndex];
    let timeLeft = 15;

    io.emit('new-question', {
        questionNumber: currentQuestionIndex + 1,
        totalQuestions: questions.length,
        level: q.level,
        q: q.q,
        options: q.options,
        timeLeft
    });

    if (questionTimer) clearInterval(questionTimer);
    questionTimer = setInterval(() => {
        timeLeft--;
        io.emit('timer-tick', timeLeft);

        if (timeLeft <= 0) {
            clearInterval(questionTimer);
            // Eliminar a los que no respondieron a tiempo
            currentQuestionIndex++;
            sendQuestion();
        }
    }, 1000);
}

function checkWinners() {
    const alivePlayers = activePlayers.filter(p => p.alive);
    if (alivePlayers.length <= 1) {
        endGame();
    }
}

function endGame() {
    if (questionTimer) clearInterval(questionTimer);
    gameState = 'FINISHED';
    const alivePlayers = activePlayers.filter(p => p.alive);
    
    let winnerName = "Nadie (Todos fueron eliminados)";
    if (alivePlayers.length >= 1) {
        winnerName = alivePlayers[0].name;
    }

    io.emit('game-over', { winner: winnerName, prize: prizeAmount });
    io.emit('update-admin-data', { players: activePlayers, passesCount: validPasses.size, gameState, winner: winnerName, prizeAmount });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));

