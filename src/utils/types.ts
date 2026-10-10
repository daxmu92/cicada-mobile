export type Account = {
  id: number;
  name: string;
  archived: boolean;
};

export type Asset = {
  id: number;
  uuid?:string;
  accountId: number;
  name: string;
  categories: Record<string, string>;
  archived: boolean;
};

export type AssetWithAccount = Asset & {
  accountName: string;
};

export type AssetSnapshot = {
  assetId: number;
  date: string;
  netWorth: number;
  inflow: number;
  profit: number;
};

export type SnapshotWithAsset = AssetSnapshot & {
  accountName: string;
  assetName: string;
  estimated?: boolean;
  sourceDate?: string;
};

export type TranType = 'INCOME' | 'OUTLAY';

export type Transaction = {
  id: number;
  uuid?:string;
  date: string;
  type: TranType;
  value: number;
  cat: string;
  note: string;
};
