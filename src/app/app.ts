import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TablutSocketService } from './services/tablut-socket.service';
import { Pos, Side, TablutState } from './utils/types';

const LS_KEY = 'tablut:gameId';

function readIdFromUrl(): string | null {
  const qs = new URLSearchParams(window.location.search);
  const g = qs.get('g');
  return g && g.trim() ? g.trim() : null;
}

function writeIdToUrl(id: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('g', id);
  history.replaceState(null, '', url.toString());
}

function readGameIdFromLocalStorage(): string | null {
  try {
    const id = localStorage.getItem(LS_KEY);
    return id && id.trim() ? id : null;
  } catch {
    return null;
  }
}

function writeGameIdToLocalStorage(id: string): void {
  try {
    localStorage.setItem(LS_KEY, id);
  } catch {
    // noop
  }
}

@Component({
  selector: 'app-root',
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  state = signal<TablutState | null>(null);
  loading = signal<boolean>(false);
  message = signal<string>('');
  logs = signal<string[]>([]);

  setupOpen = signal<boolean>(false);
  setupSubmitting = signal<boolean>(false);
  setupHumanSide = signal<Side>('DEFENDER');
  setupDifficulty = signal<2 | 4>(4);

  selectedFrom = signal<Pos | null>(null);
  private currentStateGameId: string | null = null;
  private pendingNewGameWithBotOpening = false;

  rows = Array.from({ length: 9 }, (_, i) => i);
  cols = Array.from({ length: 9 }, (_, i) => i);

  turnLabel = computed(() => {
    const st = this.state();
    if (!st) return '-';
    return st.sideToMove === 'ATTACKER' ? 'Atacante' : 'Defensor';
  });

  humanTurn = computed(() => {
    const st = this.state();
    return !!st && st.sideToMove === st.humanSide && st.phase === 'IN_PROGRESS';
  });

  selectedTargets = computed(() => {
    const st = this.state();
    const from = this.selectedFrom();
    if (!st || !from) return [] as Pos[];
    return st.legalMoves.filter((m) => m.from.row === from.row && m.from.col === from.col).map((m) => m.to);
  });

  constructor(private ws: TablutSocketService, private destroyRef: DestroyRef) {
    this.ws.onState().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((st) => {
      const gameChanged = this.currentStateGameId !== st.id;
      this.currentStateGameId = st.id;

      this.state.set(st);
      this.message.set('');
      this.selectedFrom.set(null);
      writeIdToUrl(st.id);
      writeGameIdToLocalStorage(st.id);

      if (gameChanged) {
        this.logs.set(this.buildLogsFromHistory(st));
      }

      if (this.pendingNewGameWithBotOpening) {
        const botAlreadyOpened = st.humanSide === 'DEFENDER' && st.moveHistory.length > 0;
        if (botAlreadyOpened) {
          this.pendingNewGameWithBotOpening = false;
          this.loading.set(false);
          this.setupSubmitting.set(false);
        } else {
          this.loading.set(true);
        }
      } else {
        this.loading.set(false);
        this.setupSubmitting.set(false);
      }

      if (this.setupOpen()) this.setupOpen.set(false);
    });

    this.ws.onMoveResult().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((mv) => {
      const side = mv.side === 'ATTACKER' ? 'Atacante' : 'Defensor';
      const c = mv.captures.length;
      this.pushLog(`${side}: (${mv.from.row},${mv.from.col}) -> (${mv.to.row},${mv.to.col})${c ? ` x${c}` : ''}`);
    });

    this.ws.onTurnNote().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ message }) => {
      this.pushLog(message);
    });

    this.ws.onBotThinking().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ active }) => {
      if (this.pendingNewGameWithBotOpening) {
        this.loading.set(active);
        if (!active) {
          this.pendingNewGameWithBotOpening = false;
          this.setupSubmitting.set(false);
        }
      }
    });

    this.ws.onGameOver().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ winnerSide }) => {
      const label = winnerSide === 'ATTACKER' ? 'Atacante' : 'Defensor';
      this.pushLog(`Fin de partida. Ganador: ${label}`);
      this.message.set(`Juego terminado. Ganador: ${label}`);
    });

    void this.bootstrapGame();
  }

  private async runAction(action: () => Promise<void>, errorMessage: string): Promise<void> {
    this.loading.set(true);
    try {
      await action();
    } catch (err: any) {
      const friendly = this.toFriendlyError(err?.message);
      this.message.set(friendly ? `${errorMessage}. ${friendly}` : errorMessage);
      this.loading.set(false);
    }
  }

  private async bootstrapGame(): Promise<void> {
    this.loading.set(true);
    this.message.set('Cargando partida...');

    const fromUrl = readIdFromUrl();
    const fromStorage = readGameIdFromLocalStorage();
    const gameId = fromUrl ?? fromStorage;

    if (gameId) {
      await this.runAction(async () => {
        await this.ws.join(gameId);
      }, 'No se pudo cargar la partida');
      return;
    }

    this.loading.set(false);
    this.message.set('');
    this.setupOpen.set(true);
  }

  async startNewGame(): Promise<void> {
    const humanSide = this.setupHumanSide();
    const botStarts = humanSide === 'DEFENDER';

    this.pendingNewGameWithBotOpening = botStarts;
    this.setupSubmitting.set(botStarts);
    this.loading.set(botStarts);
    this.message.set('');
    this.logs.set([]);
    this.selectedFrom.set(null);
    this.state.set(null);
    this.currentStateGameId = null;
    this.setupOpen.set(false);

    try {
      await this.ws.gameNew(humanSide, this.setupDifficulty());
      if (!botStarts) {
        this.loading.set(false);
        this.setupSubmitting.set(false);
      }
    } catch (err: any) {
      const friendly = this.toFriendlyError(err?.message);
      this.message.set(friendly ? `No se pudo crear la partida. ${friendly}` : 'No se pudo crear la partida');
      this.pendingNewGameWithBotOpening = false;
      this.loading.set(false);
      this.setupSubmitting.set(false);
      this.setupOpen.set(true);
    }
  }

  async onNewGameClick(): Promise<void> {
    this.setupOpen.set(true);
  }

  async onDifficultyChange(next: 2 | 4): Promise<void> {
    this.setupDifficulty.set(next);
    const st = this.state();
    if (!st) return;

    await this.runAction(async () => {
      await this.ws.changeDifficulty(st.id, next);
    }, 'No se pudo cambiar dificultad');
  }

  onSelectHumanSide(side: Side): void {
    this.setupHumanSide.set(side);
  }

  pieceAt(row: number, col: number): 'A' | 'D' | 'K' | null {
    const st = this.state();
    if (!st) return null;
    return st.board[row * 9 + col] ?? null;
  }

  isEdge(row: number, col: number): boolean {
    return row === 0 || row === 8 || col === 0 || col === 8;
  }

  isThrone(row: number, col: number): boolean {
    return row === 4 && col === 4;
  }

  isSelected(row: number, col: number): boolean {
    const from = this.selectedFrom();
    return !!from && from.row === row && from.col === col;
  }

  isTarget(row: number, col: number): boolean {
    return this.selectedTargets().some((p) => p.row === row && p.col === col);
  }

  cellLabel(row: number, col: number): string {
    const p = this.pieceAt(row, col);
    if (!p) return '';
    if (p === 'K') return 'R';
    return p;
  }

  cellPieceClass(row: number, col: number): string {
    const p = this.pieceAt(row, col);
    if (p === 'A') return 'piece piece-attacker';
    if (p === 'D') return 'piece piece-defender';
    if (p === 'K') return 'piece piece-king';
    return '';
  }

  async onCellClick(row: number, col: number): Promise<void> {
    const st = this.state();
    if (!st || !this.humanTurn()) return;

    const clicked: Pos = { row, col };
    const piece = this.pieceAt(row, col);
    const from = this.selectedFrom();

    if (!from) {
      if (this.isHumanPiece(piece, st.humanSide) && this.hasMoveFrom(clicked)) {
        this.selectedFrom.set(clicked);
      }
      return;
    }

    if (from.row === row && from.col === col) {
      this.selectedFrom.set(null);
      return;
    }

    const target = this.selectedTargets().some((p) => p.row === row && p.col === col);
    if (target) {
      this.selectedFrom.set(null);
      await this.runAction(async () => {
        await this.ws.playMove(st.id, from, clicked);
      }, 'No se pudo jugar el movimiento');
      return;
    }

    if (this.isHumanPiece(piece, st.humanSide) && this.hasMoveFrom(clicked)) {
      this.selectedFrom.set(clicked);
      return;
    }

    this.selectedFrom.set(null);
  }

  private isHumanPiece(piece: 'A' | 'D' | 'K' | null, humanSide: Side): boolean {
    if (!piece) return false;
    if (humanSide === 'ATTACKER') return piece === 'A';
    return piece === 'D' || piece === 'K';
  }

  private hasMoveFrom(pos: Pos): boolean {
    const st = this.state();
    if (!st) return false;
    return st.legalMoves.some((m) => m.from.row === pos.row && m.from.col === pos.col);
  }

  trackByCell = (_: number, col: number): number => col;

  private pushLog(msg: string): void {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    this.logs.update((items) => [`[${hh}:${mm}:${ss}] ${msg}`, ...items].slice(0, 40));
  }

  private toFriendlyError(raw: unknown): string | null {
    const msg = typeof raw === 'string' ? raw : '';
    if (!msg) return null;
    if (msg.startsWith('ack_timeout:')) {
      return 'La jugada está tardando más de lo esperado. Intenta de nuevo en unos segundos.';
    }
    if (msg === 'socket_connect_timeout' || msg === 'socket_not_connected') {
      return 'No se pudo conectar al servidor de juego.';
    }
    if (msg === 'illegal_move') {
      return 'La jugada no es válida según el estado actual.';
    }
    return null;
  }

  private buildLogsFromHistory(st: TablutState): string[] {
    const lines: string[] = [];
    for (const mv of st.moveHistory) {
      const side = mv.side === 'ATTACKER' ? 'Atacante' : 'Defensor';
      const c = mv.captures.length;
      lines.push(`#${mv.turn} ${side}: (${mv.from.row},${mv.from.col}) -> (${mv.to.row},${mv.to.col})${c ? ` x${c}` : ''}`);
    }
    return lines.reverse().slice(0, 40);
  }
}
