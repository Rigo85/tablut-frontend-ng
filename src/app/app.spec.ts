import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { App } from './app';
import { TablutSocketService } from './services/tablut-socket.service';

class TablutSocketServiceMock {
  join = async () => ({}) as any;
  gameNew = async () => ({}) as any;
  changeDifficulty = async () => ({}) as any;
  playMove = async () => ({}) as any;
  onState = () => of();
  onMoveResult = () => of();
  onTurnNote = () => of();
  onGameOver = () => of();
}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: TablutSocketService, useClass: TablutSocketServiceMock }]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
