// import padStart from 'lodash/padStart';

export const _onBack = (navigator: any) => {
  if (navigator && navigator.pop) {
    return () => navigator.pop();
  }
  return () =>
    console.warn(
      'Warning: _onBack requires navigator property to function. Either modify the onBack prop or pass a navigator prop',
    );
};

export const calculateTime = (args: FormatTime) => {
  const {
    time: currentTime = 0,
    duration,
    showTimeRemaining,
    showDuration,
  } = args;

  if (showTimeRemaining) {
    const remaining = Math.max(0, duration - currentTime);
    return !showDuration
      ? formatTime({...args, time: remaining, showTimeRemaining: true})
      : `${formatTime({...args, time: currentTime, showTimeRemaining: false})}/${formatTime({
          ...args,
          time: remaining,
          showTimeRemaining: true,
        })}`;
  }

  const formattedDuration = !showDuration
    ? ''
    : `/${formatTime({
        ...args,
        time: duration,
        showTimeRemaining: false,
      })}`;

  return `${formatTime({...args, time: currentTime})}${formattedDuration}`;
};

interface FormatTime {
  time?: number;
  duration: number;
  showDuration: boolean;
  showTimeRemaining: boolean;
  showHours: boolean;
}

export const formatTime = ({
  time = 0,
  duration,
  showTimeRemaining,
  showHours,
}: FormatTime) => {
  const symbol = showTimeRemaining ? '-' : '';
  time = Math.min(Math.max(time, 0), duration);

  if (!showHours) {
    const formattedMinutes = Math.floor(time / 60)
      .toFixed(0)
      .padStart(2, '0');
    const formattedSeconds = Math.floor(time % 60)
      .toFixed(0)
      .padStart(2, '0');

    return `${symbol}${formattedMinutes}:${formattedSeconds}`;
  }

  const formattedHours = Math.floor(time / 3600)
    .toFixed(0)
    .padStart(2, '0');
  const formattedMinutes = (Math.floor(time / 60) % 60)
    .toFixed(0)
    .padStart(2, '0');
  const formattedSeconds = Math.floor(time % 60)
    .toFixed(0)
    .padStart(2, '0');

  return `${symbol}${
    Number(formattedHours) > 0 || duration >= 3600 ? `${formattedHours}:` : ''
  }${formattedMinutes}:${formattedSeconds}`;
};
