import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseW11PolicyYaml, runPolicyCheck } from './policyCheck.js';

const POLICY_YAML = `schema_version: phase-2-w11-policies@1

redline_paths:
  - id: env_file
    pattern: '(^|/)\\.env(\\..*)?$'
    reason: 'No env files.'

forbidden_patterns:
  - id: authorization_bearer
    regex: '(authorization\\s*:\\s*bearer\\s+[a-z0-9\\-._~+/]{12,}=*|\\bbearer\\s+[a-z0-9\\-._~+/]{12,}=*)'
    reason: 'No bearer tokens.'
  - id: sensitive_request_response_dump
    regex: '(full\\s+(request|response)|raw\\s+(request|response)|完整(敏感)?(请求|响应)|request\\s*body\\s*[:=]|response\\s*body\\s*[:=])'
    reason: 'No sensitive request/response dump.'

scan_exempt_paths:
  - '^policies\\.yaml$'
`;

describe('W11 policy check', () => {
  let tempDir: string;
  let policyPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'w11-policy-'));
    policyPath = join(tempDir, 'policies.yaml');
    await writeFile(policyPath, POLICY_YAML, 'utf8');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses explicit path and content policy sections', () => {
    const config = parseW11PolicyYaml(POLICY_YAML);

    expect(config.schema_version).toBe('phase-2-w11-policies@1');
    expect(config.redline_paths[0]?.id).toBe('env_file');
    expect(config.forbidden_patterns[0]?.id).toBe('authorization_bearer');
    expect(config.scan_exempt_paths).toContain('^policies\\.yaml$');
  });

  it('passes when changed files do not match redline paths or forbidden content', async () => {
    await writeFile(join(tempDir, 'safe.ts'), 'export const value = 1;\n', 'utf8');

    const report = await runPolicyCheck({
      repoRoot: tempDir,
      policyPath,
      changedFiles: ['safe.ts'],
      now: () => new Date('2026-05-12T00:00:00.000Z')
    });

    expect(report.passed).toBe(true);
    expect(report.violation_count).toBe(0);
    expect(report.source).toBe('explicit');
  });

  it('fails redline paths and secret-like plaintext without reporting matched content', async () => {
    const secretPath = join(tempDir, 'src-secret.ts');
    await writeFile(
      secretPath,
      'const header = "Authorization: Bearer top-secret-token";\n',
      'utf8'
    );
    await writeFile(join(tempDir, '.env'), 'TOKEN=top-secret-token\n', 'utf8');

    const reportPath = join(tempDir, 'reports', 'policy.json');
    const report = await runPolicyCheck({
      repoRoot: tempDir,
      policyPath,
      reportPath,
      changedFiles: ['src-secret.ts', '.env'],
      now: () => new Date('2026-05-12T00:01:00.000Z')
    });

    expect(report.passed).toBe(false);
    expect(report.violations.map((violation) => violation.rule_id)).toEqual([
      'authorization_bearer',
      'env_file'
    ]);
    expect(JSON.stringify(report)).not.toContain('top-secret-token');

    const writtenReport = await readFile(reportPath, 'utf8');
    expect(writtenReport).not.toContain('top-secret-token');
  });

  it('skips policy hits only for redline rule definitions', async () => {
    const targetPath = join(tempDir, 'orchestrator', 'src', 'memory', 'index.ts');
    await mkdir(join(tempDir, 'orchestrator', 'src', 'memory'), { recursive: true });
    await writeFile(
      targetPath,
      [
        'export const MEMORY_REDLINE_RULES = [',
        '  {',
        "    id: 'sensitive_request_response_dump',",
        "    description: '禁止写入完整敏感请求/响应。',",
        '    pattern: /(request\\s*body\\s*[:=]|response\\s*body\\s*[:=])/i',
        '  }',
        '];',
        ''
      ].join('\n'),
      'utf8'
    );

    const report = await runPolicyCheck({
      repoRoot: tempDir,
      policyPath,
      changedFiles: ['orchestrator/src/memory/index.ts']
    });

    expect(report.passed).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it('still reports sensitive dump outside redline rule definition section', async () => {
    const targetPath = join(tempDir, 'orchestrator', 'src', 'memory', 'index.ts');
    await mkdir(join(tempDir, 'orchestrator', 'src', 'memory'), { recursive: true });
    await writeFile(
      targetPath,
      [
        'export const MEMORY_REDLINE_RULES = [',
        '  {',
        "    id: 'sensitive_request_response_dump',",
        "    description: '规则定义',",
        '    pattern: /(request\\s*body\\s*[:=]|response\\s*body\\s*[:=])/i',
        '  }',
        '];',
        'const leaked = "request body: should still be blocked";',
        ''
      ].join('\n'),
      'utf8'
    );

    const report = await runPolicyCheck({
      repoRoot: tempDir,
      policyPath,
      changedFiles: ['orchestrator/src/memory/index.ts']
    });

    expect(report.passed).toBe(false);
    expect(report.violations.map((item) => item.rule_id)).toContain(
      'sensitive_request_response_dump'
    );
  });
});
