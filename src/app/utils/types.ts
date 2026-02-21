export type Side = 'ATTACKER' | 'DEFENDER';
export type Piece = 'A' | 'D' | 'K';

export interface Pos {
  row: number;
  col: number;
}

export interface TablutMove {
  from: Pos;
  to: Pos;
  capturesPreview: Pos[];
}

export interface MoveRecord {
  turn: number;
  side: Side;
  from: Pos;
  to: Pos;
  captures: Pos[];
  capturedPieces: Piece[];
}

export interface TablutState {
  __typename: 'TablutState';
  id: string;
  version: number;
  phase: 'IN_PROGRESS' | 'GAME_OVER';
  sideToMove: Side;
  board: Array<Piece | null>;
  kingHasLeftThrone: boolean;
  humanSide: Side;
  botSide: Side;
  players: {
    ATTACKER: { side: 'ATTACKER'; isHuman: boolean };
    DEFENDER: { side: 'DEFENDER'; isHuman: boolean };
  };
  winnerSide: Side | null;
  difficulty: 2 | 4;
  legalMoves: TablutMove[];
  moveHistory: MoveRecord[];
}
