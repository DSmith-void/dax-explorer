// npm run package
// Builds the web app and publishes the helper as a single self-contained DaxExplorer.exe
// (no .NET installation needed to run it), with the app's files in an "app" folder next to it:
//
//   release/DaxExplorer/DaxExplorer.exe
//   release/DaxExplorer/app/...
//   release/DaxExplorer/sample/Initech/...   (the made-up sample report, opened by "Use sample data")
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { dotnetEnv, dotnetExecutable } from './dotnet.mjs';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'release', 'DaxExplorer');

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false, ...options });
  if (result.status !== 0) {
    console.error(`\nFailed: ${command} exited with ${result.status ?? result.error}`);
    process.exit(1);
  }
}

if (process.platform !== 'win32') {
  console.error('The DAX Explorer helper is Windows-only (it connects to Power BI Desktop).');
  process.exit(1);
}

// 1. The web app (type-check + production build into dist/), via the project's own build script.
// npm sets npm_execpath to its own entry point when running this script.
if (!process.env.npm_execpath) {
  console.error('Run this through npm: npm run package');
  process.exit(1);
}
run(process.execPath, [process.env.npm_execpath, 'run', 'build']);

// 2. The helper as one self-contained executable.
// Empty the output folder rather than deleting it: a window open on the folder (Explorer, or the terminal
// DaxExplorer.exe was started from) would make deleting the folder itself fail.
mkdirSync(output, { recursive: true });
for (const entry of readdirSync(output)) rmSync(join(output, entry), { recursive: true, force: true });
run(
  dotnetExecutable(),
  [
    'publish',
    join('helper', 'src', 'DaxExplorer.Helper'),
    '--configuration', 'Release',
    '--runtime', 'win-x64',
    '--self-contained', 'true',
    '-p:PublishSingleFile=true',
    '-p:IncludeNativeLibrariesForSelfExtract=true',
    '-p:DebugType=none',
    '--output', output,
  ],
  { env: dotnetEnv() },
);

// 3. The app and the sample next to it. Desktop's per-user ".pbi" folders (local settings, data cache) stay behind.
cpSync(join(root, 'dist'), join(output, 'app'), { recursive: true });
cpSync(join(root, 'samples', 'Initech'), join(output, 'sample', 'Initech'), {
  recursive: true,
  filter: (source) => basename(source).toLowerCase() !== '.pbi',
});

const exe = join(output, 'DaxExplorer.exe');
if (!existsSync(exe)) {
  console.error(`Expected ${exe} but it was not created.`);
  process.exit(1);
}
console.log(`\nDone. Start DAX Explorer with:\n  ${exe}\n(or double-click it in Explorer)`);
