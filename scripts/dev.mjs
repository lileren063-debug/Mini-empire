// Cross-platform dev runner (Windows/macOS/Linux): starts the API server and the Vite client together.
import { spawn } from 'node:child_process';

const procs = [
  ['server', ['run', 'dev', '-w', 'server']],
  ['client', ['run', 'dev', '-w', 'client']],
].map(([name, args]) => {
  const p = spawn('npm', args, { stdio: 'inherit', shell: true });
  p.on('exit', (code) => {
    console.log(`[${name}] exited with code ${code}`);
    shutdown(code ?? 0);
  });
  return p;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (!p.killed) p.kill();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
