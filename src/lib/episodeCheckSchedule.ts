export const EPISODE_CHECK_DAYS = [
  {value: 1, short: 'Mon', label: 'Monday'},
  {value: 2, short: 'Tue', label: 'Tuesday'},
  {value: 3, short: 'Wed', label: 'Wednesday'},
  {value: 4, short: 'Thu', label: 'Thursday'},
  {value: 5, short: 'Fri', label: 'Friday'},
  {value: 6, short: 'Sat', label: 'Saturday'},
  {value: 0, short: 'Sun', label: 'Sunday'},
] as const;

export interface EpisodeCheckSchedule {
  days: number[];
  hour: number;
  minute: number;
}

export interface ScheduledEpisodeCheck extends EpisodeCheckSchedule {
  nextAt: number;
}

export function getNextEpisodeCheckAt(schedule: EpisodeCheckSchedule, after = Date.now()): number | undefined {
  const start = new Date(after);
  for (let offset = 0; offset <= 7; offset++) {
    // Use calendar days so the selected local time survives daylight saving changes.
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    if (!schedule.days.includes(day.getDay())) continue;
    day.setHours(schedule.hour, schedule.minute, 0, 0);
    if (day.getTime() > after) return day.getTime();
  }
}

export function formatEpisodeCheckTime(hour: number, minute: number): string {
  return new Date(Date.UTC(2000, 0, 1, hour, minute)).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}
