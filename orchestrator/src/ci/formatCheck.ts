import { execFile } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import { resolveRepoRoot } from '../runtime/skillAgentLoader.js';
import { selectChangedFiles, type PolicyCheckScope } from './policyCheck.js';

interface FormatCheckOptions {
  readonly repoRoot?: string | undefined;
  readonly scope?: PolicyCheckScope | undefined;
  readonly base?: string | undefined;
  readonly head?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

interface CliConfig {
  readonly repoRoot: string;
  readonly scope: PolicyCheckScope;
  readonly base?: string | undefined;
  readonly head?: string | undefined;
  readonly help: boolean;
}

const execFileAsync = promisify(execFile);
const FORMATTABLE_FILE_PATTERN = /\.(css|html|js|json|jsonc|md|mjs|ts|tsx|vue|ya?ml)$/i;
const GENERATED_FORMAT_EXEMPTIONS: readonly RegExp[] = [
  /^orchestrator\/eval\/harvester-report\.(json|md)$/,
  /^orchestrator\/eval\/harvester\/harvester-report-/,
  /^\.memory\//,
  /^reports\//
];
const DEFAULT_SCOPE: PolicyCheckScope = 'changed';

export async function runFormatCheck(options: FormatCheckOptions = {}): Promise<number> {
  const repoRoot = resolve(options.repoRoot ?? resolveRepoRoot());
  const scope = options.scope ?? DEFAULT_SCOPE;
  const selection = await selectChangedFiles({
    repoRoot,
    scope,
    base: options.base,
    head: options.head,
    env: options.env ?? process.env
  });
  const files = selection.files
    .filter((file) => FORMATTABLE_FILE_PATTERN.test(file))
    .filter((file) => !isGeneratedFormatExempt(file));

  if (files.length === 0) {
    process.stdout.write(
      `w11-format-check: pass; source=${selection.source}; checked=0; reason=no formattable changed files\n`
    );
    return 0;
  }

  const prettierArgs = ['--check', ...toPrettierPaths(repoRoot, files)];
  try {
    await execFileAsync('pnpm', ['exec', 'prettier', ...prettierArgs], {
      cwd: resolve(repoRoot, 'orchestrator'),
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024
    });
    process.stdout.write(
      `w11-format-check: pass; source=${selection.source}; checked=${files.length}\n`
    );
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'prettier format check failed';
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

export async function runFormatCheckCli(
  argv: readonly string[] = process.argv.slice(2),
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<number> {
  let config: CliConfig;
  try {
    config = parseCliArgs(argv, env);
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Invalid format args'}\n`);
    process.stderr.write(`${usageText()}\n`);
    return 2;
  }

  if (config.help) {
    process.stdout.write(`${usageText()}\n`);
    return 0;
  }

  return runFormatCheck({
    repoRoot: config.repoRoot,
    scope: config.scope,
    base: config.base,
    head: config.head,
    env
  });
}

function toPrettierPaths(repoRoot: string, files: readonly string[]): readonly string[] {
  const orchestratorRoot = resolve(repoRoot, 'orchestrator');
  return files.map((file) =>
    relative(orchestratorRoot, resolve(repoRoot, file)).split(sep).join('/')
  );
}

function isGeneratedFormatExempt(file: string): boolean {
  return GENERATED_FORMAT_EXEMPTIONS.some((pattern) => pattern.test(file));
}

function parseCliArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): CliConfig {
  const repoRoot = resolve(env.CI_PROJECT_DIR ?? resolveRepoRoot());
  let scope: PolicyCheckScope = DEFAULT_SCOPE;
  let base: string | undefined;
  let head: string | undefined;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--scope') {
      scope = readScope(readNext(argv, index, arg));
      index += 1;
    } else if (arg.startsWith('--scope=')) {
      scope = readScope(arg.slice('--scope='.length));
    } else if (arg === '--base') {
      base = readNext(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--base=')) {
      base = arg.slice('--base='.length);
    } else if (arg === '--head') {
      head = readNext(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--head=')) {
      head = arg.slice('--head='.length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    repoRoot,
    scope,
    ...(base !== undefined ? { base } : {}),
    ...(head !== undefined ? { head } : {}),
    help
  };
}

function readScope(value: string): PolicyCheckScope {
  if (value === 'changed' || value === 'all') return value;
  throw new Error(`Invalid --scope value: ${value}`);
}

function readNext(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function usageText(): string {
  return [
    'Usage: w11-format-check [--scope changed|all] [--base <ref>] [--head <ref>]',
    '',
    'Checks formatting for changed formattable files by default; use --scope all for full tracked-file enforcement.'
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runFormatCheckCli().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'w11-format-check failed'}\n`
      );
      process.exitCode = 1;
    }
  );
}
