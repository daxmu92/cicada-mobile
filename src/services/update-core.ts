export type UpdatePackage={download:()=>Promise<void>;install:()=>Promise<void>};
/** Recheck after download and after waiting for database/sync work. */
export async function installVerifiedUpdate(update:UpdatePackage,deps:{hasDrafts:()=>boolean;confirm:()=>Promise<boolean>;exclusive:<T>(task:()=>Promise<T>)=>Promise<T>;restart:()=>Promise<void>}) {
  if(deps.hasDrafts()) throw new Error('UNSAVED_DRAFT');
  if(!await deps.confirm()) return false;
  await update.download();
  await deps.exclusive(async()=>{
    if(deps.hasDrafts()) throw new Error('UNSAVED_DRAFT');
    await update.install();
    await deps.restart();
  });
  return true;
}
