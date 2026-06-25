import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LOGOS_DIR = join(ROOT, 'public', 'logos');

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  await writeFile(dest, Buffer.from(buf));
}

async function main() {
  await mkdir(LOGOS_DIR, { recursive: true });

  const raw = await readFile(join(ROOT, 'data', 'chains.json'), 'utf-8');
  const chains = JSON.parse(raw);

  const seen = new Map();
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const [id, chain] of Object.entries(chains)) {
    if (!chain.logo) continue;

    const url = chain.logo;
    if (!url.includes('s3.us-east-1.amazonaws.com') && !url.startsWith('http')) continue;

    if (seen.has(url)) {
      chains[id].logo = seen.get(url);
      continue;
    }

    const filename = url.split('/').pop();
    const localPath = `/logos/${filename}`;
    const dest = join(LOGOS_DIR, filename);

    if (existsSync(dest)) {
      chains[id].logo = localPath;
      seen.set(url, localPath);
      skipped++;
      continue;
    }

    try {
      process.stdout.write(`Downloading ${filename}...`);
      await downloadFile(url, dest);
      chains[id].logo = localPath;
      seen.set(url, localPath);
      downloaded++;
      console.log(' done');
    } catch (e) {
      console.log(` FAILED: ${e.message}`);
      failed++;
    }
  }

  await writeFile(join(ROOT, 'data', 'chains.json'), JSON.stringify(chains, null, 2));

  console.log(`\nDone! Downloaded: ${downloaded}, Skipped (cached): ${skipped}, Failed: ${failed}`);
  console.log('chains.json updated — logos now served from /logos/');
}

main().catch(console.error);
