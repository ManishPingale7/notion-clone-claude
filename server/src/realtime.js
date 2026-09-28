import { WebSocketServer } from 'ws';
import { parseCookies, userFromToken, consumeWsToken } from './auth.js';
import { pageRole, userWorkspaces } from './permissions.js';

// Realtime hub. Clients subscribe to rooms:
//   ws:<workspaceId>  sidebar / page tree changes
//   page:<pageId>     block operations, page metadata, database changes, presence
//   user:<userId>     notifications (joined automatically)
// Every mutation made through the REST API is broadcast to the relevant room so
// other tabs and other users see changes live.

const rooms = new Map(); // room -> Set<socket>
const presence = new Map(); // pageId -> Map<clientId, {userId, name, color, blockId, at}>

function join(sock, room) {
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(sock);
  sock.rooms.add(room);
}

function leave(sock, room) {
  rooms.get(room)?.delete(sock);
  if (rooms.get(room)?.size === 0) rooms.delete(room);
  sock.rooms.delete(room);
  if (room.startsWith('page:')) {
    const pageId = room.slice(5);
    if (presence.get(pageId)?.delete(sock.clientId)) sendPresence(pageId);
  }
}

export function broadcast(room, msg, exceptClientId) {
  const set = rooms.get(room);
  if (!set) return;
  const data = JSON.stringify(msg);
  for (const s of set) {
    if (exceptClientId && s.clientId === exceptClientId) continue;
    if (s.readyState === 1) s.send(data);
  }
}

export const toPage = (pageId, msg, except) => broadcast('page:' + pageId, { ...msg, pageId }, except);
export const toWorkspace = (workspaceId, msg, except) => broadcast('ws:' + workspaceId, { ...msg, workspaceId }, except);
export const toUser = (userId, msg) => broadcast('user:' + userId, msg);

function sendPresence(pageId) {
  const map = presence.get(pageId);
  const users = map ? [...map.entries()].map(([clientId, p]) => ({ clientId, ...p })) : [];
  broadcast('page:' + pageId, { type: 'presence', pageId, users });
}

export function attachRealtime(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') return socket.destroy();
    const user = userFromToken(parseCookies(req.headers.cookie).sid) || consumeWsToken(url.searchParams.get('token'));
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = user;
      ws.clientId = url.searchParams.get('clientId') || Math.random().toString(36).slice(2);
      ws.rooms = new Set();
      ws.isAlive = true;
      join(ws, 'user:' + user.id);
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      handleMessage(ws, msg);
    });
    ws.on('close', () => {
      for (const r of [...ws.rooms]) leave(ws, r);
    });
    ws.send(JSON.stringify({ type: 'hello', clientId: ws.clientId }));
  });

  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  wss.on('close', () => clearInterval(interval));
  return wss;
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'subscribe': {
      for (const room of msg.rooms || []) {
        if (typeof room !== 'string' || ws.rooms.has(room)) continue;
        if (room.startsWith('ws:')) {
          const wsId = room.slice(3);
          if (userWorkspaces(ws.user.id).some((w) => w.id === wsId)) join(ws, room);
        } else if (room.startsWith('page:')) {
          const pageId = room.slice(5);
          if (pageRole(ws.user.id, pageId)) join(ws, room);
        }
      }
      break;
    }
    case 'unsubscribe':
      for (const room of msg.rooms || []) if (ws.rooms.has(room) && !room.startsWith('user:')) leave(ws, room);
      break;
    case 'presence': {
      const pageId = msg.pageId;
      if (!pageId || !ws.rooms.has('page:' + pageId)) return;
      if (!presence.has(pageId)) presence.set(pageId, new Map());
      presence.get(pageId).set(ws.clientId, {
        userId: ws.user.id,
        name: ws.user.name,
        color: ws.user.color,
        blockId: typeof msg.blockId === 'string' ? msg.blockId : null,
        at: Date.now(),
      });
      sendPresence(pageId);
      break;
    }
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    default:
      break;
  }
}
