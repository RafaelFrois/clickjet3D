import { SYNTH_TRACKS, type SynthTrackDef } from '../audio/music';

/**
 * Soundtrack playlist. The AudioManager plays it with a shuffle bag, so the order varies
 * (A → C → B → D …) and the same song never plays twice in a row.
 *
 * To use your own songs (e.g. the original ClickJet soundtrack), drop the files in
 * `public/audio/music/` and add entries like:
 *   { kind: 'file', name: 'MY SONG', url: 'audio/music/my-song.mp3' },
 */
export type MusicTrackConfig = { kind: 'synth'; def: SynthTrackDef } | { kind: 'file'; name: string; url: string };

export const MUSIC_TRACKS: MusicTrackConfig[] = [
  ...SYNTH_TRACKS.map((def): MusicTrackConfig => ({ kind: 'synth', def })),
  // { kind: 'file', name: 'MY SONG', url: 'audio/music/my-song.mp3' },
];

export const trackName = (t: MusicTrackConfig): string => (t.kind === 'synth' ? t.def.name : t.name);
