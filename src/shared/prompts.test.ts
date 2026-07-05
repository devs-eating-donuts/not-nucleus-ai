import { describe, expect, it } from 'vitest';
import { renderTemplate, renderCustomRolePrompt } from './prompts';
import { ROLE_DEFINITIONS } from './roles';

describe('renderTemplate', () => {
  it('substitutes known vars and leaves unknown placeholders intact', () => {
    expect(
      renderTemplate('Hi {{project_name}} in {{working_directory}} and {{nope}}', {
        project_name: 'PP',
        working_directory: '/ws',
      }),
    ).toBe('Hi PP in /ws and {{nope}}');
  });

  it('is immune to $-based replacement-pattern injection in values', () => {
    expect(renderTemplate('x {{project_name}} y', { project_name: '$& $1 $`' })).toBe('x $& $1 $` y');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('{{  project_name  }}', { project_name: 'PP' })).toBe('PP');
  });
});

describe('renderCustomRolePrompt (the byte-identical-when-unedited invariant)', () => {
  it('returns "" for a blank or undefined template', () => {
    expect(renderCustomRolePrompt('developer', '', { project_name: 'X' })).toBe('');
    expect(renderCustomRolePrompt('developer', undefined, {})).toBe('');
  });

  it('returns "" for the UNEDITED default template — so default runs are unchanged', () => {
    const def = ROLE_DEFINITIONS.developer.defaultPromptTemplate;
    expect(renderCustomRolePrompt('developer', def, { project_name: 'X' })).toBe('');
    expect(renderCustomRolePrompt('developer', `\n${def}\n`, {})).toBe('');
  });

  it('renders an operator block for a customized template, vars substituted', () => {
    const out = renderCustomRolePrompt('developer', 'Always test {{project_name}}.', {
      project_name: 'Pied Piper',
    });
    expect(out).toContain('ADDITIONAL INSTRUCTIONS FOR THIS ROLE');
    expect(out).toContain('Always test Pied Piper.');
    expect(out).not.toContain('{{project_name}}');
  });

  it('leaves unknown vars intact, and renders "" for whitespace-only content', () => {
    expect(renderCustomRolePrompt('qa', 'Check {{nonsense}}.', {})).toContain('{{nonsense}}');
    expect(renderCustomRolePrompt('qa', '   \n  ', {})).toBe('');
  });
});
