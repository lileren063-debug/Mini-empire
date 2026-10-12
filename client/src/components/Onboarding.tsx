import { useState } from 'react';
import { api } from '../api';
import { useGame } from '../game';
import { Modal } from './ui';
import { BuildingIcon } from '../render/sprites';

const STEPS = [
  { title: 'Welcome, ruler!', icon: 'headquarters' as const, size: 3, text: 'This green valley is your kingdom. You start with a Headquarters, an Archer Tower and a single Wall. Tap any building to see its stats and upgrade it.' },
  { title: 'Build an economy', icon: 'gold_mine' as const, size: 2, text: 'Use the Build button to place a Gold Mine, Lumber Camp and Stone Quarry. They produce even while you are offline — tap them to collect. A Storage raises how much you can hold.' },
  { title: 'Raise an army', icon: 'barracks' as const, size: 3, text: 'Build a Barracks to train Infantry, Archers, Cavalry and Siege Rams. Win campaign battles in the Army tab for resources, then challenge other players.' },
  { title: 'Join a clan, win the season', icon: 'archer_tower' as const, size: 2, text: 'Each season lasts 100 days: 90 days of building, then war preparation, 5 days of clan wars and territory battles, and final rankings. A few short visits a day are enough.' },
];

export function Onboarding() {
  const { refreshProfile } = useGame();
  const [i, setI] = useState(0);
  const done = async () => {
    await api('POST', '/profile/onboarding').catch(() => undefined);
    refreshProfile();
  };
  const s = STEPS[i];
  return (
    <Modal title={s.title} onClose={done}>
      <div style={{ display: 'flex', justifyContent: 'center' }}><BuildingIcon type={s.icon} size={s.size} level={i * 3 + 1} px={130} /></div>
      <p>{s.text}</p>
      <div className="row spread">
        <span className="muted small">{i + 1} / {STEPS.length}</span>
        <div className="row">
          <button className="btn secondary" onClick={done}>Skip</button>
          {i < STEPS.length - 1 ? <button className="btn" onClick={() => setI(i + 1)}>Next</button> : <button className="btn" onClick={done}>Start playing</button>}
        </div>
      </div>
    </Modal>
  );
}
