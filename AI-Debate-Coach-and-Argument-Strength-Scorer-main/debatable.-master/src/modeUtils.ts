export type DebateMode = 'practice' | 'live' | null;

export const getModeFromFlags = (isPracticeMode: boolean, isLiveMode: boolean): DebateMode => {
  if (isPracticeMode) return 'practice';
  if (isLiveMode) return 'live';
  return null;
};

export const getModeLabel = (mode: DebateMode) => {
  switch (mode) {
    case 'practice':
      return 'Practice Mode';
    case 'live':
      return 'Live Mode';
    default:
      return 'Debate';
  }
};
