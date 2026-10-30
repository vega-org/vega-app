import React, {useEffect, useState} from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {MetadataPicker} from './MetadataPicker';
import MetadataEpisodeSwitch from './MetadataEpisodeSwitch';
import type {LocalTitle} from '../../lib/localContent/model';
import useLocalContentStore from '../../lib/zustand/localContentStore';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {isTV} from '../../lib/tv';
import {TVFocusable, TVFocusGuide} from '../tv';
import AppText from '../ui/Text';

export default function LocalMetadataDialog({
  visible,
  onClose,
  title,
}: {
  visible: boolean;
  onClose: () => void;
  title: LocalTitle;
}) {
  const colors = useM3Colors();
  const insets = useSafeAreaInsets();
  const [picker, setPicker] = useState(false);
  useEffect(() => {
    if (!visible) setPicker(false);
  }, [visible]);
  const update = (
    patch: Partial<Pick<LocalTitle, 'metadata' | 'useMetadataTitles'>>,
  ) => {
    const latest = useLocalContentStore
      .getState()
      .titles.find(item => item.id === title.id);
    if (latest)
      useLocalContentStore.getState().saveTitles([{...latest, ...patch}]);
  };
  return (
    <Modal
      visible={visible}
      transparent={!picker}
      animationType="fade"
      onRequestClose={() => (picker ? setPicker(false) : onClose())}>
      {picker ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{
            flex: 1,
            backgroundColor: colors.background,
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 16,
            paddingHorizontal: 20,
          }}>
          <MetadataPicker
            title={title}
            onBack={() => setPicker(false)}
            options={
              <MetadataEpisodeSwitch
                value={title.useMetadataTitles}
                onChange={enabled => update({useMetadataTitles: enabled})}
              />
            }
            onChoose={metadata => {
              update({metadata});
              setPicker(false);
              onClose();
            }}
          />
        </KeyboardAvoidingView>
      ) : (
        <View style={{flex: 1}}>
          <Pressable
            accessibilityLabel="Close metadata menu"
            onPress={onClose}
            style={{position: 'absolute', top: 0, right: 0, bottom: 0, left: 0}}
          />
          <TVFocusGuide
            autoFocus
            trapFocusLeft
            trapFocusRight
            trapFocusUp
            trapFocusDown
            style={{
              position: 'absolute',
              right: 16,
              top: isTV ? 90 : insets.top + 60,
              width: 232,
              paddingVertical: 8,
              borderRadius: 16,
              backgroundColor: colors.surfaceContainerHigh,
              elevation: 8,
            }}>
            <TVFocusable
              hasTVPreferredFocus={isTV}
              accessibilityRole="button"
              accessibilityLabel="Edit metadata"
              onPress={() => setPicker(true)}
              style={{
                minHeight: 48,
                paddingHorizontal: 16,
                justifyContent: 'center',
              }}>
              <AppText style={{color: colors.onSurface}}>Edit metadata</AppText>
            </TVFocusable>
            {title.metadata && (
              <TVFocusable
                accessibilityRole="button"
                accessibilityLabel="Use folder and file names"
                onPress={() => {
                  update({metadata: undefined, useMetadataTitles: false});
                  onClose();
                }}
                style={{
                  minHeight: 48,
                  paddingHorizontal: 16,
                  justifyContent: 'center',
                }}>
                <AppText style={{color: colors.onSurface}}>
                  Use folder and file names
                </AppText>
              </TVFocusable>
            )}
          </TVFocusGuide>
        </View>
      )}
    </Modal>
  );
}
