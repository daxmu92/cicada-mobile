// Live 坚果云 (Nutstore) WebDAV round-trip test for the real sync provider.
//
// Runs the ACTUAL shipped provider code (src/sync/providers/webdav.ts) against
// a real WebDAV server, using Node's global fetch as the injected HttpClient —
// the same logic the app runs, minus the thin platform http shim.
//
// Credentials are read from .webdav-test.local.json (gitignored). The app
// password is NEVER printed. Uses a dedicated TEST file path so it cannot
// clobber a real cicada-sync.json.
//
// Run:  npx tsx scripts/test-webdav.ts

import { readFileSync } from 'node:fs';
import { createWebDavRemote, type WebDavConfig } from '../src/sync/providers/webdav';
import { ConflictError } from '../src/sync/providers/types';

const CREDS_FILE = '.webdav-test.local.json';

function loadCreds(): WebDavConfig {
  let raw: string;
  try {
    raw = readFileSync(CREDS_FILE, 'utf8');
  } catch {
    console.error(`✗ 找不到 ${CREDS_FILE} —— 请先填好凭据`);
    process.exit(1);
  }
  const c = JSON.parse(raw) as WebDavConfig;
  if (!c.username || c.username.includes('你的') || !c.appPassword || c.appPassword.includes('应用密码')) {
    console.error(`✗ ${CREDS_FILE} 还是模板占位符 —— 请填入真实的坚果云邮箱和应用密码`);
    process.exit(1);
  }
  return c;
}

function mask(s: string): string {
  if (s.length <= 4) return '****';
  return s.slice(0, 2) + '***' + s.slice(-2);
}

async function main() {
  const creds = loadCreds();
  // dedicated test path so we never touch a real sync file
  const config: WebDavConfig = { ...creds, filePath: 'cicada/cicada-sync-TEST.json' };
  console.log(`连接 ${config.baseUrl}  用户 ${mask(config.username)}  文件 ${config.filePath}\n`);

  const remote = createWebDavRemote(config, (url, init) => fetch(url, init) as any);

  // 1) 认证 / 连通
  try {
    await remote.testConnection();
    console.log('✓ testConnection 成功(认证 + PROPFIND 通过)');
  } catch (e: any) {
    console.error('✗ testConnection 失败:', e.message);
    console.error('  → 检查邮箱 / 应用密码是否正确(坚果云用的是「应用密码」,不是登录密码)');
    process.exit(1);
  }

  // 2) 首次写入用 ifNoneMatch(create-only)—— 这是 app 真实的首写路径,
  //    provider 只在此路径 MKCOL 建父目录。两种结果都说明目录就绪:
  //    成功 = 文件原本不存在,现已新建;412 = 文件已存在(顺带证明 If-None-Match 被支持)。
  const payload1 = JSON.stringify({ test: 'cicada', n: 1 });
  try {
    const w0 = await remote.write(payload1, { kind: 'ifNoneMatch' });
    console.log(`✓ write(ifNoneMatch) 新建成功(并 MKCOL 了目录),etag = ${w0.etag ?? '(无)'}`);
  } catch (e: any) {
    if (e instanceof ConflictError) {
      console.log('✓ write(ifNoneMatch) → 412:文件已存在(目录就绪;If-None-Match 后面再确证)');
    } else {
      throw e;
    }
  }

  // 用一次无条件写入设置已知内容(目录此刻已存在,none 写入应当成功)
  const w1 = await remote.write(payload1, { kind: 'none' });
  console.log(`✓ write(none) 覆盖成功,etag = ${w1.etag ?? '(无 ETag 头)'}`);

  // 3) 读回
  const r1raw = await remote.read();
  if (!r1raw || r1raw === 'not-modified') {
    console.error('✗ read() 返回 null,但刚写过 —— 异常');
    process.exit(1);
  }
  const r1 = r1raw;
  const contentMatches = r1.content === payload1;
  console.log(`✓ read() 成功,内容${contentMatches ? '一致' : '不一致(!)'},etag = ${r1.etag ?? '(无 ETag 头)'}`);

  // 4) If-Match —— 用正确的 etag 应当成功
  let ifMatchSupported: 'honored' | 'ignored' | 'no-etag' = 'no-etag';
  if (r1.etag) {
    const payload2 = JSON.stringify({ test: 'cicada', n: 2 });
    try {
      const w2 = await remote.write(payload2, { kind: 'ifMatch', etag: r1.etag });
      console.log(`✓ write(ifMatch, 正确 etag) 成功,etag = ${w2.etag ?? '(无)'}`);
    } catch (e: any) {
      console.log(`⚠ write(ifMatch, 正确 etag) 抛错: ${e.message}(服务器可能用了弱/带引号 etag,需注意)`);
    }

    // 5) If-Match —— 用过期/错误的 etag 应当 412
    try {
      await remote.write(JSON.stringify({ test: 'cicada', n: 3 }), {
        kind: 'ifMatch',
        etag: '"definitely-stale-wrong-etag"',
      });
      ifMatchSupported = 'ignored';
      console.log('⚠ write(ifMatch, 错误 etag) 竟然成功 → 坚果云【忽略】If-Match(乐观锁无效)');
    } catch (e: any) {
      if (e instanceof ConflictError) {
        ifMatchSupported = 'honored';
        console.log('✓ write(ifMatch, 错误 etag) → 412 ConflictError → 坚果云【支持】If-Match 乐观锁');
      } else {
        console.log(`? write(ifMatch, 错误 etag) 抛了非 412 错误: ${e.message}`);
      }
    }
  } else {
    console.log('⚠ read() 没拿到 ETag 头 → 无法测 If-Match(坚果云可能不在 GET/PUT 回 ETag)');
  }

  // 6) If-None-Match —— 文件已存在时应当 412
  let ifNoneMatchSupported: 'honored' | 'ignored' = 'ignored';
  try {
    await remote.write(JSON.stringify({ test: 'cicada', n: 4 }), { kind: 'ifNoneMatch' });
    console.log('⚠ write(ifNoneMatch, 文件已存在) 竟然成功 → 坚果云【忽略】If-None-Match');
  } catch (e: any) {
    if (e instanceof ConflictError) {
      ifNoneMatchSupported = 'honored';
      console.log('✓ write(ifNoneMatch, 文件已存在) → 412 → 坚果云【支持】If-None-Match');
    } else {
      console.log(`? write(ifNoneMatch) 抛了非 412 错误: ${e.message}`);
    }
  }

  console.log('\n===== 结论(影响 Phase 4 回退策略)=====');
  console.log(`ETag 是否返回 : ${r1.etag ? '是' : '否'}`);
  console.log(`If-Match 乐观锁 : ${ifMatchSupported === 'honored' ? '支持 ✅' : ifMatchSupported === 'ignored' ? '忽略 ❌(需 read-before-write + 重试回退)' : '无法判定(无 ETag)'}`);
  console.log(`If-None-Match  : ${ifNoneMatchSupported === 'honored' ? '支持 ✅' : '忽略 ❌'}`);
}

main().catch((e) => {
  console.error('未捕获错误:', e);
  process.exit(1);
});
