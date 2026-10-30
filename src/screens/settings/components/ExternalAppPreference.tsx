import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useState} from 'react';
import {Image, ScrollView, View} from 'react-native';
import {
  externalAppKey,
  getExternalApp,
  listExternalApps,
  type ExternalApp,
  type ExternalAppKind,
} from '../../../lib/externalApps';
import {mainStorage} from '../../../lib/storage';
import {useM3Colors} from '../../../theme/M3PaletteContext';
import {TVFocusable} from '../../../components/tv';
import AppText from '../../../components/ui/Text';
import MaterialDialogSurface from '../../../components/ui/MaterialDialogSurface';
export default function ExternalAppPreference({kind}: {kind: ExternalAppKind}) {
  const colors = useM3Colors();
  const [selected, setSelected] = useState(() => getExternalApp(kind));
  const [apps, setApps] = useState<ExternalApp[]>([]);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const label = kind === 'player' ? 'External player' : 'External downloader';
  const choices = [
    {packageName: 'ask', name: 'Ask every time'},
    ...apps,
  ];
  const current = choices.find(app => app.packageName === selected);
  return (
    <>
      <TVFocusable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => {
          setVisible(true);
          setError('');
          listExternalApps(kind)
            .then(setApps)
            .catch(() => setError('Could not load installed apps.'));
        }}
        borderRadius={16}
        style={{padding: 16, gap: 6}}>
        <AppText role="titleMedium" style={{color: colors.onSurface}}>
          {label}
        </AppText>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
          {current?.icon ? (
            <Image
              source={{uri: current.icon}}
              style={{width: 28, height: 28}}
            />
          ) : selected === 'ask' ? (
            <MaterialCommunityIcons name="apps" size={28} color={colors.onSurfaceVariant} />
          ) : null}
          <AppText style={{color: colors.onSurfaceVariant}}>
            {current?.name || selected}
          </AppText>
        </View>
      </TVFocusable>
      <View style={{height: 1, backgroundColor: colors.outlineVariant, width: '100%'}} />
      <MaterialDialogSurface
        visible={visible}
        onDismiss={() => setVisible(false)}>
        <AppText
          role="titleLarge"
          style={{color: colors.onSurface, marginBottom: 16}}>
          {label}
        </AppText>
        <ScrollView style={{maxHeight: 400}} contentContainerStyle={{gap: 4}}>
          {choices.map(app => (
            <TVFocusable
              key={app.packageName}
              accessibilityRole="radio"
              accessibilityLabel={app.name}
              accessibilityState={{checked: selected === app.packageName}}
              hasTVPreferredFocus={selected === app.packageName}
              onPress={() => {
                mainStorage.setString(externalAppKey(kind), app.packageName);
                setSelected(app.packageName);
                setVisible(false);
              }}
              borderRadius={12}
              style={{
                minHeight: 56,
                padding: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              }}>
              {app.icon ? (
                <Image
                  source={{uri: app.icon}}
                  style={{width: 32, height: 32}}
                />
              ) : (
                <MaterialCommunityIcons name="apps" size={32} color={colors.onSurfaceVariant} />
              )}
              <AppText
                style={{
                  color:
                    selected === app.packageName
                      ? colors.primary
                      : colors.onSurface,
                  flex: 1,
                }}>
                {app.name}
              </AppText>
            </TVFocusable>
          ))}
          {!!error && <AppText style={{color: colors.error}}>{error}</AppText>}
        </ScrollView>
      </MaterialDialogSurface>
    </>
  );
}
