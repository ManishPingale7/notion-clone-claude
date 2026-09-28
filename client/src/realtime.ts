import { api, clientId } from './api';

// In split deployments (static frontend + API elsewhere) VITE_WS_URL points at
// the API host, e.g. wss://my-api.fly.dev. Otherwise the socket is same-origin.
const WS_URL: string | undefined = import.meta.env.VITE_WS_URL;

// WebSocket client with automatic reconnect and room re-subscription.

type Listener = (msg: any) => void;

class Realtime {
  private ws: WebSocket | null = null;
  private rooms = new Map<string, number>(); // room -> refcount
  private listeners = new Set<Listener>();
  private retry = 0;
  private closedByUser = false;
  private lastPresence: any = null;
  connected = false;
  private statusListeners = new Set<(c: boolean) => void>();

  private connecting = false;

  async connect() {
    this.closedByUser = false;
    if ((this.ws && this.ws.readyState <= 1) || this.connecting) return;
    let url: string;
    if (WS_URL) {
      this.connecting = true;
      try {
        const { token } = await api.post('/api/auth/ws-token');
        url = `${WS_URL.replace(/\/$/, '')}/ws?clientId=${clientId}&token=${encodeURIComponent(token)}`;
      } catch {
        this.connecting = false;
        if (!this.closedByUser) setTimeout(() => this.connect(), Math.min(10000, 500 * 2 ** this.retry++));
        return;
      }
      this.connecting = false;
      if (this.closedByUser) return;
    } else {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      url = `${proto}://${location.host}/ws?clientId=${clientId}`;
    }
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setConnected(true);
      if (this.rooms.size) this.send({ type: 'subscribe', rooms: [...this.rooms.keys()] });
      if (this.lastPresence) this.send(this.lastPresence);
      this.emit({ type: 'reconnected' });
    };
    ws.onmessage = (e) => {
      try {
        this.emit(JSON.parse(e.data));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      this.setConnected(false);
      this.ws = null;
      if (this.closedByUser) return;
      const delay = Math.min(10000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  disconnect() {
    this.closedByUser = true;
    this.ws?.close();
    this.ws = null;
  }

  private setConnected(c: boolean) {
    this.connected = c;
    this.statusListeners.forEach((l) => l(c));
  }

  onStatus(fn: (c: boolean) => void) {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  private emit(msg: any) {
    this.listeners.forEach((l) => l(msg));
  }

  subscribe(room: string) {
    const n = this.rooms.get(room) || 0;
    this.rooms.set(room, n + 1);
    if (n === 0) this.send({ type: 'subscribe', rooms: [room] });
    return () => {
      const m = (this.rooms.get(room) || 1) - 1;
      if (m <= 0) {
        this.rooms.delete(room);
        this.send({ type: 'unsubscribe', rooms: [room] });
      } else this.rooms.set(room, m);
    };
  }

  /** Re-sends subscriptions (e.g. after gaining access to a page). */
  resubscribe(room: string) {
    this.send({ type: 'subscribe', rooms: [room] });
  }

  presence(pageId: string, blockId: string | null) {
    this.lastPresence = { type: 'presence', pageId, blockId };
    this.send(this.lastPresence);
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

export const realtime = new Realtime();
