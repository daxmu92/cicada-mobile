import test from 'node:test';
import assert from 'node:assert/strict';
import {installVerifiedUpdate} from './update-core';
test('update consent, signature/download failure and late drafts cannot install',async()=>{
  let installs=0,downloads=0,restarts=0,dirty=false,accepted=false;
  const update={download:async()=>{downloads++;},install:async()=>{installs++;}};
  const deps={hasDrafts:()=>dirty,confirm:async()=>accepted,exclusive:async<T>(task:()=>Promise<T>)=>task(),restart:async()=>{restarts++;}};
  assert.equal(await installVerifiedUpdate(update,deps),false);assert.equal(downloads,0);
  accepted=true;dirty=true;await assert.rejects(installVerifiedUpdate(update,deps),/UNSAVED_DRAFT/);assert.equal(downloads,0);
  dirty=false;await assert.rejects(installVerifiedUpdate({...update,download:async()=>{throw new Error('invalid signature');}},deps),/invalid signature/);assert.equal(installs,0);
  await assert.rejects(installVerifiedUpdate(update,{...deps,exclusive:async<T>(task:()=>Promise<T>)=>{dirty=true;return task();}}),/UNSAVED_DRAFT/);assert.equal(installs,0);
  dirty=false;assert.equal(await installVerifiedUpdate(update,deps),true);assert.equal(installs,1);assert.equal(restarts,1);
});
