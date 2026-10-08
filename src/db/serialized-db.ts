import type { CicadaDB, SqlParam } from './migrations';
import { createAsyncLock } from '../utils/async-lock';

type Driver = Omit<CicadaDB, 'withTransactionAsync'> & {
  withTransactionAsync(task: (tx: CicadaDB) => Promise<void>): Promise<void>;
};

/** Callbacks use the scoped connection; unrelated queries wait until commit. */
export function serializeDatabase(driver: Driver): CicadaDB {
  const lock = createAsyncLock();
  return {
    getAllAsync: (sql, params) => lock.run(() => driver.getAllAsync(sql, params)),
    getFirstAsync: (sql, params) => lock.run(() => driver.getFirstAsync(sql, params)),
    runAsync: (sql, params) => lock.run(() => driver.runAsync(sql, params)),
    execAsync: (sql) => lock.run(() => driver.execAsync(sql)),
    withTransactionAsync: (task) => lock.run(() => driver.withTransactionAsync(task)),
  };
}

/** expo-sqlite uses one connection; expose it only to the active callback. */
export function serializeExpoDatabase(raw: {
  getAllAsync<T>(sql: string, params: SqlParam[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: SqlParam[]): Promise<T | null>;
  runAsync(sql: string, params: SqlParam[]): Promise<{ lastInsertRowId: number; changes: number }>;
  execAsync(sql: string): Promise<void>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}): CicadaDB {
  const scoped: CicadaDB = {
    getAllAsync: (sql, params) => raw.getAllAsync(sql, params ?? []),
    getFirstAsync: (sql, params) => raw.getFirstAsync(sql, params ?? []),
    runAsync: (sql, params) => raw.runAsync(sql, params ?? []),
    execAsync: (sql) => raw.execAsync(sql),
    withTransactionAsync: (task) => task(scoped),
  };
  return serializeDatabase({
    ...scoped,
    withTransactionAsync: (task) => raw.withTransactionAsync(() => task(scoped)),
  });
}
