import { useState } from 'react';
import type { EggTriggerId } from '../../shared/easterEggs';
import { triggerVisible } from '../../shared/easterEggs';
import { useAppStore } from '../state/appStore';
import { EasterEggDialog } from './EasterEggDialog';
import { Shrimp } from './EggRewardArt';
import { LeiMark } from './LeiMark';
import { PipeyMark } from './PipeyMark';

const LABELS: Record<EggTriggerId, string> = {
  pipey: 'Pipey',
  lei: 'A lei',
  hotdog: 'A shrimp',
};

/**
 * One hidden trigger of the scavenger hunt (shared/easterEggs.ts): renders
 * nothing until the previous clue cracks, then sits quietly on its page —
 * Pipey on About, the lei on The Pitch, the hot dog on Hacker Hostel —
 * opening its clue (or its chatter) when clicked.
 */
export function EasterEggSpot({ trigger }: { trigger: EggTriggerId }) {
  const crackedEggs = useAppStore((s) => s.settings.crackedEggs);
  const [open, setOpen] = useState(false);

  if (!triggerVisible(trigger, crackedEggs)) {
    return null;
  }
  return (
    <>
      <button
        type="button"
        className={`egg-spot egg-spot-${trigger}`}
        aria-label={LABELS[trigger]}
        onClick={() => setOpen(true)}
      >
        {trigger === 'pipey' && <PipeyMark size={40} />}
        {trigger === 'lei' && <LeiMark size={42} />}
        {trigger === 'hotdog' && <Shrimp width={24} />}
      </button>
      {open && <EasterEggDialog trigger={trigger} onClose={() => setOpen(false)} />}
    </>
  );
}
