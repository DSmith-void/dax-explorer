// Finds the .NET 10 SDK used for the helper: DOTNET_EXE if set, else the per-user install
// (%LOCALAPPDATA%\Microsoft\dotnet-10), else whatever "dotnet" is on PATH.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function dotnetExecutable() {
  if (process.env.DOTNET_EXE) return process.env.DOTNET_EXE;
  const userInstall = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Microsoft', 'dotnet-10', 'dotnet.exe');
  return userInstall && existsSync(userInstall) ? userInstall : 'dotnet';
}

/** Environment for dotnet commands: no usage telemetry, no banner. */
export function dotnetEnv(extra = {}) {
  return { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', ...extra };
}
