// Runs the shipped provider, scheduler and sync engine over actual HTTPS to
// WsgiDAV. No personal credentials, OS trust-store changes or app databases.
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { makeMigratedDb } from '../src/sync/test-support/sqlite';
import { serializeDatabase } from '../src/db/serialized-db';
import { createWebDavRemote } from '../src/sync/providers/webdav';
import { AuthError, ConflictError, type HttpClient } from '../src/sync/providers/types';
import { runSync } from '../src/sync/sync';
import { createScheduler } from '../src/sync/scheduler';
import { advanceLocal, encodeHlc, parseHlc, receive } from '../src/sync/hlc';
import { buildDocument } from '../src/sync/document';

async function main() {
  const python = process.env.CICADA_DAV_PYTHON ?? 'python3';
  execFileSync(python, ['-c', 'import wsgidav, cheroot'], { stdio: 'pipe' });
  const scratch = mkdtempSync(path.join(tmpdir(), 'cicada-dav-'));
  const root = path.join(scratch, 'dav'); mkdirSync(root);
  const cert = path.join(scratch, 'cert.pem'); const key = path.join(scratch, 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', key, '-out', cert, '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'pipe' });
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const username = 'acceptance'; const password = randomBytes(24).toString('hex');
  const configPath = path.join(scratch, 'server.json');
  writeFileSync(configPath, JSON.stringify({ root, cert, key, port, username, password }), { mode: 0o600 });
  const agent = new https.Agent({ ca: readFileSync(cert), keepAlive: false });
  let server: ChildProcess | null = null;
  let serverError = '';
  const http: HttpClient = (url, init) => new Promise((resolve, reject) => {
    const request = https.request(url, { agent, method: init.method, headers: init.headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode!,
        headers: { get: (name) => {
          const value = response.headers[name.toLowerCase()];
          return Array.isArray(value) ? value.join(', ') : value ?? null;
        } }, text: async () => Buffer.concat(chunks).toString('utf8') }));
    });
    request.setTimeout(5000, () => request.destroy(new Error('HTTPS test timed out')));
    request.on('error', reject); request.end(init.body);
  });
  const config = { baseUrl: `https://127.0.0.1:${port}/`, username, appPassword: password, filePath: 'cicada/acceptance.json' };
  const remote = createWebDavRemote(config, http);
  async function stopServer() {
    if (!server) return;
    const process = server; server = null;
    if (process.exitCode === null && process.signalCode === null) {
      const exited = once(process, 'exit'); process.kill(); await exited;
    }
  }
  async function startServer() {
    serverError = '';
    server = spawn(python, [fileURLToPath(new NodeURL('./fixtures/webdav-server.py', import.meta.url)), configPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    server.on('error', (error) => { serverError = error.message; });
    server.stderr?.on('data', (chunk) => { serverError += String(chunk); });
    for (let attempt = 0; attempt < 60; attempt++) {
      if (server.exitCode !== null || serverError.includes('Traceback')) throw new Error('WebDAV fixture failed to start');
      try { await remote.testConnection(); return; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    throw new Error('WebDAV fixture readiness timed out');
  }
  async function device(id: string) {
    const memory = await makeMigratedDb(); const db = serializeDatabase(memory.db);
    let clock = { phys: 0, counter: 0 };
    const tick = () => { clock = advanceLocal(clock, Date.now()); return encodeHlc(clock.phys, clock.counter, id); };
    let syncRemote = remote;
    const sync = (target = syncRemote) => runSync({ db, remote: target, deviceId: id, now: Date.now,
      getState: async (key) => (await db.getFirstAsync<{ value: string }>('SELECT value FROM sync_state WHERE key=?', [key]))?.value ?? null,
      setState: async (key, value) => { await db.runAsync('INSERT INTO sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key,value]); },
      receiveRemote: async (stamp) => { const parsed = parseHlc(stamp); clock = receive(clock, parsed, Date.now()); } });
    const scheduler = createScheduler({ execute: async () => { await sync(); }, now: Date.now,
      schedule: (ms, fn) => setTimeout(fn, ms), cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
      debounceMs: 60000, ceilingMs: 60000, periodicMs: 60000 });
    const add = async (uuid: string, value: number) => {
      await db.runAsync('INSERT INTO tran(date,type,value,cat,note,uuid,updated_at) VALUES(?,?,?,?,?,?,?)', ['2026-10-09','INCOME',value,'','synthetic acceptance',uuid,tick()]);
      scheduler.markDirty();
    };
    return { ...memory, db, tick, sync, scheduler, add, useRemote: (target: typeof remote) => { syncRemote = target; } };
  }
  const A = await device('aaaaaa'); const B = await device('bbbbbb');
  const domain = async (d: typeof A) => {
    const doc = await buildDocument(d.db, { generatedBy: 'comparison', generatedAt: 'comparison' });
    for (const rows of Object.values(doc.tables)) rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    doc.tombstones.sort((a,b) => a.uuid.localeCompare(b.uuid)); return doc;
  };
  try {
    await startServer();
    await assert.rejects(new Promise((resolve, reject) => {
      const request = https.get(config.baseUrl, { agent: false, rejectUnauthorized: true }, (response) => {
        response.resume(); resolve(response.statusCode);
      });
      request.on('error', reject);
    }), /self-signed certificate/);
    await assert.rejects(createWebDavRemote({ ...config, appPassword: 'wrong' }, http).testConnection(), AuthError);
    console.log('PASS real HTTPS certificate validation / Basic authentication');
    await A.add('a-transaction', 123.45); await A.scheduler.requestSync('manual');
    assert.equal(A.scheduler.isDirty(), false);
    await B.sync(); assert.deepEqual(await domain(A), await domain(B));
    console.log('PASS first-device seed / second-device download and convergence');

    const first = await remote.read(); assert.ok(first && first !== 'not-modified' && first.etag);
    assert.equal(await remote.read({ifNoneMatch:first.etag}), 'not-modified');
    await assert.rejects(remote.write(first.content,{kind:'ifNoneMatch'}), ConflictError);
    await assert.rejects(remote.write(first.content,{kind:'ifMatch',etag:'"stale"'}), ConflictError);
    console.log('PASS real 304 / create-only 412 / stale ETag 412');

    await stopServer();
    await A.add('a-offline', 234.56); await B.add('b-offline', 345.67);
    await A.scheduler.requestSync('manual'); await B.scheduler.requestSync('manual');
    assert.ok(A.scheduler.isDirty() && B.scheduler.isDirty());
    await startServer();
    await A.scheduler.requestSync('manual'); await B.scheduler.requestSync('manual'); await A.scheduler.requestSync('manual');
    assert.deepEqual(await domain(A), await domain(B));
    assert.equal((await A.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM tran'))?.n,3);
    assert.ok(!A.scheduler.isDirty() && !B.scheduler.isDirty());
    console.log('PASS actual server outage / dirty retention / two-device offline edits and recovery');

    await A.add('a-conflict', 456.78);
    let raced = false; let conflicts = 0;
    await A.sync({ ...remote, write: async (content, pre) => {
      if (pre.kind === 'ifMatch' && !raced) {
        raced = true; await B.add('b-conflict', 567.89); await B.sync();
      }
      try { return await remote.write(content, pre); }
      catch (error) { if (error instanceof ConflictError) conflicts++; throw error; }
    } });
    await B.sync(); assert.equal(conflicts,1); assert.deepEqual(await domain(A),await domain(B));
    console.log('PASS real competing-device 412 / engine retry preserves both edits');

    await A.add('a-before-upload', 678.90);
    let edited = false;
    A.useRemote({ ...remote, write: async (content, pre) => {
      if (!edited) { edited = true; await A.add('a-during-upload',789.01); }
      return remote.write(content,pre);
    } });
    await A.scheduler.requestSync('manual'); assert.ok(A.scheduler.isDirty());
    const uploading = await remote.read(); assert.ok(uploading && uploading !== 'not-modified');
    assert.ok(!uploading.content.includes('a-during-upload'));
    A.useRemote(remote); await A.scheduler.requestSync('manual'); await B.sync();
    assert.equal(A.scheduler.isDirty(),false); assert.deepEqual(await domain(A),await domain(B));
    console.log('PASS edits during actual HTTPS upload remain dirty and reach the other device');


    const deletedAt = A.tick();
    await A.db.withTransactionAsync(async (db) => {
      await db.runAsync('INSERT INTO tombstone(entity,uuid,deleted_at) VALUES(?,?,?)',['tran','a-transaction',deletedAt]);
      await db.runAsync('DELETE FROM tran WHERE uuid=?',['a-transaction']);
    });
    A.scheduler.markDirty(); await A.scheduler.requestSync('manual'); await B.sync();
    assert.deepEqual(await domain(A), await domain(B));
    assert.equal(await B.db.getFirstAsync('SELECT uuid FROM tran WHERE uuid=?',['a-transaction']),null);
    await B.sync(); assert.equal(await B.db.getFirstAsync('SELECT uuid FROM tran WHERE uuid=?',['a-transaction']),null);
    console.log('PASS delete propagation and repeat-sync idempotence');

    const good = await remote.read(); assert.ok(good && good !== 'not-modified');
    const before = await domain(B);
    await remote.write('{"syncFormatVersion":1,"tables":{"tran":[{"value":"invalid"}]}}',{kind:'none'});
    await assert.rejects(B.sync()); assert.deepEqual(await domain(B),before);
    await remote.write(good.content,{kind:'none'});
    console.log('PASS corrupt remote rejected without changing the local ledger');
  } finally {
    A.scheduler.stop(); B.scheduler.stop(); A.raw.close(); B.raw.close();
    await stopServer(); agent.destroy(); rmSync(scratch, {recursive:true,force:true});
  }

}
main().catch((error) => { console.error('FAIL local HTTPS WebDAV acceptance:', error instanceof Error ? error.message : 'unknown failure'); process.exitCode = 1; });
