const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

let pasesValidos = new Set();
let admins = new Set(['Sofi081225']);
let jugadoresConectados = new Map();
let estadoJuego = 'ESPERA';

io.on('connection', (socket) => {
  socket.on('admin-login', (pass, callback) => {
    if (admins.has(pass)) {
      socket.join('admins');
      callback({ success: true, pases: Array.from(pasesValidos) });
    } else {
      callback({ success: false, error: 'Contraseña incorrecta' });
    }
  });

  socket.on('admin-generar-pase', () => {
    const nuevoPase = 'PIE-' + Math.floor(1000 + Math.random() * 9000);
    pasesValidos.add(nuevoPase);
    io.to('admins').emit('pases-actualizados', Array.from(pasesValidos));
  });

  socket.on('admin-agregar-admin', (nuevaClave) => {
    if (nuevaClave) {
      admins.add(nuevaClave);
      io.to('admins').emit('admin-notificacion', 'Nuevo administrador registrado.');
    }
  });

  socket.on('jugador-unirse', ({ nombre, pase }, callback) => {
    if (!pasesValidos.has(pase)) {
      return callback({ success: false, error: 'El pase no existe o ya fue usado.' });
    }
    if (estadoJuego !== 'ESPERA') {
      return callback({ success: false, error: 'La partida ya comenzó.' });
    }
    pasesValidos.delete(pase);
    io.to('admins').emit('pases-actualizados', Array.from(pasesValidos));

    const jugador = { id: socket.id, nombre, pase, vivo: true };
    jugadoresConectados.set(socket.id, jugador);
    socket.join('jugadores');

    callback({ success: true, jugador });
    notificarListaJugadores();
  });

  socket.on('admin-iniciar-juego', () => {
    estadoJuego = 'JUGANDO';
    io.emit('juego-iniciado');
  });

  socket.on('jugador-eliminado', () => {
    const jugador = jugadoresConectados.get(socket.id);
    if (jugador) {
      jugador.vivo = false;
      notificarListaJugadores();
      verificarGanador();
    }
  });

  socket.on('disconnect', () => {
    if (jugadoresConectados.has(socket.id)) {
      jugadoresConectados.delete(socket.id);
      notificarListaJugadores();
      if (estadoJuego === 'JUGANDO') verificarGanador();
    }
  });

  function notificarListaJugadores() {
    io.emit('actualizar-jugadores', Array.from(jugadoresConectados.values()));
  }

  function verificarGanador() {
    const vivos = Array.from(jugadoresConectados.values()).filter(j => j.vivo);
    if (vivos.length === 1 && estadoJuego === 'JUGANDO') {
      estadoJuego = 'FINALIZADO';
      io.emit('ganador-declarado', vivos[0]);
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
