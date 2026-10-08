// Runs API and web dev servers together; ctrl-c stops both.
// ponytail: replaces `concurrently` (its shell-quote dep has an open advisory); no log prefixing.
import { spawn } from 'node:child_process';

const children = ['@tm/api', '@tm/web'].map((ws) =>
  spawn('npm', ['run', 'dev', '-w', ws], { stdio: 'inherit' }),
);

const stop = (code = 0) => {
  children.forEach((c) => c.kill('SIGTERM'));
  process.exit(code);
};
children.forEach((c) => c.on('exit', (code) => code && stop(code)));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
