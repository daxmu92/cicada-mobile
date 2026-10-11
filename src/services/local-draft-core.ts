import type { CicadaDB } from '../db/migrations';
export type LocalDraft = {version:1;baseline:string;value:unknown;updatedAt:string};
export function parseLocalDraft(text:string):LocalDraft {
 const value=JSON.parse(text);
 if(!value||value.version!==1||typeof value.baseline!=='string'||typeof value.updatedAt!=='string'||!('value' in value))throw new Error('Invalid local draft');
 return value;
}
export async function readLocalDraft(db:CicadaDB,key:string):Promise<LocalDraft|null>{
 const row=await db.getFirstAsync<{content:string}>('SELECT content FROM local_draft WHERE key=?',[key]);
 return row?parseLocalDraft(row.content):null;
}
export async function saveLocalDraft(db:CicadaDB,key:string,baseline:string,value:unknown){
 const content:LocalDraft={version:1,baseline,value,updatedAt:new Date().toISOString()};
 await db.runAsync('INSERT INTO local_draft(key,content) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET content=excluded.content',[key,JSON.stringify(content)]);
}
export async function removeLocalDraft(db:CicadaDB,key:string){await db.runAsync('DELETE FROM local_draft WHERE key=?',[key]);}
export type DraftConsumption = {key:string;assetUuid?:string};
export async function consumeLocalDraft(db:CicadaDB,draft:DraftConsumption){
 if(!draft.assetUuid){await removeLocalDraft(db,draft.key);return;}
 const saved=await readLocalDraft(db,draft.key);
 if(!saved)return;
 if(!Array.isArray(saved.value))throw new Error('Invalid batch draft');
 const remaining=saved.value.filter(item=>item?.uuid!==draft.assetUuid);
 if(remaining.length)await saveLocalDraft(db,draft.key,saved.baseline,remaining);
 else await removeLocalDraft(db,draft.key);
}
export async function writeWithDraftConsumption<T>(db:CicadaDB,draft:DraftConsumption|undefined,write:(tx:CicadaDB)=>Promise<T>):Promise<T>{
 if(!draft)return write(db);
 let result!:T;
 await db.withTransactionAsync(async tx=>{result=await write(tx);await consumeLocalDraft(tx,draft);});
 return result;
}
