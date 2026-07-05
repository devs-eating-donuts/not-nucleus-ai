import { useEffect, useRef, useState } from 'react';
import type { EggTriggerId } from '../../shared/easterEggs';
import { EASTER_EGG_CLUES, checkAnswer, clueForTrigger, randomLine } from '../../shared/easterEggs';
import { useAppStore } from '../state/appStore';
import { Blunt, EggShield, JianYangWakes, Shrimp, Weissman52 } from './EggRewardArt';
import { FireworksBurst } from './FireworksBurst';
import { LeiMark } from './LeiMark';
import { PipeyMark } from './PipeyMark';

interface EasterEggDialogProps {
  trigger: EggTriggerId;
  onClose: () => void;
}

const WRONG_LINES = [
  'That is not it. Pipey believes in you, statistically.',
  'Incorrect. The incubator has seen worse guesses, but not many.',
  'No. Perhaps consult a rerun.',
];

const QUESTION_TITLES: Record<EggTriggerId, string> = {
  pipey: 'How can I help you?',
  lei: 'Someone hung this here.',
  hotdog: 'You found it.',
};

/** Fireworks per trigger: modest → bigger → the ten-second finale barrage. */
const CRACK_INTENSITY: Record<EggTriggerId, 1 | 2 | 3> = {
  pipey: 1,
  lei: 2,
  hotdog: 3,
};

function TriggerArt({ trigger }: { trigger: EggTriggerId }) {
  if (trigger === 'pipey') return <PipeyMark size={56} />;
  if (trigger === 'lei') return <LeiMark size={64} />;
  return <Shrimp width={64} />;
}

function RewardArt({ trigger }: { trigger: EggTriggerId }) {
  if (trigger === 'pipey') return <Weissman52 />;
  if (trigger === 'lei') return <Blunt />;
  return <EggShield />;
}

/**
 * The dialog behind each hidden trigger of the scavenger hunt
 * (shared/easterEggs.ts). Uncracked: the trigger's trivia clue with an answer
 * box. On a correct answer: fireworks, the reward image, real show lore, a
 * muted tease toward the next hidden trigger — and just a Close button.
 * Already cracked: the trigger stays as a chatter piece, dispensing one canned
 * line per open (the hot dog also carries Jian Yang's sleep/wake switch).
 */
export function EasterEggDialog({ trigger, onClose }: EasterEggDialogProps) {
  const crackedEggs = useAppStore((s) => s.settings.crackedEggs);
  const crackEgg = useAppStore((s) => s.crackEgg);

  const clue = clueForTrigger(trigger);
  const clueNumber = EASTER_EGG_CLUES.findIndex((c) => c.id === clue.id) + 1;
  const cracked = crackedEggs.includes(clue.id);

  const [guess, setGuess] = useState('');
  const [checking, setChecking] = useState(false);
  const [wrongCount, setWrongCount] = useState(0);
  /** Celebration beat: null until the crack happens in THIS open. */
  const [beat, setBeat] = useState<number | null>(null);
  const [burst, setBurst] = useState<1 | 2 | 3 | null>(null);
  /** One chatter line per dialog-open. */
  const [line] = useState(() => randomLine(trigger));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const submit = async () => {
    if (checking || guess.trim() === '') {
      return;
    }
    setChecking(true);
    try {
      if (await checkAnswer(clue, guess)) {
        // Pass the winning answer: it is the key that decrypts this tier's
        // persona portraits (the image vault — shared/imageVault.ts).
        crackEgg(clue.id, guess);
        setBeat(0);
        setBurst(CRACK_INTENSITY[trigger]);
        setGuess('');
        setWrongCount(0);
      } else {
        setWrongCount((n) => n + 1);
      }
    } finally {
      setChecking(false);
    }
  };

  const isFinale = trigger === 'hotdog';

  const renderCelebration = () => {
    if (isFinale && beat === 1) {
      return (
        <>
          <h3 className="egg-title">Jian Yang wakes up.</h3>
          <div className="egg-art">
            <JianYangWakes />
          </div>
          <p className="egg-clue">
            He heard you say the company name. He is ready to run this one too — every seat,
            every voice, the whole incubator.
          </p>
          <p className="egg-note">
            A new item has appeared in the status bar. It is a hot dog. It was inevitable.
          </p>
        </>
      );
    }
    return (
      <>
        <h3 className="egg-title">🎆 {clue.modeLabel}</h3>
        <div className="egg-art">
          <RewardArt trigger={trigger} />
        </div>
        <p className="egg-reveal">{clue.reveal}</p>
        <p className="egg-clue">{clue.insight}</p>
        <p className="egg-note">
          Unlocked — it now sits in the naming-mode switcher (top right) like it was always
          there.
        </p>
        {clue.tease && <p className="egg-note">{clue.tease}</p>}
        {isFinale && (
          <button type="button" className="btn primary" onClick={() => setBeat(1)}>
            Continue →
          </button>
        )}
      </>
    );
  };

  const renderChatter = () => <p className="egg-clue">{line}</p>;

  const renderQuestion = () => (
    <>
      <h3 className="egg-title">{QUESTION_TITLES[trigger]}</h3>
      <p className="egg-note">
        Clue {clueNumber} of {EASTER_EGG_CLUES.length}
      </p>
      <p className="egg-clue">{clue.clue}</p>
      <div className="egg-answer-row">
        <input
          ref={inputRef}
          type="text"
          placeholder="Your answer…"
          value={guess}
          disabled={checking}
          onChange={(e) => setGuess(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void submit();
            }
          }}
        />
        <button
          type="button"
          className="btn primary"
          disabled={checking || guess.trim() === ''}
          onClick={() => void submit()}
        >
          Answer
        </button>
      </div>
      {wrongCount > 0 && (
        <p className="egg-wrong">{WRONG_LINES[(wrongCount - 1) % WRONG_LINES.length]}</p>
      )}
    </>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      {burst !== null && <FireworksBurst intensity={burst} onDone={() => setBurst(null)} />}
      <div
        className="modal-card egg-card"
        role="dialog"
        aria-modal="true"
        aria-label="Easter egg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="egg-body">
          <div className="egg-pipey">
            <TriggerArt trigger={trigger} />
          </div>
          <div className="egg-content">
            {beat !== null ? renderCelebration() : cracked ? renderChatter() : renderQuestion()}
          </div>
        </div>
        <div className="egg-footer">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
