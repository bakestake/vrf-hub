import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDomain = process.env.APP_DOMAIN || `bakeland:vrf-hub-keepalive-stress:${Date.now()}:v3`;
const commonEnv = {
  ...process.env,
  APP_DOMAIN: appDomain,
  LANE_COUNT: process.env.LANE_COUNT || '4',
  ITERATIONS: process.env.ITERATIONS_PER_CHECKPOINT || '25',
};
const startCheckpoint = Math.min(10, Math.max(1, Number(process.env.START_CHECKPOINT) || 1));

function run(script, extraEnv = {}) {
  const result = spawnSync(process.execPath, [path.join(scriptDir, script)], {
    env: { ...commonEnv, ...extraEnv },
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${script} exited with status ${result.status}`);
  }
}

const startedAt = Date.now();
for (let checkpoint = startCheckpoint; checkpoint <= 10; checkpoint += 1) {
  console.log(JSON.stringify({ phase: 'session-checkpoint-start', checkpoint, appDomain }));
  run('smoke-vrf-hub-devnet.mjs');
  run('checkpoint-vrf-hub-batch-devnet.mjs');
}

commonEnv.ITERATIONS = process.env.POST_ROLLOVER_ITERATIONS || '1';
run('smoke-vrf-hub-devnet.mjs');

console.log(JSON.stringify({
  phase: 'keepalive-stress-complete',
  appDomain,
  checkpoints: 10,
  resultsInCompletedSession: 1000,
  postRolloverIterations: Number(commonEnv.ITERATIONS),
  elapsedMs: Date.now() - startedAt,
}));
