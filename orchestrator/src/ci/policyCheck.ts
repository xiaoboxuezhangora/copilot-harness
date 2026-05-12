import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import { resolveRepoRoot } from '../runtime/skillAgentLoader.js';

export type PolicyViolationKind = 'redline_path' | 'forbidden_pattern';
export type PolicyCheckScope = 'changed' | 'all';
export type PolicyCheckSource =
  | 'explicit'
  | 'git_diff'
  | 'local_changes'
  | 'all_tracked'
  | 'empty_fallback';

export interface PolicyRule {
  readonly id: string;
  readonly pattern: string;
  readonly reason: string;
}

export interface ContentPolicyRule {
  readonly id: string;
  readonly regex: string;
  readonly reason: string;
}

export interface W11PolicyConfig {
  readonly schema_version: 'phase-2-w11-policies@1';
  readonly redline_paths: readonly PolicyRule[];
  readonly forbidden_patterns: readonly ContentPolicyRule[];
  readonly scan_exempt_paths: readonly string[];
}

export interface PolicyViolation {
  readonly kind: PolicyViolationKind;
  readonly rule_id: string;
  readonly path: string;
  readonly line?: number | undefined;
  readonly reason: string;
}

export interface W11PolicyReport {
  readonly schema_version: 'phase-2-w11-policy-report@1';
  readonly generated_at: string;
  readonly policy_path: string;
  readonly scope: PolicyCheckScope;
  readonly source: PolicyCheckSource;
  readonly checked_file_count: number;
  readonly violation_count: number;
  readonly passed: boolean;
  readonly violations: readonly PolicyViolation[];
}

export interface PolicyCheckOptions {
  readonly repoRoot?: string | undefined;
  readonly policyPath?: string | undefined;
  readonly reportPath?: string | undefined;
  readonly scope?: PolicyCheckScope | undefined;
  readonly changedFiles?: readonly string[] | undefined;
  readonly base?: string | undefined;
  readonly head?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly now?: () => Date;
}

interface CompiledPolicyConfig {
  readonly config: W11PolicyConfig;
  readonly redlinePaths: readonly CompiledPathRule[];
  readonly forbiddenPatterns: readonly CompiledContentRule[];
  readonly scanExemptPaths: readonly RegExp[];
}

interface CompiledPathRule extends PolicyRule {
  readonly matcher: RegExp;
}

interface CompiledContentRule extends ContentPolicyRule {
  readonly matcher: RegExp;
}

export interface FileSelection {
  readonly files: readonly string[];
  readonly source: PolicyCheckSource;
}

interface CliConfig {
  readonly repoRoot: string;
  readonly policyPath: string;
  readonly reportPath: string;
  readonly scope: PolicyCheckScope;
  readonly base?: string | undefined;
  readonly head?: string | undefined;
  readonly help: boolean;
}

const execFileAsync = promisify(execFile);
const POLICY_SCHEMA_VERSION = 'phase-2-w11-policies@1';
const REPORT_SCHEMA_VERSION = 'phase-2-w11-policy-report@1';
const DEFAULT_POLICY_PATH = 'policies.yaml';
const DEFAULT_REPORT_PATH = 'reports/w11-policy-report.json';

export async function runPolicyCheck(options: PolicyCheckOptions = {}): Promise<W11PolicyReport> {
  const repoRoot = resolve(options.repoRoot ?? resolveRepoRoot());
  const policyPath = resolvePath(repoRoot, options.policyPath ?? DEFAULT_POLICY_PATH);
  const reportPath =
    options.reportPath === undefined ? undefined : resolvePath(repoRoot, options.reportPath);
  const scope = options.scope ?? 'changed';
  const now = options.now ?? (() => new Date());
  const policy = await loadW11PolicyConfig(policyPath);
  const compiled = compilePolicyConfig(policy);
  const selection =
    options.changedFiles === undefined
      ? await selectChangedFiles({
          repoRoot,
          scope,
          base: options.base,
          head: options.head,
          env: options.env ?? process.env
        })
      : {
          files: normalizeFileList(repoRoot, options.changedFiles),
          source: 'explicit' as const
        };
  const violations = await evaluateFiles(repoRoot, selection.files, compiled);

  const report: W11PolicyReport = {
    schema_version: REPORT_SCHEMA_VERSION,
    generated_at: now().toISOString(),
    policy_path: toRepoPath(repoRoot, policyPath),
    scope,
    source: selection.source,
    checked_file_count: selection.files.length,
    violation_count: violations.length,
    passed: violations.length === 0,
    violations
  };

  if (reportPath !== undefined) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  return report;
}

export async function loadW11PolicyConfig(policyPath: string): Promise<W11PolicyConfig> {
  const raw = await readFile(policyPath, 'utf8');
  return parseW11PolicyYaml(raw);
}

export function parseW11PolicyYaml(raw: string): W11PolicyConfig {
  const root: Record<string, string> = {};
  const redlinePaths: Record<string, string>[] = [];
  const forbiddenPatterns: Record<string, string>[] = [];
  const scanExemptPaths: string[] = [];
  let section: 'redline_paths' | 'forbidden_patterns' | 'scan_exempt_paths' | null = null;
  let currentItem: Record<string, string> | null = null;

  const flushCurrent = (): void => {
    if (currentItem === null || section === null) return;
    if (section === 'redline_paths') {
      redlinePaths.push(currentItem);
    } else if (section === 'forbidden_patterns') {
      forbiddenPatterns.push(currentItem);
    }
    currentItem = null;
  };

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    if (!rawLine.startsWith(' ') && line.endsWith(':')) {
      flushCurrent();
      section = readSectionName(line.slice(0, -1));
      continue;
    }

    if (!rawLine.startsWith(' ') && line.includes(':')) {
      flushCurrent();
      section = null;
      const [key, value] = splitKeyValue(line);
      root[key] = unquote(value);
      continue;
    }

    if (section === 'scan_exempt_paths') {
      if (line.startsWith('- ')) {
        scanExemptPaths.push(unquote(line.slice(2).trim()));
      }
      continue;
    }

    if (section === 'redline_paths' || section === 'forbidden_patterns') {
      if (line.startsWith('- ')) {
        flushCurrent();
        currentItem = {};
        const itemLine = line.slice(2).trim();
        if (itemLine.length > 0) {
          const [key, value] = splitKeyValue(itemLine);
          currentItem[key] = unquote(value);
        }
        continue;
      }

      if (currentItem !== null && line.includes(':')) {
        const [key, value] = splitKeyValue(line);
        currentItem[key] = unquote(value);
      }
    }
  }

  flushCurrent();

  if (root.schema_version !== POLICY_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported policies.yaml schema_version: ${root.schema_version ?? 'missing'}`
    );
  }

  return {
    schema_version: POLICY_SCHEMA_VERSION,
    redline_paths: redlinePaths.map((item, index) => readPathRule(item, index)),
    forbidden_patterns: forbiddenPatterns.map((item, index) => readContentRule(item, index)),
    scan_exempt_paths: scanExemptPaths
  };
}

export async function runPolicyCheckCli(
  argv: readonly string[] = process.argv.slice(2),
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<number> {
  let config: CliConfig;
  try {
    config = parseCliArgs(argv, env);
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Invalid policy args'}\n`);
    process.stderr.write(`${usageText()}\n`);
    return 2;
  }

  if (config.help) {
    process.stdout.write(`${usageText()}\n`);
    return 0;
  }

  const report = await runPolicyCheck({
    repoRoot: config.repoRoot,
    policyPath: config.policyPath,
    reportPath: config.reportPath,
    scope: config.scope,
    base: config.base,
    head: config.head,
    env
  });

  process.stdout.write(
    `w11-policy-check: ${report.passed ? 'pass' : 'fail'}; checked=${report.checked_file_count}; violations=${report.violation_count}; report=${config.reportPath}\n`
  );
  if (!report.passed) {
    process.stderr.write(renderViolationSummary(report.violations));
  }

  return report.passed ? 0 : 1;
}

export async function selectChangedFiles(input: {
  readonly repoRoot: string;
  readonly scope: PolicyCheckScope;
  readonly base?: string | undefined;
  readonly head?: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
}): Promise<FileSelection> {
  if (input.scope === 'all') {
    return {
      files: await gitFiles(input.repoRoot, ['ls-files']),
      source: 'all_tracked'
    };
  }

  const base = resolveBaseRef(input.base, input.env);
  const head = input.head ?? input.env.CI_COMMIT_SHA ?? 'HEAD';
  if (base !== null) {
    try {
      return {
        files: await gitFiles(input.repoRoot, [
          'diff',
          '--name-only',
          '--diff-filter=ACMRTUXB',
          base,
          head
        ]),
        source: 'git_diff'
      };
    } catch {
      // Fall through to deterministic local fallback.
    }
  }

  const localFiles = uniqueStrings([
    ...(await tryGitFiles(input.repoRoot, ['diff', '--name-only', '--cached'])),
    ...(await tryGitFiles(input.repoRoot, ['diff', '--name-only'])),
    ...(await tryGitFiles(input.repoRoot, ['ls-files', '--others', '--exclude-standard']))
  ]);

  return {
    files: localFiles,
    source: localFiles.length === 0 ? 'empty_fallback' : 'local_changes'
  };
}

async function evaluateFiles(
  repoRoot: string,
  files: readonly string[],
  policy: CompiledPolicyConfig
): Promise<readonly PolicyViolation[]> {
  const violations: PolicyViolation[] = [];

  for (const file of files) {
    for (const rule of policy.redlinePaths) {
      if (rule.matcher.test(file)) {
        violations.push({
          kind: 'redline_path',
          rule_id: rule.id,
          path: file,
          reason: rule.reason
        });
      }
    }

    if (isScanExempt(file, policy.scanExemptPaths)) {
      continue;
    }

    const text = await readTextFileIfPresent(resolve(repoRoot, file));
    if (text === null) {
      continue;
    }

    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const rule of policy.forbiddenPatterns) {
        rule.matcher.lastIndex = 0;
        if (rule.matcher.test(line)) {
          violations.push({
            kind: 'forbidden_pattern',
            rule_id: rule.id,
            path: file,
            line: index + 1,
            reason: rule.reason
          });
        }
      }
    }
  }

  return violations;
}

function compilePolicyConfig(config: W11PolicyConfig): CompiledPolicyConfig {
  return {
    config,
    redlinePaths: config.redline_paths.map((rule) => ({
      ...rule,
      matcher: new RegExp(rule.pattern, 'i')
    })),
    forbiddenPatterns: config.forbidden_patterns.map((rule) => ({
      ...rule,
      matcher: new RegExp(rule.regex, 'i')
    })),
    scanExemptPaths: config.scan_exempt_paths.map((pattern) => new RegExp(pattern))
  };
}

async function readTextFileIfPresent(path: string): Promise<string | null> {
  try {
    const content = await readFile(path, 'utf8');
    return content.includes('\u0000') ? null : content;
  } catch {
    return null;
  }
}

async function gitFiles(repoRoot: string, args: readonly string[]): Promise<readonly string[]> {
  const result = await execFileAsync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024
  });
  return splitGitFileList(String(result.stdout));
}

async function tryGitFiles(repoRoot: string, args: readonly string[]): Promise<readonly string[]> {
  try {
    return await gitFiles(repoRoot, args);
  } catch {
    return [];
  }
}

function splitGitFileList(stdout: string): readonly string[] {
  return uniqueStrings(
    stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  );
}

function resolveBaseRef(
  base: string | undefined,
  env: Readonly<Record<string, string | undefined>>
): string | null {
  const candidates = [
    base,
    env.CI_MERGE_REQUEST_DIFF_BASE_SHA,
    env.CI_MERGE_REQUEST_TARGET_BRANCH_SHA,
    env.CI_COMMIT_BEFORE_SHA
  ];

  for (const candidate of candidates) {
    if (candidate !== undefined && isUsableRef(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isUsableRef(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !/^0+$/.test(trimmed);
}

function normalizeFileList(repoRoot: string, files: readonly string[]): readonly string[] {
  return uniqueStrings(
    files
      .map((file) => normalizeRepoPath(repoRoot, file))
      .filter((file): file is string => file !== null)
  );
}

function normalizeRepoPath(repoRoot: string, file: string): string | null {
  const absolute = resolve(repoRoot, file);
  const relativePath = relative(repoRoot, absolute);
  if (relativePath.startsWith('..') || relativePath === '') {
    return null;
  }
  return relativePath.split(sep).join('/');
}

function toRepoPath(repoRoot: string, path: string): string {
  return relative(repoRoot, path).split(sep).join('/');
}

function resolvePath(repoRoot: string, path: string): string {
  return resolve(repoRoot, path);
}

function isScanExempt(path: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(path));
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function readPathRule(item: Record<string, string>, index: number): PolicyRule {
  return {
    id: requireField(item, 'id', `redline_paths[${index}]`),
    pattern: requireField(item, 'pattern', `redline_paths[${index}]`),
    reason: requireField(item, 'reason', `redline_paths[${index}]`)
  };
}

function readContentRule(item: Record<string, string>, index: number): ContentPolicyRule {
  return {
    id: requireField(item, 'id', `forbidden_patterns[${index}]`),
    regex: requireField(item, 'regex', `forbidden_patterns[${index}]`),
    reason: requireField(item, 'reason', `forbidden_patterns[${index}]`)
  };
}

function requireField(item: Record<string, string>, key: string, label: string): string {
  const value = item[key];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${label}.${key} is required`);
  }
  return value;
}

function readSectionName(
  value: string
): 'redline_paths' | 'forbidden_patterns' | 'scan_exempt_paths' | null {
  if (
    value === 'redline_paths' ||
    value === 'forbidden_patterns' ||
    value === 'scan_exempt_paths'
  ) {
    return value;
  }
  return null;
}

function splitKeyValue(line: string): readonly [string, string] {
  const separator = line.indexOf(':');
  if (separator < 0) {
    throw new Error(`Invalid policy line: ${line}`);
  }
  return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
}

function unquote(value: string): string {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseCliArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): CliConfig {
  const repoRoot = resolve(env.CI_PROJECT_DIR ?? resolveRepoRoot());
  let policyPath = DEFAULT_POLICY_PATH;
  let reportPath = DEFAULT_REPORT_PATH;
  let scope: PolicyCheckScope = 'changed';
  let base: string | undefined;
  let head: string | undefined;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--policy') {
      policyPath = readNext(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--policy=')) {
      policyPath = arg.slice('--policy='.length);
    } else if (arg === '--report') {
      reportPath = readNext(argv, index, arg);
      index += 1;
    } else if (arg.startsWith('--report=')) {
      reportPath = arg.slice('--report='.length);
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
    policyPath,
    reportPath,
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

function renderViolationSummary(violations: readonly PolicyViolation[]): string {
  return violations
    .map((violation) => {
      const location =
        violation.line === undefined ? violation.path : `${violation.path}:${violation.line}`;
      return `policy violation: ${violation.rule_id} (${violation.kind}) at ${location}\n`;
    })
    .join('');
}

function usageText(): string {
  return [
    'Usage: w11-policy-check [--policy <path>] [--report <path>] [--scope changed|all] [--base <ref>] [--head <ref>]',
    '',
    'Checks changed files by default. When MR/base env is missing, falls back to local git changed files deterministically.'
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPolicyCheckCli().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'w11-policy-check failed'}\n`
      );
      process.exitCode = 1;
    }
  );
}
