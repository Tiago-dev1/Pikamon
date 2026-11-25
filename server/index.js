const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { loadGameData } = require('./dataLoader');
const { MatchManager } = require('./matchManager');
const { registerSocketHandlers } = require('./socketHandler');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 3000;

/**
 * Returns local IPv4 LAN addresses so friends on the same network can connect.
 */
function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const ifaceList of Object.values(nets)) {
    if (!ifaceList) continue;
    for (const net of ifaceList) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

function bootstrap() {
  const gameData = loadGameData();
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*' }
  });

  const lanIps = getLanAddresses();
  let activePort = PORT;
  let lanUrls = lanIps.map((ip) => `http://${ip}:${activePort}`);

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      port: activePort,
      creatures: gameData.creaturesList.length,
      types: Object.keys(gameData.typesById).length
    });
  });

  app.get('/api/network-info', (_req, res) => {
    res.json({ port: activePort, lanUrls });
  });

  const matchManager = new MatchManager(gameData);
  registerSocketHandlers(io, matchManager, gameData, { port: activePort, lanUrls });

  const onListen = () => {
    console.log(`[Pikamon] Servidor local: http://localhost:${activePort}`);
    for (const url of lanUrls) {
      console.log(`[Pikamon] Rede local (LAN): ${url}`);
    }
  };

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      activePort = PORT + 1;
      lanUrls = lanIps.map((ip) => `http://${ip}:${activePort}`);
      console.error(`[Pikamon] Porta ${PORT} em uso. Tentando porta ${activePort}...`);
      server.listen(activePort, HOST, onListen);
    } else {
      console.error('[Pikamon] Erro no servidor:', err);
    }
  });

  server.listen(PORT, HOST, onListen);
}

bootstrap();
