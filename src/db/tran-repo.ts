import { tick } from '../sync/clock';
import { requireAmount, requireDate, requireId } from '../utils/validation';
import { nextYearMonth } from '../utils/date';
import { getDatabase } from './database';
import { stampWrite, recordTombstonesAt } from '../sync/stamp';
import { bumpDirty } from '../sync/dirty';
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
    'SELECT id, date, type, value, cat, note FROM tran WHERE date >= ? AND date < ? ORDER BY date DESC, id DESC',
    [yearMonth + '-01', nextYearMonth(yearMonth) + '-01']
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
  requireDate(date, 'transaction.date'); requireAmount(value, 'transaction.value');
  if (value <= 0 || !['INCOME', 'OUTLAY'].includes(type)) throw new Error('Invalid transaction');
  const db = await getDatabase();
  const { uuid, updatedAt } = await stampWrite(db, { withUuid: true });
  const result = await db.runAsync(
    'INSERT INTO tran (date, type, value, cat, note, uuid, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [date, type, value, cat, note, uuid, updatedAt]
  );
  bumpDirty();
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
  requireId(id, 'transaction.id'); requireDate(date, 'transaction.date'); requireAmount(value, 'transaction.value');
  if (value <= 0 || !['INCOME', 'OUTLAY'].includes(type)) throw new Error('Invalid transaction');
  const db = await getDatabase();
  const { updatedAt } = await stampWrite(db, { withUuid: false });
  await db.runAsync(
    'UPDATE tran SET date = ?, type = ?, value = ?, cat = ?, note = ?, updated_at = ? WHERE id = ?',
    [date, type, value, cat, note, updatedAt, id]
  );
  bumpDirty();
}

export async function deleteTransaction(id: number): Promise<void> {
  const db = await getDatabase();
  const deletedAt = await tick();
  await db.withTransactionAsync(async (db) => {
    const tran = await db.getFirstAsync<{ uuid: string }>(
      'SELECT uuid FROM tran WHERE id = ?',
      [id]
    );
    await db.runAsync('DELETE FROM tran WHERE id = ?', [id]);
    if (tran?.uuid) {
      await recordTombstonesAt(db, 'tran', [tran.uuid], deletedAt);
    }
  });
  bumpDirty();
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
    WHERE date >= ? AND date < ?`,
    [yearMonth + '-01', nextYearMonth(yearMonth) + '-01']
  );
  return {
    income: row?.income ?? 0,
    outlay: row?.outlay ?? 0,
  };
}
