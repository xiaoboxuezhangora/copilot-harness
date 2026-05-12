import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { exportShowcaseSnapshot } from './showcase-export-lib.js';

interface CliOptions {
  date: string;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = await exportShowcaseSnapshot({
    repoRoot,
    date: options.date
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        outputPath: result.outputPath,
        mirroredPath: result.mirroredPath,
        phase0Readiness: result.snapshot.metadata.phase0Readiness,
        warningCount: result.snapshot.metadata.warnings.length,
        warnings: result.snapshot.metadata.warnings
      },
      null,
      2
    )}\n`
  );
}

function parseArgs(args: readonly string[]): CliOptions {
  let date = formatLocalDate(new Date());
  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];
    if (current === '--date') {
      const value = args[i + 1];
      if (value === undefined || !isValidDate(value)) {
        throw new Error('Invalid --date value. Expected YYYY-MM-DD.');
      }
      date = value;
      i += 1;
      continue;
    }
    if (current === '-d') {
      const value = args[i + 1];
      if (value === undefined || !isValidDate(value)) {
        throw new Error('Invalid -d value. Expected YYYY-MM-DD.');
      }
      date = value;
      i += 1;
      continue;
    }
    if (current === '--help' || current === '-h') {
      process.stdout.write('Usage: tsx scripts/showcase-export.ts [--date YYYY-MM-DD]\n');
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${current}`);
  }
  return { date };
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
