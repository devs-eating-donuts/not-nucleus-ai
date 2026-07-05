import type { IconType } from 'react-icons';
import {
  LuBookOpen,
  LuBot,
  LuFile,
  LuFileText,
  LuFolder,
  LuFolderArchive,
  LuGauge,
  LuHammer,
  LuHistory,
  LuHouse,
  LuImage,
  LuInfo,
  LuKeyRound,
  LuLayoutTemplate,
  LuListChecks,
  LuPencilRuler,
  LuPresentation,
  LuRocket,
  LuTerminal,
  LuUsers,
  LuUsersRound,
  LuZap,
} from 'react-icons/lu';

/**
 * App icons — thin wrappers over Lucide (via react-icons), bundled locally (no
 * CDN, works offline). Lucide's stroke/outline style matches the look we hand-
 * rolled before, with `currentColor` so icons inherit the surrounding text color
 * and theme. One named export per concept so call sites read meaningfully and
 * every nav entry can have a distinct glyph.
 */

interface IconProps {
  size?: number;
  className?: string;
}

/** Wrap a Lucide glyph with the app's default size + decorative a11y attrs. */
function makeIcon(Glyph: IconType): (props: IconProps) => JSX.Element {
  return function Icon({ size = 16, className }: IconProps) {
    return <Glyph size={size} className={className} aria-hidden focusable={false} />;
  };
}

export const IconHome = makeIcon(LuHouse);
export const IconRipIt = makeIcon(LuZap);
export const IconTeam = makeIcon(LuUsers);
export const IconDefaultTeam = makeIcon(LuUsersRound);
export const IconRocket = makeIcon(LuRocket);
export const IconPresentation = makeIcon(LuPresentation);
export const IconWhiteboard = makeIcon(LuPencilRuler);
export const IconBullpen = makeIcon(LuHammer);
export const IconPunchList = makeIcon(LuListChecks);
export const IconGarage = makeIcon(LuGauge);
export const IconHistory = makeIcon(LuHistory);
export const IconLedger = makeIcon(LuBookOpen);
export const IconTerminal = makeIcon(LuTerminal);
export const IconFolder = makeIcon(LuFolder);
export const IconClis = makeIcon(LuBot);
export const IconTemplates = makeIcon(LuLayoutTemplate);
export const IconInfo = makeIcon(LuInfo);
export const IconVault = makeIcon(LuKeyRound);

// Reference-file kinds (used by the References panel).
export const IconImage = makeIcon(LuImage);
export const IconDocument = makeIcon(LuFileText);
export const IconArchive = makeIcon(LuFolderArchive);
export const IconFile = makeIcon(LuFile);
