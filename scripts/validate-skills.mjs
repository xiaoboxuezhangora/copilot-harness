#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const skillRoot = join(repoRoot, 'skills', '.github', 'skills');
const targetArg = process.argv[2];
const targetSkills = targetArg === undefined ? undefined : new Set(targetArg.split(','));

const failures = [];
const results = [];

for (const entry of readdirSync(skillRoot).sort()) {
  if (entry.startsWith('_')) continue;
  if (targetSkills !== undefined && !targetSkills.has(entry)) continue;

  const skillDir = join(skillRoot, entry);
  if (!statSync(skillDir).isDirectory()) continue;

  const skillFile = join(skillDir, 'SKILL.md');
  const content = readFileSync(skillFile, 'utf8');
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1];

  if (frontmatter === undefined) {
    failures.push(`${entry}: missing YAML frontmatter`);
    continue;
  }

  const name = matchField(frontmatter, 'name');
  const description = matchField(frontmatter, 'description');
  const hasOwner = /^owner:\s*\S+/m.test(frontmatter);
  const hasSourceRef = /^source_ref:/m.test(frontmatter);
  const lineCount = content.split('\n').length;
  const coreRules = countNumberedItemsBetween(content, '## Core Coding Rules', '## Code Anti-Patterns');
  const antiPatterns = countNumberedItemsBetween(
    content,
    '## Code Anti-Patterns',
    '## Skill-Hit Behavior Constraints'
  );
  const requiresW5Contract = entry === 'blood-transfusion';

  if (name !== entry) failures.push(`${entry}: name must match directory (${name} != ${entry})`);
  if (description.length === 0) failures.push(`${entry}: missing description`);
  if (!description.includes('正触发') || !description.includes('反触发')) {
    failures.push(`${entry}: description must include 正触发 and 反触发`);
  }
  if (description.length > 1024) failures.push(`${entry}: description exceeds 1024 chars`);
  if (requiresW5Contract && !hasOwner) failures.push(`${entry}: missing owner`);
  if (requiresW5Contract && !hasSourceRef) failures.push(`${entry}: missing source_ref`);
  if (lineCount > 500) failures.push(`${entry}: SKILL.md exceeds 500 lines`);

  if (requiresW5Contract) {
    if (coreRules < 5) failures.push(`${entry}: expected at least 5 core rules`);
    if (antiPatterns < 5) failures.push(`${entry}: expected at least 5 anti-patterns`);
  }

  results.push({
    name: entry,
    lineCount,
    coreRules,
    antiPatterns
  });
}

if (results.length === 0) {
  failures.push('no skills matched validation target');
}

for (const result of results) {
  console.log(
    `${result.name}: lines=${result.lineCount} coreRules=${result.coreRules} antiPatterns=${result.antiPatterns}`
  );
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `ERROR ${failure}`).join('\n'));
  process.exit(1);
}

function matchField(frontmatter, field) {
  return frontmatter.match(new RegExp(`^${field}:\\s*"?([^"\\n]+)"?`, 'm'))?.[1]?.trim() ?? '';
}

function countNumberedItemsBetween(content, startHeading, endHeading) {
  const start = content.indexOf(startHeading);
  if (start === -1) return 0;
  const end = content.indexOf(endHeading, start + startHeading.length);
  const section = content.slice(start, end === -1 ? undefined : end);
  return section.match(/^\d+\.\s/gm)?.length ?? 0;
}
