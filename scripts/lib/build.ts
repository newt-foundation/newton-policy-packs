import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { info } from './log.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Wraps `jco componentize` to produce <pack>/dist/policy.wasm. CLAUDE.md says
// `jco` is the canonical builder; we shell out so we can rerun whenever
// policy.js or newton-provider.wit changes.
export function componentize(pack: string): string {
  const packDir = join(REPO_ROOT, pack);
  if (!existsSync(packDir)) throw new Error(`Pack directory not found: ${packDir}`);

  const policyJs = join(packDir, 'policy.js');
  const wit = join(packDir, 'newton-provider.wit');
  const distDir = join(packDir, 'dist');
  const out = join(distDir, 'policy.wasm');

  if (!existsSync(policyJs)) throw new Error(`Missing ${policyJs}`);
  if (!existsSync(wit)) throw new Error(`Missing ${wit}`);

  info(`Building wasm: jco componentize ${pack}/policy.js -> ${pack}/dist/policy.wasm`);
  // We --disable everything WASI-flavored that the policy.js doesn't use, so
  // jco doesn't link WASI HTTP / random / stdio / fetch-event into the
  // component. The Newton enclave runtime only provides newton:provider/*
  // imports — it has no `wasi:http/types@0.2.10` linker to satisfy. Without
  // this flag the operators error with:
  //   "component imports instance wasi:http/types@0.2.10, but a matching
  //    implementation was not found in the linker"
  // We DO leave clocks enabled because policy.js calls Date.now().
  const result = spawnSync(
    'jco',
    [
      'componentize',
      policyJs,
      '--wit',
      wit,
      '--world-name',
      'newton-provider',
      '--disable',
      'http',
      '--disable',
      'random',
      '--disable',
      'stdio',
      '--disable',
      'fetch-event',
      '--out',
      out,
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('jco not found on PATH. Install via: npm i -g @bytecodealliance/jco');
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`jco componentize exited with code ${result.status}`);
  }
  return out;
}
