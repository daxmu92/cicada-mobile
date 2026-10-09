import {readFile,readdir,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const bundle=path.resolve(process.argv[2]??'src-tauri/target/release/bundle');
const output=path.resolve(process.argv[3]??bundle);
const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
async function list(dir){const files=[];for(const entry of await readdir(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())files.push(...await list(full));else if(/\.(exe|msi|zip|sig)$/.test(entry.name))files.push(full);}return files;}
const files=(await list(bundle)).sort();if(!files.some(f=>/\.(exe|msi)$/.test(f)))throw new Error('No Windows installer produced');
const flat=output!==bundle;
if(flat&&new Set(files.map(f=>path.basename(f))).size!==files.length)throw new Error('Artifact basename collision');
const artifacts=[];for(const file of files){const data=await readFile(file);artifacts.push({file:flat?path.basename(file):path.relative(bundle,file).replaceAll('\\','/'),bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}
await mkdir(output,{recursive:true});const published=new Date().toISOString();
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
await writeFile(path.join(output,'build-manifest.json'),JSON.stringify({version,commit,builtAt:published,artifacts},null,2)+'\n');
await writeFile(path.join(output,'SHA256SUMS'),artifacts.map(a=>`${a.sha256}  ${a.file}`).join('\n')+'\n');
const installer=files.find(f=>/nsis[/\\].*x64.*\.exe$/.test(f)&&files.includes(f+'.sig'));
await rm(path.join(output,'latest.json'),{force:true});
if(installer){const signature=(await readFile(installer+'.sig','utf8')).trim();if(!signature)throw new Error('Empty update signature');await writeFile(path.join(output,'latest.json'),JSON.stringify({version,notes:`Cicada ${version}`,pub_date:published,platforms:{'windows-x86_64':{signature,url:`https://github.com/daxmu92/cicada-mobile/releases/download/v${version}/${encodeURIComponent(path.basename(installer))}`}}},null,2)+'\n');}
console.log(`Prepared ${artifacts.length} artifacts; signed update manifest: ${Boolean(installer)}`);
