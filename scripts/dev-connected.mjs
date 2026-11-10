// npm run dev:connected
// Starts the helper and the Vite dev server together, sharing a random token, so the
// development app (with hot reload) can connect to Power BI Desktop. Ctrl+C stops both.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { dotnetEnv, dotnetExecutable } from './dotnet.mjs';

const root = resolve(import.meta.dirname, '..');
const token = randomBytes(32).toString('base64url');
const children = [];

function start(name, command, args, env) {
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `[${name}] `;
  const forward = (stream) => (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) stream.write(prefix + line + '\n');
  };
  child.stdout.on('data', forward(process.stdout));
  child.stderr.on('data', forward(process.stderr));
  child.on('exit', (code) => {
    console.log(`${prefix}stopped (${code ?? 'signal'})`);
    stopAll();
  });
  children.push(child);
}

function stopAll() {
  for (const child of children) if (child.exitCode === null) child.kill();
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

// The helper on its usual port (the dev server forwards /api there), without opening a browser.
start(
  'helper',
  dotnetExecutable(),
  ['run', '--project', join('helper', 'src', 'DaxExplorer.Helper'), '--no-launch-profile', '--', '--no-browser', '--port', '5092'],
  dotnetEnv({ DAXEXPLORER_HELPER_TOKEN: token }),
);

// The dev server; vite.config.ts adds the token to the /api requests it forwards.
// DAXEXPLORER_NO_OPEN=1 skips opening the browser (used by automated checks).
const viteArgs = [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), ...(process.env.DAXEXPLORER_NO_OPEN === '1' ? [] : ['--open'])];
start('vite', process.execPath, viteArgs, {
  ...process.env,
  DAXEXPLORER_HELPER_TOKEN: token,
});

console.log('Starting the helper and the dev server. Press Ctrl+C to stop both.');
