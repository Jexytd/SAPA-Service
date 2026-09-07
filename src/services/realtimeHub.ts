import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { Response } from 'express';

export type RealtimeEventType = 
  | 'ticket.created'
  | 'ticket.assigned'
  | 'ticket.status_changed'
  | 'ticket.message'
  | 'ticket.closed'
  | 'ticket.released'
  | 'ticket.transferred'
  | 'ticket.auto_closed';

export interface RealtimeEventPayload {
  event: RealtimeEventType;
  timestamp: string;
  data: any;
}

class RealtimeHub {
  private wss: WebSocketServer | null = null;
  private sseClients: Set<Response> = new Set();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  public init(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: '/ws/cs' });

    this.wss.on('connection', (ws: WebSocket, req) => {
      (ws as any).isAlive = true;
      const clientIp = req.socket.remoteAddress || 'unknown';
      console.log(`[REALTIME WS] Admin CS terhubung dari: ${clientIp}`);

      // Listen to native pong response
      ws.on('pong', () => {
        (ws as any).isAlive = true;
      });

      ws.send(JSON.stringify({
        event: 'connected',
        timestamp: new Date().toISOString(),
        message: 'Terhubung ke Realtime CS Hub SAPA BPS'
      }));

      ws.on('message', (raw) => {
        try {
          (ws as any).isAlive = true;
          const data = JSON.parse(raw.toString());
          if (data.type === 'ping' || data.action === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          } else if (data.action === 'cs_subscribe') {
            ws.send(JSON.stringify({
              event: 'subscribed',
              timestamp: new Date().toISOString(),
              message: 'Berhasil subscribe event Customer Service'
            }));
          }
        } catch {}
      });

      ws.on('close', (code, reason) => {
        const reasonStr = reason ? reason.toString() : 'tidak ada alasan spesifik';
        console.log(`[REALTIME WS] Koneksi Admin CS terputus. Kode: ${code}, Alasan: ${reasonStr}`);
      });

      ws.on('error', (err) => {
        console.warn('[REALTIME WS ERROR]', err.message);
      });
    });

    // Heartbeat berkala setiap 30 detik untuk mendeteksi dead-socket dan menjaga koneksi tetap aktif melalui proxy/firewall
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (!this.wss) return;
      this.wss.clients.forEach((client) => {
        const ws = client as any;
        if (ws.isAlive === false) {
          console.log('[REALTIME WS] Memutus client idle / zombie yang tidak merespon heartbeat.');
          return ws.terminate();
        }
        ws.isAlive = false;
        try {
          ws.ping();
        } catch {}
      });
    }, 30000);

    console.log('[REALTIME HUB] WebSocket Gateway siap di endpoint /ws/cs');
  }

  // Registrasi SSE (Server-Sent Events) sebagai fallback
  public registerSSE(res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    this.sseClients.add(res);
    console.log(`[REALTIME SSE] Klien SSE terhubung. Total klien: ${this.sseClients.size}`);

    res.write(`data: ${JSON.stringify({ event: 'connected', timestamp: new Date().toISOString() })}\n\n`);

    res.on('close', () => {
      this.sseClients.delete(res);
      console.log(`[REALTIME SSE] Klien SSE terputus. Sisa klien: ${this.sseClients.size}`);
    });
  }

  public broadcast(event: RealtimeEventType, data: any) {
    const payload: RealtimeEventPayload = {
      event,
      timestamp: new Date().toISOString(),
      data
    };
    const jsonStr = JSON.stringify(payload);

    // 1. Broadcast ke semua koneksi WebSocket
    if (this.wss) {
      this.wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(jsonStr);
          } catch (err: any) {
            console.warn('[WS SEND ERROR]', err.message);
          }
        }
      });
    }

    // 2. Broadcast ke semua klien SSE
    for (const res of this.sseClients) {
      try {
        res.write(`data: ${jsonStr}\n\n`);
      } catch (err) {
        this.sseClients.delete(res);
      }
    }
  }

  public getConnectedClientsCount(): number {
    const wsCount = this.wss ? Array.from(this.wss.clients).filter(c => c.readyState === WebSocket.OPEN).length : 0;
    return wsCount + this.sseClients.size;
  }
}

export const realtimeHub = new RealtimeHub();
