import React from 'react';
import {View} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {TVFocusable} from './tv';

export default function RemovableSubtitleRow({children, title, onRemove, color = 'rgba(255,255,255,0.8)', onTVFocus}: {
  children: React.ReactNode; title: string; onRemove?: () => void; color?: string; onTVFocus?: () => void;
}) {
  if (!onRemove) return <>{children}</>;
  return <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
    <View style={{flex: 1, minWidth: 0}}>{children}</View>
    <TVFocusable registerScreenFocus={false} borderRadius={22} accessibilityRole="button"
      accessibilityLabel={`Remove subtitle ${title}`} onPress={onRemove} onFocus={onTVFocus}
      style={{width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 4}}>
      <MaterialIcons name="delete-outline" size={23} color={color} />
    </TVFocusable>
  </View>;
}
