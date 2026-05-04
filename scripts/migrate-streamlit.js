#!/usr/bin/env node
/**
 * Migrate a CicadaFinScape Streamlit backup to our JSON format.
 *
 * Usage:
 *   node scripts/migrate-streamlit.js <path-to-unzipped-dir> [output-path]
 *
 * The input directory should contain config.json, asset.txt, flow.txt
 * (from a cfs-data-*.zip backup).
 *
 * The output JSON can then be imported via Settings → Import Data in the mobile app.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BACKUP_VERSION = 1;

function usage() {
  console.error('Usage: node scripts/migrate-streamlit.js <input> [output]');
  console.error('  <input>  Either a .zip file or an unzipped directory');
  console.error('  [output] Path to write JSON backup (default: ./cicada-backup.json)');
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (c === '\r') {
        // ignore
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function cleanNote(s) {
  if (!s) return '';
  const t = String(s).trim();
  if (t === 'nan' || t === 'NaN' || t === 'None') return '';
  return t;
}

function padDate(date) {
  // "YYYY-MM" → "YYYY-MM-01"; "YYYY-MM-DD" → unchanged
  if (/^\d{4}-\d{2}$/.test(date)) return `${date}-01`;
  return date;
}

function resolveInput(inputPath) {
  const stat = fs.statSync(inputPath);
  if (stat.isDirectory()) return inputPath;
  if (!inputPath.endsWith('.zip')) {
    throw new Error(`Input must be a directory or a .zip file: ${inputPath}`);
  }
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cfs-migrate-'));
  execSync(`unzip -o "${inputPath}" -d "${tmpDir}"`, { stdio: 'pipe' });
  return tmpDir;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) usage();

  const input = args[0];
  const output = args[1] || path.resolve(process.cwd(), 'cicada-backup.json');

  if (!fs.existsSync(input)) {
    console.error(`Input not found: ${input}`);
    process.exit(1);
  }

  const dir = resolveInput(input);
  const configPath = path.join(dir, 'config.json');
  const assetPath = path.join(dir, 'asset.txt');
  const flowPath = path.join(dir, 'flow.txt');

  for (const p of [configPath, assetPath, flowPath]) {
    if (!fs.existsSync(p)) {
      console.error(`Missing file: ${p}`);
      process.exit(1);
    }
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  // Assign synthetic IDs to accounts and assets
  const accountIds = new Map(); // name → id
  const accounts = [];
  for (const acc of config.Accounts ?? []) {
    const id = accounts.length + 1;
    accountIds.set(acc.Name, id);
    accounts.push({ id, name: acc.Name });
  }

  const assetIds = new Map(); // "ACCOUNT|NAME" → id
  const assets = [];
  for (const a of config.Assets ?? []) {
    const accountId = accountIds.get(a.Account);
    if (!accountId) {
      console.warn(`  ⚠ Asset "${a.Name}" references unknown account "${a.Account}" — skipping`);
      continue;
    }
    const id = assets.length + 1;
    assetIds.set(`${a.Account}|${a.Name}`, id);
    assets.push({
      id,
      accountId,
      name: a.Name,
      categories: JSON.stringify(a.Category ?? {}),
    });
  }

  // Parse asset snapshots CSV
  const assetRows = parseCsv(fs.readFileSync(assetPath, 'utf8')).filter((r) => r.some((v) => v.length > 0));
  const assetHeader = assetRows[0];
  const expectedAssetHeader = ['DATE', 'ACCOUNT', 'SUBACCOUNT', 'NET_WORTH', 'INFLOW', 'PROFIT'];
  if (JSON.stringify(assetHeader) !== JSON.stringify(expectedAssetHeader)) {
    console.error(`Unexpected asset.txt header: ${JSON.stringify(assetHeader)}`);
    process.exit(1);
  }

  const snapshots = [];
  let skippedSnapshots = 0;
  for (let i = 1; i < assetRows.length; i++) {
    const [date, account, subaccount, netWorth, inflow, profit] = assetRows[i];
    const key = `${account}|${subaccount}`;
    const assetId = assetIds.get(key);
    if (!assetId) {
      // Asset not in config — create it with default account
      let accountId = accountIds.get(account);
      if (!accountId) {
        accountId = accounts.length + 1;
        accountIds.set(account, accountId);
        accounts.push({ id: accountId, name: account });
      }
      const newAssetId = assets.length + 1;
      assetIds.set(key, newAssetId);
      assets.push({ id: newAssetId, accountId, name: subaccount, categories: '{}' });
      snapshots.push({
        assetId: newAssetId,
        date,
        netWorth: parseFloat(netWorth) || 0,
        inflow: parseFloat(inflow) || 0,
        profit: parseFloat(profit) || 0,
      });
    } else {
      snapshots.push({
        assetId,
        date,
        netWorth: parseFloat(netWorth) || 0,
        inflow: parseFloat(inflow) || 0,
        profit: parseFloat(profit) || 0,
      });
    }
  }

  // Parse transactions CSV
  const flowRows = parseCsv(fs.readFileSync(flowPath, 'utf8')).filter((r) => r.some((v) => v.length > 0));
  const flowHeader = flowRows[0];
  const expectedFlowHeader = ['ID', 'DATE', 'TYPE', 'VALUE', 'CAT', 'NOTE'];
  if (JSON.stringify(flowHeader) !== JSON.stringify(expectedFlowHeader)) {
    console.error(`Unexpected flow.txt header: ${JSON.stringify(flowHeader)}`);
    process.exit(1);
  }

  const transactions = [];
  for (let i = 1; i < flowRows.length; i++) {
    const [id, date, type, value, cat, note] = flowRows[i];
    transactions.push({
      id: parseInt(id, 10),
      date: padDate(date),
      type,
      value: parseFloat(value) || 0,
      cat: (cat ?? '').trim(),
      note: cleanNote(note),
    });
  }

  const backup = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    accounts,
    assets,
    snapshots,
    transactions,
    settings: {},
  };

  fs.writeFileSync(output, JSON.stringify(backup, null, 2));

  console.log(`✓ Wrote ${output}`);
  console.log(`  Accounts:     ${accounts.length}`);
  console.log(`  Assets:       ${assets.length}`);
  console.log(`  Snapshots:    ${snapshots.length}`);
  console.log(`  Transactions: ${transactions.length}`);
  if (skippedSnapshots > 0) {
    console.log(`  Skipped:      ${skippedSnapshots}`);
  }
}

main();
