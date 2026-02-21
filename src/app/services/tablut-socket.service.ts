import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { Side, TablutState } from '../utils/types';

const CLIENT_SESSION_LS_KEY = 'tablut:clientSessionId';

function resolveBackendUrl(): string {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname || 'localhost';
  return `${protocol}//${hostname}:3009`;
}

function generateSessionId(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  return `sid_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function getClientSessionId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_SESSION_LS_KEY);
    if (existing && existing.trim()) return existing;
    const created = generateSessionId();
    localStorage.setItem(CLIENT_SESSION_LS_KEY, created);
    return created;
  } catch {
    return generateSessionId();
  }
}

@Injectable({ providedIn: 'root' })
export class TablutSocketService {
  private socket: Socket;
  private readonly ackTimeoutMs = 20000;
  private readonly connectTimeoutMs = 5000;

  constructor() {
    this.socket = io(`${resolveBackendUrl()}/game`, {
      transports: ['websocket'],
      auth: {
        clientSessionId: getClientSessionId(),
        platform: navigator.platform,
        language: navigator.language,
        screenWidth: screen.width,
        screenHeight: screen.height,
        colorDepth: screen.colorDepth,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket.connected) return;

    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('socket_connect_timeout'));
      }, this.connectTimeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        this.socket.off('connect', onConnect);
        this.socket.off('connect_error', onError);
      };

      this.socket.on('connect', onConnect);
      this.socket.on('connect_error', onError);
      this.socket.connect();
    });
  }

  emitAck<TReq, TRes>(event: string, payload: TReq): Promise<TRes> {
    return new Promise<TRes>(async (resolve, reject) => {
      try {
        await this.ensureConnected();
      } catch (err: any) {
        reject(new Error(err?.message ?? 'socket_not_connected'));
        return;
      }

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`ack_timeout:${event}`));
      }, this.ackTimeoutMs);

      this.socket.emit(event, payload, (resp: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (resp?.ok) {
          resolve(resp.data as TRes);
          return;
        }
        reject(new Error(resp?.error ?? 'error'));
      });
    });
  }

  join(gameId: string): Promise<TablutState> {
    return this.emitAck<{ gameId: string }, TablutState>('join', { gameId });
  }

  gameNew(humanSide: Side, difficulty: 2 | 4, gameId?: string): Promise<TablutState> {
    const payload: { gameId?: string; humanSide: Side; difficulty: 2 | 4 } = { humanSide, difficulty };
    if (gameId) payload.gameId = gameId;
    return this.emitAck<typeof payload, TablutState>('game:new', payload);
  }

  changeDifficulty(gameId: string, difficulty: 2 | 4): Promise<TablutState> {
    return this.emitAck('game:change:diff', { gameId, difficulty });
  }

  playMove(gameId: string, from: { row: number; col: number }, to: { row: number; col: number }): Promise<TablutState> {
    return this.emitAck('move:play', { gameId, from, to });
  }

  onState(): Observable<TablutState> {
    return new Observable<TablutState>((observer) => {
      const handler = (st: TablutState) => observer.next(st);
      this.socket.on('state', handler);
      return () => this.socket.off('state', handler);
    });
  }

  onGameOver(): Observable<{ winnerSide: Side }> {
    return new Observable<{ winnerSide: Side }>((observer) => {
      const handler = (payload: { winnerSide: Side }) => observer.next(payload);
      this.socket.on('game:over', handler);
      return () => this.socket.off('game:over', handler);
    });
  }

  onTurnNote(): Observable<{ message: string }> {
    return new Observable<{ message: string }>((observer) => {
      const handler = (payload: { message: string }) => observer.next(payload);
      this.socket.on('turn:note', handler);
      return () => this.socket.off('turn:note', handler);
    });
  }

  onMoveResult(): Observable<{ side: Side; from: { row: number; col: number }; to: { row: number; col: number }; captures: any[] }> {
    return new Observable((observer) => {
      const handler = (payload: { side: Side; from: { row: number; col: number }; to: { row: number; col: number }; captures: any[] }) => observer.next(payload);
      this.socket.on('move:result', handler);
      return () => this.socket.off('move:result', handler);
    });
  }

  onBotThinking(): Observable<{ active: boolean }> {
    return new Observable<{ active: boolean }>((observer) => {
      const handler = (payload: { active: boolean }) => observer.next(payload);
      this.socket.on('bot:thinking', handler);
      return () => this.socket.off('bot:thinking', handler);
    });
  }
}
