// Metro 0.83 passes image paths to image-size. Version 2 accepts bytes only.
// Keep Metro's API while backporting the buffer call required by the fixed parser.
const fs = require('node:fs');
const path = require('node:path');
const root = path.dirname(require.resolve('metro/package.json'));
const file = path.join(root, 'src', 'Assets.js');
const old = 'const isImageInput = assetInfo.files[0].includes(".zip/")';
const patched = 'const isImageInput = isImage || assetInfo.files[0].includes(".zip/")';
const source = fs.readFileSync(file, 'utf8');
if (source.includes(patched)) process.exit(0);
if (!source.includes(old)) throw new Error('Metro image compatibility patch needs review after the dependency change');
fs.writeFileSync(file, source.replace(old, patched));
console.log('Applied Metro buffer-image compatibility patch');
