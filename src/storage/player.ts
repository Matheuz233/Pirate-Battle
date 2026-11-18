import { PersistentStore, STORAGE_KEYS, isRecord } from './localStore';

export interface PlayerIdentity {
  playerId: string;
  playerName: string;
}

const NAMES = ['Captain Jack', 'Captain Mara', 'Captain Ned', 'Captain Ivy', 'Captain Rook', 'Captain Sol'];

export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function isIdentity(v: unknown): v is PlayerIdentity {
  return isRecord(v) && typeof v.playerId === 'string' && v.playerId.length > 0 && typeof v.playerName === 'string';
}

export const playerStore = new PersistentStore<PlayerIdentity>(STORAGE_KEYS.player, isIdentity, () => {
  const identity = {
    playerId: `player-${uuid()}`,
    playerName: NAMES[Math.floor(Math.random() * NAMES.length)]!,
  };
  try {
    window.localStorage.setItem(STORAGE_KEYS.player, JSON.stringify(identity));
  } catch {
    /* ignore */
  }
  return identity;
});
