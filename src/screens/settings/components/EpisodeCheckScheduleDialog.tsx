import React, {useState} from 'react';
import {View} from 'react-native';
import {Host, TimePickerDialog} from '@expo/ui/jetpack-compose';
import Button from '../../../components/ui/Button';
import DropdownField from '../../../components/ui/DropdownField';
import MaterialDialogSurface from '../../../components/ui/MaterialDialogSurface';
import SettingsRow from '../../../components/ui/SettingsRow';
import AppText from '../../../components/ui/Text';
import {TVFocusable} from '../../../components/tv';
import {isTV} from '../../../lib/tv';
import {
  EPISODE_CHECK_DAYS,
  formatEpisodeCheckTime,
  type EpisodeCheckSchedule,
} from '../../../lib/episodeCheckSchedule';
import {useM3Colors, useM3HostTheme} from '../../../theme/M3PaletteContext';

const defaultSchedule: EpisodeCheckSchedule = {
  days: EPISODE_CHECK_DAYS.map(day => day.value),
  hour: 9,
  minute: 0,
};
const hours = Array.from({length: 24}, (_, hour) => String(hour).padStart(2, '0'));
const minutes = Array.from({length: 60}, (_, minute) => String(minute).padStart(2, '0'));
const valueLabel = (value: string) => value;

export default function EpisodeCheckScheduleDialog({initialSchedule, onSave, onDismiss}: {
  initialSchedule?: EpisodeCheckSchedule;
  onSave: (schedule: EpisodeCheckSchedule) => void;
  onDismiss: () => void;
}) {
  const colors = useM3Colors();
  const hostTheme = useM3HostTheme();
  const [schedule, setSchedule] = useState(initialSchedule ?? defaultSchedule);
  const [editingTime, setEditingTime] = useState(false);

  if (editingTime) {
    return (
      <Host matchContents {...hostTheme}>
        <TimePickerDialog
          initialDate={new Date(2000, 0, 1, schedule.hour, schedule.minute).toISOString()}
          is24Hour={!new Intl.DateTimeFormat(undefined, {hour: 'numeric'}).resolvedOptions().hour12}
          onDateSelected={date => {
            setSchedule(current => ({...current, hour: date.getHours(), minute: date.getMinutes()}));
            setEditingTime(false);
          }}
          onDismissRequest={() => setEditingTime(false)}
        />
      </Host>
    );
  }

  return (
    <MaterialDialogSurface visible onDismiss={onDismiss}>
      <AppText role="titleLarge" style={{color: colors.onSurface, marginBottom: 16}}>
        Custom schedule
      </AppText>
      {isTV ? (
        <View style={{flexDirection: 'row', gap: 12}}>
          <View style={{flex: 1}}>
            <AppText role="labelMedium" style={{color: colors.onSurfaceVariant}}>Hour</AppText>
            <DropdownField options={hours} value={hours[schedule.hour]} getKey={valueLabel} getLabel={valueLabel}
              placeholder="Hour" onChange={hour => setSchedule(current => ({...current, hour: Number(hour)}))} />
          </View>
          <View style={{flex: 1}}>
            <AppText role="labelMedium" style={{color: colors.onSurfaceVariant}}>Minute</AppText>
            <DropdownField options={minutes} value={minutes[schedule.minute]} getKey={valueLabel} getLabel={valueLabel}
              placeholder="Minute" onChange={minute => setSchedule(current => ({...current, minute: Number(minute)}))} />
          </View>
        </View>
      ) : (
        <SettingsRow
          title="Check time"
          description={formatEpisodeCheckTime(schedule.hour, schedule.minute)}
          icon="clock-outline"
          divider={false}
          onPress={() => setEditingTime(true)}
        />
      )}
      <AppText role="labelLarge" style={{color: colors.onSurfaceVariant, marginTop: 16, marginBottom: 8}}>
        Repeat on
      </AppText>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
        {EPISODE_CHECK_DAYS.map(day => {
          const selected = schedule.days.includes(day.value);
          return (
            <TVFocusable
              key={day.value}
              accessibilityRole="checkbox"
              accessibilityLabel={day.label}
              accessibilityState={{checked: selected}}
              registerScreenFocus={false}
              borderRadius={12}
              onPress={() => setSchedule(current => ({
                ...current,
                days: current.days.includes(day.value)
                  ? current.days.filter(value => value !== day.value)
                  : [...current.days, day.value],
              }))}
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 48,
                minWidth: 60,
                paddingHorizontal: 8,
                borderRadius: 12,
                borderColor: selected ? colors.secondaryContainer : colors.outline,
                borderWidth: 1,
                backgroundColor: selected ? colors.secondaryContainer : colors.surfaceContainerHigh,
              }}>
              <AppText role="labelMedium" style={{color: selected ? colors.onSecondaryContainer : colors.onSurfaceVariant}}>
                {day.short}
              </AppText>
            </TVFocusable>
          );
        })}
      </View>
      <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 24}}>
        <Button variant="text" onPress={onDismiss}>Cancel</Button>
        <Button disabled={schedule.days.length === 0} onPress={() => onSave(schedule)}>Save</Button>
      </View>
    </MaterialDialogSurface>
  );
}
