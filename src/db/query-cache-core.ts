/** Share settled and in-flight reads only while the initiating ledger revision matches. */
export function createQueryCache(token:()=>string,limit=128){
 let revision='';const entries=new Map<string,Promise<unknown>>();
 return <T>(key:unknown[],read:()=>Promise<T>):Promise<T>=>{
  const current=token();if(current!==revision){entries.clear();revision=current;}
  const id=JSON.stringify(key);const existing=entries.get(id);if(existing)return existing as Promise<T>;
  let pending:Promise<T>;
  try{pending=read();}catch(error){return Promise.reject(error);}
  entries.set(id,pending);
  if(entries.size>limit)entries.delete(entries.keys().next().value!);
  void pending.catch(()=>{if(entries.get(id)===pending)entries.delete(id);});
  return pending;
 };
}
