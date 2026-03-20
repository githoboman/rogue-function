/**
 * ws.ts — WebSocket client for spectator + player frontend
 * Connects to shard server, emits typed game events
 */

export interface PlayerState {
  playerId: string;
  zone: string;
  position: { x: number; y: number };
  health: number;
  maxHealth: number;
  level: number;
  xp: number;
  inventory: any[];
  activeQuests: any[];
  nearbyEntities: any[];
}

interface WorldState {
  players: Record<string, PlayerState>;
}

type EventHandler = (event: any) => void;
type SnapshotHandler = (snapshot: any) => void;

export class GameWebSocket {
  private ws: WebSocket | null = null;
  private handlers: EventHandler[] = [];
  private snapshotHandlers: SnapshotHandler[] = [];
  private reconnectDelay = 2000;
  private statusEl: HTMLElement | null = null;
  public worldState: WorldState = { players: {} };

  connect(url: string): void {
    this.statusEl = document.getElementById("connection-status");
    this.tryConnect(url);
  }

  private tryConnect(url: string): void {
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log("Connected to shard server");
      this.setStatus(true);
      this.reconnectDelay = 2000;
    };

    this.ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data);

        // tick events carry the full world snapshot
        if (event.type === "tick") {
          const snapshot = event.data;
          if (snapshot) {
            // Update local world state from agents
            for (const agent of snapshot.agents || []) {
              this.worldState.players[agent.id] = {
                playerId: agent.id,
                zone: agent.zone,
                position: { x: agent.x ?? 100, y: agent.y ?? 100 },
                health: agent.hp,
                maxHealth: agent.maxHp,
                level: agent.level,
                xp: agent.xp,
                inventory: [],
                activeQuests: [],
                nearbyEntities: [],
              };
            }
            this.snapshotHandlers.forEach(h => h(snapshot));
          }
        }

        // history events (sent on connect) — replay them
        if (event.type === "history" && event.events) {
          for (const e of event.events) {
            this.handlers.forEach(h => h(e));
          }
          return;
        }

        this.handlers.forEach(h => h(event));
      } catch (e) {
        console.warn("Failed to parse WS message", e);
      }
    };

    this.ws.onclose = () => {
      this.setStatus(false);
      console.log(`Disconnected — reconnecting in ${this.reconnectDelay}ms`);
      setTimeout(() => this.tryConnect(url), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 10000);
    };

    this.ws.onerror = () => this.setStatus(false);
  }

  on(eventType: string, handler: (event: any) => void): void {
    this.handlers.push((event: any) => {
      if (event.type === eventType) handler(event);
    });
  }

  onEvent(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  onSnapshot(handler: SnapshotHandler): void {
    this.snapshotHandlers.push(handler);
  }

  send(data: any): void {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private setStatus(connected: boolean): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = connected ? "● Connected" : "● Disconnected";
    this.statusEl.className = connected ? "connected" : "disconnected";
  }
}

export const gameWS = new GameWebSocket();
