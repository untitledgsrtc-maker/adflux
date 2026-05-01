// =====================================================================
// Copies ../pdf-templates/ into pdf-api/_templates/ so Vercel's build
// (rooted at pdf-api/) can bundle them with the serverless functions.
//
// Why not import via ../../pdf-templates directly?
//   Vercel only includes files within the project root in the deploy
//   bundle. With the root set to pdf-api/, parent siblings are out of
//   reach. Copying solves this without monorepo gymnastics.
//
// Run:
//   - manually:    `npm run sync-templates`
//   - automatically before deploy: `npm run vercel-build`
//
// _templates/ is .gitignored — it's a build artefact, not source.
// =====================================================================

import { mkdir, rm, cp, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', '..', 'pdf-templates');
const DST = resolve(__dirname, '..', '_templates');

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function main() {
  if (!await exists(SRC)) {
    console.error(`✗ Source not found: ${SRC}`);
    console.error('  Expected pdf-templates/ as a sibling of pdf-api/.');
    process.exit(1);
  }

  await rm(DST, { recursive: true, force: true });
  await mkdir(DST, { recursive: true });

  // Copy everything except node_modules + the smoke-test output dir.
  // node:fs cp filter is sync, so we walk manually.
  const entries = await readdir(SRC, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'out' || e.name === 'package-lock.json') continue;
    await cp(join(SRC, e.name), join(DST, e.name), { recursive: true });
  }

  console.log(`✓ Synced ${SRC} → ${DST}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
