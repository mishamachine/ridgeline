import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The sign-in buttons say "Sign in with Google" and "Sign in with Apple". "Continue with" appears in no sign-in copy ("Continue without an account" is the guest button and is allowed): prompts, banner, tour, support, docs.
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
describe('no "Continue with" in any sign-in copy', () => {
  const files = [...walk('src').filter((f) => /\.(ts|tsx|css|html)$/.test(f) && !/\.test\./.test(f)), ...walk('public').filter((f) => /\.(html|txt|json)$/.test(f)), 'README.md', ...walk('docs').filter((f) => f.endsWith('.md')), 'ios/App/App/Info.plist'];
  it.each(files)('%s', (f) => { expect(readFileSync(f, 'utf8')).not.toMatch(/continue with(?!out)/i); });
});
