import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');
const SPEC_DOCS = ['PRD.md', 'TECH_RULES.md', 'DESIGN.md', 'todo.md'] as const;

function readDoc(filename: string): string {
  return fs.readFileSync(path.join(WORKSPACE_ROOT, filename), 'utf-8');
}

function stripCodeFences(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const result: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) {
      result.push(line);
    }
  }
  return result.join('\n');
}

function stripInlineCode(markdown: string): string {
  return markdown.replace(/`[^`\n]+`/g, '');
}

describe('Tier 2 (Boundary) — F01: Specification & Document Synchronization', () => {
  it('T2-F01-01: Unresolved Placeholder Detection', () => {
    const placeholderPatterns: RegExp[] = [
      /\[placeholder[^\]]*\]/i,
      /\[TBD\]/i,
      /\[Name\]/,
      /\[Metric\]/,
      /\[Feature name\]/i,
      /\[TODO[^\]]*\]/i,
      /\[INSERT[^\]]*\]/i,
      /\[YYYY-MM-DD\]/,
      /\/\/\s*TODO:\s*implement/i,
    ];

    for (const filename of SPEC_DOCS) {
      // Strip fenced and inline code samples (e.g. meta-rule citing `[placeholder]`)
      const content = stripInlineCode(stripCodeFences(readDoc(filename)));
      for (const pattern of placeholderPatterns) {
        const match = pattern.exec(content);
        expect(
          match,
          `Found unresolved placeholder ${match?.[0] ?? ''} in ${filename}`
        ).toBeNull();
      }
    }
  });

  it('T2-F01-02: Markdown AST & Table Syntax Integrity', () => {
    for (const filename of SPEC_DOCS) {
      const raw = readDoc(filename);
      const lines = raw.split(/\r?\n/);

      // 1. Verify all code fences are properly closed
      const fenceLines = lines.filter((line) => /^\s*```/.test(line));
      expect(
        fenceLines.length % 2,
        `Unclosed code fence detected in ${filename}`
      ).toBe(0);

      // 2. Verify markdown tables outside code fences have separator rows and uniform column counts
      const strippedLines = stripCodeFences(raw).split(/\r?\n/);
      let i = 0;
      while (i < strippedLines.length) {
        const line = strippedLines[i].trim();
        if (line.startsWith('|') && line.endsWith('|')) {
          const tableBlock: string[] = [];
          while (
            i < strippedLines.length &&
            strippedLines[i].trim().startsWith('|') &&
            strippedLines[i].trim().endsWith('|')
          ) {
            tableBlock.push(strippedLines[i].trim());
            i += 1;
          }
          expect(
            tableBlock.length,
            `Malformed table with < 2 rows in ${filename}`
          ).toBeGreaterThanOrEqual(2);
          const colCount = (row: string): number =>
            row
              .slice(1, -1)
              .split('|')
              .length;
          const expectedCols = colCount(tableBlock[0]);
          expect(
            tableBlock[1],
            `Missing markdown table separator row in ${filename}`
          ).toMatch(/^\|(\s*:?-{3,}:?\s*\|)+$/);
          for (const row of tableBlock) {
            expect(
              colCount(row),
              `Inconsistent table column count in ${filename} at row "${row}"`
            ).toBe(expectedCols);
          }
        } else {
          i += 1;
        }
      }

      // 3. Verify no empty or broken markdown link targets outside code fences
      const stripped = stripCodeFences(raw);
      const emptyLinkMatch = /\[[^\]]+\]\(\s*\)/.exec(stripped);
      expect(
        emptyLinkMatch,
        `Empty markdown link target in ${filename}`
      ).toBeNull();
    }
  });

  it('T2-F01-03: Milestone & Feature Inventory Completeness', () => {
    const todo = readDoc('todo.md');

    for (let m = 1; m <= 5; m += 1) {
      expect(todo).toContain(`Milestone ${m}`);
      expect(todo).toContain(`Milestone ${m} Verification Gate`);
    }

    const requiredFeatureKeywords = [
      'PRD.md',
      'TECH_RULES.md',
      'DESIGN.md',
      'todo.md',
      'git init',
      'Vite',
      'stateMachine.ts',
      'intervals.ts',
      'stateMachine.test.ts',
      'firebase.json',
      'firestore.rules',
      'firestore.rules.test.ts',
      'dailyLogGenerator',
      'doseEscalationCheck',
      'authService.ts',
      'ElderlySimpleView.tsx',
      'TakenButton.tsx',
      'SnoozeButton.tsx',
      'DoseTimeline.tsx',
      'ComplianceStats.tsx',
      'EscalationAlert.tsx',
      'CircleManager.tsx',
      'vite-plugin-pwa',
      'TEST_READY.md',
      'Tier 5',
      'npm run build',
    ];

    for (const keyword of requiredFeatureKeywords) {
      expect(todo, `todo.md missing coverage for "${keyword}"`).toContain(keyword);
    }
  });

  it('T2-F01-04: Timing Parameter Strict Equality', () => {
    const prd = readDoc('PRD.md');
    const techRules = readDoc('TECH_RULES.md');
    const design = readDoc('DESIGN.md');

    for (const doc of [prd, techRules, design]) {
      expect(doc).toMatch(/10[\s-]*min/i);
      expect(doc).toMatch(/30[\s-]*min|T\s*\+\s*30/i);
      // Ensure no contradictory snooze duration (e.g. 5m or 15m snooze)
      expect(doc).not.toMatch(/5[\s-]*minute snooze/i);
      expect(doc).not.toMatch(/45[\s-]*minute escalation/i);
    }

    expect(prd).toMatch(/T\s*\+\s*15|15\s+minutes/i);
    expect(techRules).toMatch(/T\s*\+\s*15|15\s+min/i);
    // DESIGN.md illustrates follow-up at 8:15 AM for a 8:00 AM scheduled dose (15m delta)
    expect(design).toContain('8:00 AM');
    expect(design).toContain('8:15 AM');
    expect(design).toContain('8:30 AM');
  });

  it('T2-F01-05: Strict Role Taxonomy Enforcement', () => {
    const prd = readDoc('PRD.md');
    const techRules = readDoc('TECH_RULES.md');
    const design = readDoc('DESIGN.md');
    const todo = readDoc('todo.md');

    for (const doc of [prd, techRules, design, todo]) {
      expect(doc).toContain('elderly');
      expect(doc).toContain('caregiver');
      expect(doc).toContain('dual');
    }

    // TECH_RULES.md defines the canonical UserRole union strictly as the 3 roles
    expect(techRules).toMatch(/UserRole\s*=\s*'elderly'\s*\|\s*'caregiver'\s*\|\s*'dual'/);
    expect(techRules).not.toMatch(/UserRole\s*=[^;]*'admin'/);
    expect(techRules).not.toMatch(/UserRole\s*=[^;]*'doctor'/);
    expect(techRules).not.toMatch(/UserRole\s*=[^;]*'superadmin'/);
  });
});
