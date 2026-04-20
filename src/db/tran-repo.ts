import { getDatabase } from './database';
import type { Transaction, TranType } from '../utils/types';

type TranRow = {
  id: number;
  date: string;
  type: TranType;
  value: number;
  cat: string;
  note: string;
};

export async function getTransaction(id: number): Promise<Transaction | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<TranRow>(
    'SELECT id, date, type, value, cat, note FROM tran WHERE id = ?',
    [id]
  );
  return row ?? null;
}

export async function listTransactions(): Promise<Transaction[]> {
  const db = await getDatabase();
  return db.getAllAsync<TranRow>(
    'SELECT id, date, type, value, cat, note FROM tran ORDER BY date DESC, id DESC'
  );
}

export async function listTransactionsInMonth(yearMonth: string): Promise<Transaction[]> {
  const db = await getDatabase();
  return db.getAllAsync<TranRow>(
    "SELECT id, date, type, value, cat, note FROM tran WHERE substr(date, 1, 7) = ? ORDER BY date DESC, id DESC",
    [yearMonth]
  );
}

export async function listTransactionsInRange(
  startDate: string,
  endDate: string
): Promise<Transaction[]> {
  const db = await getDatabase();
  return db.getAllAsync<TranRow>(
    'SELECT id, date, type, value, cat, note FROM tran WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC',
    [startDate, endDate]
  );
}

export async function createTransaction(
  date: string,
  type: TranType,
  value: number,
  cat: string = '',
  note: string = ''
): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    'INSERT INTO tran (date, type, value, cat, note) VALUES (?, ?, ?, ?, ?)',
    [date, type, value, cat, note]
  );
  return result.lastInsertRowId;
}

export async function updateTransaction(
  id: number,
  date: string,
  type: TranType,
  value: number,
  cat: string,
  note: string
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE tran SET date = ?, type = ?, value = ?, cat = ?, note = ? WHERE id = ?',
    [date, type, value, cat, note, id]
  );
}

export async function deleteTransaction(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM tran WHERE id = ?', [id]);
}

export async function getAllTags(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ cat: string }>(
    "SELECT DISTINCT cat FROM tran WHERE cat != ''"
  );
  const tags = new Set<string>();
  for (const row of rows) {
    row.cat.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tags.add(t));
  }
  return Array.from(tags).sort();
}

export async function getIncomeOutlayTotalsForMonth(
  yearMonth: string
): Promise<{ income: number; outlay: number }> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ income: number | null; outlay: number | null }>(
    `SELECT
      SUM(CASE WHEN type = 'INCOME' THEN value ELSE 0 END) AS income,
      SUM(CASE WHEN type = 'OUTLAY' THEN value ELSE 0 END) AS outlay
    FROM tran
    WHERE substr(date, 1, 7) = ?`,
    [yearMonth]
  );
  return {
    income: row?.income ?? 0,
    outlay: row?.outlay ?? 0,
  };
}
