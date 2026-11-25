import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');

function readDoc(filename: string): string {
  return fs.readFileSync(path.join(WORKSPACE_ROOT, filename), 'utf-8');
}

describe('Tier 1 — F01: Specification & Document Synchronization', () => {
  it('T1-F01-01: PRD Overview & Personas Verification', () => {
    const prd = readDoc('PRD.md');
    expect(prd).toContain('MediMate');
    expect(prd).toContain('SDG 3');
    expect(prd).toContain('Ramesh Sharma');
    expect(prd).toContain('Priya Sharma');
    expect(prd).toContain('Nirmala Devi');
    expect(prd).toContain('US-E01');
    expect(prd).toContain('US-E05');
  });

  it('T1-F01-02: TECH_RULES Architecture & Stack Verification', () => {
    const techRules = readDoc('TECH_RULES.md');
    expect(techRules).toContain('Firebase');
    expect(techRules).toContain('Cloud Firestore');
    expect(techRules).toContain('Cloud Functions');
    for (const state of ['scheduled', 'due', 'taken', 'snoozed', 'unconfirmed', 'missed']) {
      expect(techRules).toContain(state);
    }
    expect(techRules).toContain('rules_version');
    expect(techRules).toContain('npm test');
    expect(techRules).toContain('npm run build');
  });

  it('T1-F01-03: DESIGN Simple Mode & Accessibility Specs', () => {
    const design = readDoc('DESIGN.md');
    expect(design).toContain('Simple Mode');
    expect(design).toContain('WCAG 2.2');
    expect(design).toMatch(/44\s*\\times\s*44|44x44/i);
    expect(design).toContain('4.5:1');
    expect(design).toContain('Caregiver Dashboard');
  });

  it('T1-F01-04: todo.md Phased Task Completeness', () => {
    const todo = readDoc('todo.md');
    for (const milestone of ['Milestone 1', 'Milestone 2', 'Milestone 3', 'Milestone 4', 'Milestone 5']) {
      expect(todo).toContain(milestone);
    }
    expect(todo).toMatch(/-\s*\[[xX /]\]/);
  });

  it('T1-F01-05: Cross-Document Terminology Consistency', () => {
    const prd = readDoc('PRD.md');
    const techRules = readDoc('TECH_RULES.md');
    const design = readDoc('DESIGN.md');
    const todo = readDoc('todo.md');

    for (const doc of [prd, techRules, design, todo]) {
      expect(doc).toContain('elderly');
      expect(doc).toContain('caregiver');
      expect(doc).toContain('dual');
      expect(doc).toMatch(/10[\s-]*min|10m|T\s*\+\s*10/i);
      expect(doc).toMatch(/30[\s-]*min|30m|T\s*\+\s*30/i);
    }

    for (const doc of [prd, techRules, todo]) {
      expect(doc).toMatch(/15[\s-]*min|15m|T\s*\+\s*15/i);
    }

    for (const state of ['scheduled', 'due', 'taken', 'snoozed', 'unconfirmed', 'missed']) {
      expect(prd).toContain(state);
      expect(techRules).toContain(state);
      expect(design.toLowerCase()).toContain(state);
      expect(todo).toContain(state);
    }
  });
});
