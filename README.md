# Pikamon Arena

Jogo de batalha multiplayer em tempo real por turnos sincronizados pelo servidor, utilizando **Node.js + Express + Socket.io** no back-end e **HTML5 Canvas + JavaScript puro** no front-end, com estética pixel art inspirada em *Celeste*.

## Como testar localmente (PC ou Wi-Fi/LAN)

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Inicie o servidor:
   ```bash
   npm start
   ```
3. Abra `http://localhost:3000` em **duas abas** (ou envie o endereço da sua rede local exibido no terminal, ex. `http://10.x.x.x:3000`, para outro dispositivo no mesmo Wi-Fi).

## Como postar no ar gratuitamente (Render)

O projeto já inclui [render.yaml](render.yaml) pronto para publicação com suporte completo a WebSockets (`Socket.io`):

1. Suba esta pasta para um repositório no **GitHub**.
2. Acesse **https://render.com**, clique em **New +** → **Web Service** e conecte seu repositório.
3. O Render detecta o Node.js automaticamente (`Build: npm install`, `Start: npm start`).
4. Clique em **Create Web Service** e use o link público `https://seu-app.onrender.com` para jogar de qualquer lugar!

## Arquitetura

- `data/` — Dados separados da lógica de combate (`types.json`, `moves.json`, `creatures.json`, `items.json`).
- `server/` — Fonte única de verdade (`dataLoader.js`, `combatEngine.js`, `matchManager.js`, `socketHandler.js`, `index.js`).
- `public/` — Cliente HTML5 Canvas + JS puro (`network.js`, `sprites.js`, `renderer.js`, `ui.js`, `main.js`).

## Eventos Socket.io

### Cliente -> Servidor
- `lobby:set_nickname` `{ nickname }`
- `queue:join` `{ nickname }`
- `queue:leave` `{}`
- `room:create` `{ nickname, isPublic? }`
- `room:join` `{ roomCode, nickname }`
- `room:leave` `{}`
- `creature:select` `{ creatureId }`
- `battle:action` `{ type, itemId? }` (`attack_weak`, `attack_signature`, `buff`, `debuff`, `protect`, `item`, `forfeit`)
- `battle:rematch` `{}`

### Servidor -> Cliente
- `catalog:init` `{ types, moves, protect, creatures, items, networkInfo }`
- `lobby:update` `{ openRooms, onlineCount, onlinePlayers }`
- `queue:status` `{ queued, message }`
- `room:joined` `{ roomId, roomCode, playerId, state }`
- `match:state` `{ state }`
- `battle:turn` `{ turnResult, state }`
- `match:ended` `{ winnerId, reason, state }`
- `action:error` `{ code, message }`
