import { describe, expect, it } from 'vitest';
import {
  buildProjectExportMarkdown,
  safeExportFileName,
  uniqueExportFileName,
} from './projectExport';
import type { ProjectExportInput } from './projectExport';

const base: Omit<ProjectExportInput, 'rooms'> = {
  projectName: 'Social Watch',
  createdAt: '2020-01-01T00:00:00.000Z',
  workspacePath: '/tmp/sample-app',
  templateId: 'dashboard',
  exportedAt: '2020-01-02T00:00:00.000Z',
};

describe('safeExportFileName', () => {
  it('slugifies a project name', () => {
    expect(safeExportFileName('My App!')).toBe('my-app');
    expect(safeExportFileName('  Social Watch  ')).toBe('social-watch');
  });
  it('falls back to "project" for an empty/symbol-only name', () => {
    expect(safeExportFileName('')).toBe('project');
    expect(safeExportFileName('***')).toBe('project');
  });
  it('caps length', () => {
    expect(safeExportFileName('x'.repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe('uniqueExportFileName', () => {
  it('suffixes slug-colliding project names so a batch export never overwrites', () => {
    const used = new Set<string>();
    // Three distinct names that all slug to the same base.
    expect(uniqueExportFileName('Social Watch', used)).toBe('social-watch-nucleus-export.md');
    expect(uniqueExportFileName('social.watch', used)).toBe('social-watch-nucleus-export-2.md');
    expect(uniqueExportFileName('Social-Watch', used)).toBe('social-watch-nucleus-export-3.md');
  });

  it('is case-insensitive when detecting collisions', () => {
    const used = new Set<string>();
    uniqueExportFileName('My App', used);
    expect(uniqueExportFileName('MY APP', used)).toBe('my-app-nucleus-export-2.md');
  });

  it('skips names already present in the destination (pre-seeded set ⇒ no clobber of a prior export)', () => {
    // The factory-reset handler seeds `used` from the destination dir listing so a
    // re-run into the same folder suffixes instead of overwriting an earlier export.
    const used = new Set<string>(['social-watch-nucleus-export.md']);
    expect(uniqueExportFileName('Social Watch', used)).toBe('social-watch-nucleus-export-2.md');
  });
});

describe('buildProjectExportMarkdown', () => {
  it('renders the header and non-empty room transcripts, skipping empty rooms', () => {
    const md = buildProjectExportMarkdown(
      {
        ...base,
        rooms: [
          {
            roleId: 'stakeholder',
            title: 'The Pitch',
            messages: [
              { role: 'user', text: 'A dashboard for political social media.' },
              { role: 'persona', text: 'I love it.\nMy 10%.' },
            ],
          },
          { roleId: 'projectLead', title: 'Investor Pitch', messages: [] },
          { roleId: 'architect', title: 'The Punch List', messages: [] },
        ],
      },
      'canon',
    );
    expect(md).toContain('# Social Watch — Nucleus-AI export');
    expect(md).toContain('Template: dashboard');
    expect(md).toContain('## The Pitch');
    expect(md).toContain('A dashboard for political social media.');
    expect(md).toContain('**You:**');
    // Multi-line persona reply is blockquoted line-by-line.
    expect(md).toContain('> I love it.');
    expect(md).toContain('> My 10%.');
    // Empty rooms are omitted entirely.
    expect(md).not.toContain('Investor Pitch');
    expect(md).not.toContain('The Punch List');
  });

  it('notes when nothing was recorded', () => {
    const md = buildProjectExportMarkdown(
      { ...base, rooms: [{ roleId: 'architect', title: 'The Whiteboard', messages: [] }] },
      'canon',
    );
    expect(md).toContain('No conversations were recorded');
  });

  it('redacts a secret-shaped value a founder pasted into a transcript', () => {
    const secret = 'sk_live_' + '0123456789abcdefABCDEF0123';
    const md = buildProjectExportMarkdown(
      {
        ...base,
        rooms: [
          {
            roleId: 'architect',
            title: 'The Whiteboard',
            messages: [{ role: 'user', text: `Use this Stripe key: ${secret} for billing.` }],
          },
        ],
      },
      'canon',
    );
    // The export can leave the workspace / be shared, so the value must not survive.
    expect(md).not.toContain(secret);
    expect(md).toContain('[redacted]');
    // Surrounding prose is preserved.
    expect(md).toContain('for billing.');
  });
});
