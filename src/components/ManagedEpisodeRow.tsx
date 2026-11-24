import {NavigationContext} from '@react-navigation/native';
import React, {useContext, useRef, useState} from 'react';
import {ActivityIndicator, View} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {TVFocusable} from './tv';
import EpisodeRowContent from './EpisodeRowContent';
import {useM3Colors} from '../theme/M3PaletteContext';
import {LEGACY_TERTIARY_BACKGROUND} from '../theme/seeds';
import {isTV} from '../lib/tv';
import {useTVRemote} from '../lib/tv/useTVRemote';
import {useTVFocusBorderColor} from '../lib/tv/useTVFocusBorderColor';

interface Props {
  title: string;
  description?: string;
  thumbnail: React.ReactNode;
  selecting: boolean;
  selected: boolean;
  busy: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onDelete: () => void;
  onShowDetails?: () => void;
  controlRef?: React.Ref<View>;
}
export default function ManagedEpisodeRow({
  title,
  description,
  thumbnail,
  selecting,
  selected,
  busy,
  onPress,
  onLongPress,
  onDelete,
  onShowDetails,
  controlRef,
}: Props) {
  const navigation = useContext(NavigationContext);
  const colors = useM3Colors();
  const focusBorderColor = useTVFocusBorderColor();
  const [focused, setFocused] = useState(false);
  const lastHold = useRef(0);
  const hold = () => {
    if (
      navigation?.isFocused() === false ||
      busy ||
      Date.now() - lastHold.current < 800
    )
      return;
    lastHold.current = Date.now();
    onLongPress();
  };
  useTVRemote(
    event => {
      if (
        (event.eventType === 'longSelect' || event.eventType === 'menu') &&
        (event.eventKeyAction === undefined || event.eventKeyAction === 1)
      )
        hold();
    },
    isTV && focused && !busy,
  );
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 6,
        gap: 4,
        minHeight: 76,
        borderRadius: 14,
        backgroundColor: LEGACY_TERTIARY_BACKGROUND,
        borderWidth: 1,
        borderColor:
          selected && selecting ? colors.primary : 'rgba(255,255,255,0.08)',
      }}>
      <TVFocusable
        ref={controlRef}
        accessibilityRole="button"
        accessibilityLabel={`${selecting ? 'Select' : 'Play'} ${title}`}
        accessibilityState={{selected: selecting && selected}}
        disabled={busy}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onLongPress={hold}
        onPress={() => {
          if (
            navigation?.isFocused() !== false &&
            Date.now() - lastHold.current >= 800
          )
            onPress();
        }}
        borderRadius={14}
        focusScale={1}
        focusBorderColor={focusBorderColor}
        focusedStyle={{backgroundColor: '#262626'}}
        style={{
          flex: 1,
          minHeight: 76,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}>
        {selecting && (
          <MaterialCommunityIcons
            name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
            size={24}
            color={colors.primary}
          />
        )}
        <EpisodeRowContent
          title={title}
          description={description}
          thumbnail={thumbnail}
          accentColor={colors.primary}
          textColor="#F5F0EF"
          mutedTextColor="#D4CBC9"
          onShowDetails={selecting ? undefined : onShowDetails}
        />
      </TVFocusable>
      {isTV && !selecting && onShowDetails && (
        <TVFocusable
          accessibilityRole="button"
          accessibilityLabel={`Show full description for ${title}`}
          onPress={onShowDetails}
          disabled={busy}
          borderRadius={14}
          focusBorderColor={focusBorderColor}
          style={{
            padding: 10,
            minWidth: 48,
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <MaterialCommunityIcons
            name="information-outline"
            size={24}
            color={colors.primary}
          />
        </TVFocusable>
      )}
      {!selecting && (
        <TVFocusable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${title}`}
          onPress={onDelete}
          disabled={busy}
          borderRadius={14}
          focusBorderColor={focusBorderColor}
          style={{
            padding: 10,
            minWidth: 48,
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          {busy ? (
            <ActivityIndicator color={colors.error} />
          ) : (
            <MaterialCommunityIcons
              name="delete-outline"
              size={24}
              color={colors.error}
            />
          )}
        </TVFocusable>
      )}
    </View>
  );
}
