// Runs the API server (with --watch) and the Vite dev server together.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = [
  ['server', spawn(npm, ['run', 'dev', '-w', 'server'], { stdio: 'pipe', shell: process.platform === 'win32' })],
  ['client', spawn(npm, ['run', 'dev', '-w', 'client'], { stdio: 'pipe', shell: process.platform === 'win32' })],
];
for (const [name, p] of procs) {
  const tag = name === 'server' ? '\x1b[34m[server]\x1b[0m ' : '\x1b[35m[client]\x1b[0m ';
  const pipe = (stream, out) => stream.on('data', (d) => out.write(d.toString().split('\n').filter(Boolean).map((l) => tag + l).join('\n') + '\n'));
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code) => {
    console.log(`${tag}exited with code ${code}`);
    for (const [, other] of procs) other.kill();
    process.exit(code ?? 0);
  });
}
const stop = () => { for (const [, p] of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
