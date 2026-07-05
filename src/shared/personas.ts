import type { NamingMode } from './naming';
import { resolveName } from './naming';
import type { RoleId } from './roles';

/**
 * A persona is the default identity attached to a role. Users can rename
 * personas freely; roles stay stable. Each persona carries two names — the
 * show-accurate `canonName` and our legally-distinct `distinctName` — and
 * the active naming mode (see naming.ts) decides which one displays.
 */
export interface Persona {
  id: string;
  /** Show-accurate name (used by the 'canon' and 'cover' modes). */
  canonName: string;
  /** Original, legally-distinct name (used by the 'distinct' mode). */
  distinctName: string;
  title: string;
  /** Role this persona occupies by default; null for flavor-only personas. */
  roleId: RoleId | null;
  /** One-liner shown in the UI. Dry, professional, slightly absurd. */
  flavor: string;
  /** Flavor-only personas never run CLIs. */
  flavorOnly: boolean;
}

export const DEFAULT_PERSONAS: Persona[] = [
  {
    id: 'richard-henderstack',
    canonName: 'Richard Hendricks',
    distinctName: 'Richard Henderstack',
    title: 'Founder · Architect',
    roleId: 'architect',
    flavor: 'Believes the architecture diagram is the product. Occasionally correct.',
    flavorOnly: false,
  },
  {
    id: 'erlich-bachlund',
    canonName: 'Erlich Bachman',
    distinctName: 'Erlich Bachlund',
    title: 'Stakeholder · Vision',
    roleId: 'stakeholder',
    flavor: 'Owns 10% of the vision and 100% of the adjectives.',
    flavorOnly: false,
  },
  {
    id: 'jared-dunnison',
    canonName: 'Jared Dunn',
    distinctName: 'Jared Dunnison',
    title: 'Operations · Coordination',
    roleId: 'ops',
    flavor: 'Operational stability, quietly and without recognition.',
    flavorOnly: false,
  },
  {
    id: 'dinesh-chugbyte',
    canonName: 'Dinesh Chugtai',
    distinctName: 'Dinesh Chugbyte',
    title: 'Developer',
    roleId: 'developer',
    flavor: 'Ships fast. Benchmarks faster. Mentions both.',
    flavorOnly: false,
  },
  {
    id: 'bighead-bignetti',
    canonName: 'Big Head Bighetti',
    distinctName: 'Big Head Bignetti',
    title: 'Quality Assurance',
    roleId: 'qa',
    flavor: 'Finds critical bugs through a process best described as ambient luck.',
    flavorOnly: false,
  },
  {
    id: 'gilfoyle-zerotrust',
    canonName: 'Gilfoyle',
    distinctName: 'Gilfoyle Zerotrust',
    title: 'Security',
    roleId: 'security',
    flavor: 'Reviews trust boundaries with appropriate hostility.',
    flavorOnly: false,
  },
  {
    id: 'monica-hallmark',
    canonName: 'Monica Hall',
    distinctName: 'Monica Hallmark',
    title: 'Project Lead · Oversight',
    roleId: 'projectLead',
    flavor: 'The only person in the building who has read the term sheet and the code.',
    flavorOnly: false,
  },
  {
    id: 'gavin-belch',
    canonName: 'Gavin Belson',
    distinctName: 'Gavin Belch',
    title: 'Corporate Antagonist (Advisory)',
    roleId: null,
    flavor: 'Periodically acquires things adjacent to your roadmap.',
    flavorOnly: true,
  },
  {
    id: 'peter-gregorix',
    canonName: 'Peter Gregory',
    distinctName: 'Peter Gregorix',
    title: 'Investor (Emeritus)',
    roleId: null,
    flavor: 'Funds ideas that fit on one index card.',
    flavorOnly: true,
  },
  {
    id: 'russ-hanneford',
    canonName: 'Russ Hanneman',
    distinctName: 'Russ Hanneford',
    title: 'Investor (Three Commas)',
    roleId: null,
    flavor: 'Put radio on the internet. Has three commas. Will mention both, unprompted.',
    flavorOnly: true,
  },
  {
    id: 'laurie-bramwell',
    canonName: 'Laurie Bream',
    distinctName: 'Laurie Bramwell',
    title: 'Investor · Raviga (Successor)',
    roleId: null,
    flavor: 'Speaks exclusively in optimal outcomes. Has computed that this is fine.',
    flavorOnly: true,
  },
  {
    id: 'jack-barkley',
    canonName: 'Jack Barker',
    distinctName: 'Jack Barkley',
    title: 'CEO · "Action Jack" (Advisory)',
    roleId: null,
    flavor: 'Solves every problem with the Conjoined Triangles of Success.',
    flavorOnly: true,
  },
  {
    id: 'ron-laflambe',
    canonName: 'Ron LaFlamme',
    distinctName: 'Ron LaFlambé',
    title: 'Legal Counsel (Advisory)',
    roleId: null,
    flavor: 'Reviews your term sheet horizontally, in no particular hurry.',
    flavorOnly: true,
  },
];

export function defaultPersonaForRole(roleId: RoleId): Persona | undefined {
  return DEFAULT_PERSONAS.find((p) => p.roleId === roleId);
}

/** A persona's display name for the active naming mode. */
export function personaDisplayName(persona: Persona, mode: NamingMode): string {
  return resolveName({ canon: persona.canonName, distinct: persona.distinctName }, mode);
}

/**
 * The name to show for a role's seat: an explicit user override wins;
 * otherwise the default persona resolved for the active naming mode.
 */
export function effectivePersonaName(
  roleId: RoleId,
  override: string | null,
  mode: NamingMode,
): string {
  if (override && override.trim() !== '') {
    return override;
  }
  const persona = defaultPersonaForRole(roleId);
  return persona ? personaDisplayName(persona, mode) : roleId;
}
