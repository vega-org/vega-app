import React from 'react';
import {Modal, ScrollView, Text, View} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {TVFocusable, TVFocusGuide} from './tv';
import {PlayerControl, PlayerControlIcon} from './PlayerControlBar';
import {PlayerControlStyle} from '../lib/player/controlStyle';

export default function PlayerMoreMenu({
  controls,
  appearance,
  color,
  onClose,
}: {
  controls: PlayerControl[];
  appearance: PlayerControlStyle;
  color: string;
  onClose: () => void;
}) {
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.6)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}>
        <TVFocusGuide
          trapFocusLeft
          trapFocusRight
          trapFocusUp
          trapFocusDown
          style={{
            width: '85%',
            maxWidth: 440,
            maxHeight: '90%',
            padding: 14,
            backgroundColor: '#171717',
            borderRadius: 20,
          }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 14,
            }}>
            <Text
              numberOfLines={1}
              style={{
                color: 'white',
                fontSize: 16 * appearance.scale,
                fontWeight: '600',
                flex: 1,
              }}>
              Settings
            </Text>
            <TVFocusable
              registerScreenFocus={false}
              accessibilityRole="button"
              accessibilityLabel="Close settings"
              onPress={onClose}
              focusBorderColor={color}
              borderRadius={22}
              style={{width: 44, height: 44, borderRadius: 22,
                backgroundColor: '#292929', alignItems: 'center', justifyContent: 'center'}}>
              <MaterialCommunityIcons name="close" size={22} color="#ddd" />
            </TVFocusable>
          </View>
          <ScrollView
            style={{flexShrink: 1}}
            showsVerticalScrollIndicator={false}>
            {controls.map((control, i) => (
              <TVFocusable
                key={control.id}
                registerScreenFocus={false}
                hasTVPreferredFocus={i === 0}
                accessibilityRole="button"
                accessibilityLabel={`${control.title}, ${control.label}`}
                focusBorderColor={color}
                borderRadius={16}
                onPress={() => {
                  onClose();
                  control.onPress();
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  minHeight: 44,
                  marginBottom: i < controls.length - 1 ? 8 : 0,
                  borderRadius: 16,
                  backgroundColor: '#252525',
                  borderWidth: 1,
                  borderColor: '#333',
                }}>
                <View style={{width: 40 * appearance.scale, height: 40 * appearance.scale,
                  borderRadius: 12, backgroundColor: '#323232', alignItems: 'center', justifyContent: 'center'}}>
                  <PlayerControlIcon
                    control={control}
                    size={24 * appearance.scale}
                  />
                </View>
                <View style={{flex: 1}}>
                  <Text
                    numberOfLines={1}
                    style={{color: '#eee', fontSize: 14 * appearance.scale}}>
                    {control.title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{color: '#aaa', fontSize: 12 * appearance.scale}}>
                    {appearance.labels === 'short'
                      ? control.shortLabel || control.label
                      : control.label}
                  </Text>
                </View>
              </TVFocusable>
            ))}
          </ScrollView>
        </TVFocusGuide>
      </View>
    </Modal>
  );
}
