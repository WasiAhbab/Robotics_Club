import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
import path from 'node:path';

const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd(), true);
const env = { ...process.env };
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (Boolean(url) !== Boolean(key))
  throw new Error(
    'Set both NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or remove both to use local Supabase.',
  );
if (
  !url ||
  (env.ROBOHAVEN_LOCAL_STACK === '1' && url === 'http://127.0.0.1:54321')
) {
  env.SUPABASE_HOME ||= path.resolve('.supabase-cli');
  const cli = path.resolve('node_modules/supabase/dist/supabase.js');
  function run(args) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      env,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0)
      throw new Error(
        'Local Supabase ' +
          args[0] +
          ' failed. Check Docker Desktop and run npx supabase ' +
          args.join(' ') +
          ' for diagnostics.',
      );
    return result.stdout;
  }
  console.log(
    'Starting the local RoboHaven database. Docker Desktop must be running.',
  );
  run([
    'start',
    '-x',
    'studio,edge-runtime,logflare,vector,supavisor,imgproxy,postgres-meta',
  ]);
  run(['migration', 'up', '--local']);
  const settings = parseEnv(run(['status', '-o', 'env']));
  env.NEXT_PUBLIC_SUPABASE_URL = settings.API_URL;
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY = settings.ANON_KEY;
  env.SUPABASE_SERVICE_ROLE_KEY = settings.SERVICE_ROLE_KEY;
  if (
    !env.NEXT_PUBLIC_SUPABASE_URL ||
    !env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !env.SUPABASE_SERVICE_ROLE_KEY
  )
    throw new Error('Local Supabase did not return connection settings.');
  console.log(
    'Local account confirmation and recovery emails appear at ' +
      settings.MAILPIT_URL,
  );
}
const child = spawn(
  process.execPath,
  [
    require.resolve('next/dist/bin/next'),
    'dev',
    '--webpack',
    ...process.argv.slice(2),
  ],
  { env, stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill(signal));
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
