import type { Database } from 'better-sqlite3';
import type { BoardRow, NewBoard } from './types.js';

export function upsertBoard(db: Database, b: NewBoard): number {
  db.prepare(
    `INSERT INTO company_boards (ats_platform, board_token, company_name, discovered_via, discovered_at, active)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(ats_platform, board_token) DO UPDATE SET company_name = excluded.company_name, active = 1`,
  ).run(b.atsPlatform, b.boardToken, b.companyName, b.discoveredVia, new Date().toISOString());

  const row = db.prepare('SELECT id FROM company_boards WHERE ats_platform = ? AND board_token = ?')
    .get(b.atsPlatform, b.boardToken) as { id: number };
  return row.id;
}

export function listActiveBoards(db: Database): BoardRow[] {
  return db.prepare('SELECT * FROM company_boards WHERE active = 1 ORDER BY id').all() as BoardRow[];
}

export function boardExists(db: Database, ats: string, token: string): boolean {
  return !!db.prepare('SELECT 1 FROM company_boards WHERE ats_platform = ? AND board_token = ?').get(ats, token);
}

export function markBoardPolled(db: Database, id: number): void {
  db.prepare('UPDATE company_boards SET last_polled_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

export function deactivateBoard(db: Database, id: number): void {
  db.prepare('UPDATE company_boards SET active = 0 WHERE id = ?').run(id);
}
