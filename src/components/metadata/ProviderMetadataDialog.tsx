import React, {useEffect, useState} from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {isTV} from '../../lib/tv/constants';
import {useM3Colors} from '../../theme/M3PaletteContext';
import type {Info} from '../../lib/providers/types';
import useMetadataOverrideStore, {
  metadataOverrideKey,
} from '../../lib/zustand/metadataOverrideStore';
import AppText from '../ui/Text';
import {TVFocusable, TVFocusGuide} from '../tv';
import MetadataEpisodeSwitch from './MetadataEpisodeSwitch';
import {MetadataPicker} from './MetadataPicker';

export default function ProviderMetadataDialog({
  visible,
  onClose,
  info,
  provider,
  link,
  onSearchTitle,
}: {
  visible: boolean;
  onClose: () => void;
  info: Info;
  provider: string;
  link: string;
  onSearchTitle?: () => void;
}) {
  const colors = useM3Colors();
  const insets = useSafeAreaInsets();
  const [picker, setPicker] = useState(false);
  const metadata = useMetadataOverrideStore(
    state => state.overrides[metadataOverrideKey(provider, link)],
  );
  const [episodeMetadata, setEpisodeMetadata] = useState(false);
  useEffect(() => {
    if (visible) setEpisodeMetadata(metadata?.useEpisodeMetadata === true);
  }, [visible, metadata?.useEpisodeMetadata]);
  useEffect(() => {
    if (!visible) setPicker(false);
  }, [visible]);
  const close = () => {
    setPicker(false);
    onClose();
  };
  return (
    <Modal
      visible={visible}
      transparent={!picker}
      animationType="fade"
      onRequestClose={() => (picker ? setPicker(false) : close())}>
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
            options={
              <MetadataEpisodeSwitch
                value={episodeMetadata}
                onChange={enabled => {
                  setEpisodeMetadata(enabled);
                  if (metadata)
                    useMetadataOverrideStore
                      .getState()
                      .setMetadata(provider, link, {
                        ...metadata,
                        useEpisodeMetadata: enabled,
                      });
                }}
              />
            }
            title={{
              id: link,
              rootUri: '',
              folderUri: '',
              name: info.title,
              useMetadataTitles: true,
              episodes: [
                {
                  uri: '',
                  name: '',
                  folder: '',
                  episode: info.type === 'series' ? 1 : undefined,
                },
              ],
              metadata:
                metadata ||
                (info.imdbId
                  ? {
                      imdbId: info.imdbId,
                      title: info.title,
                      type: info.type === 'movie' ? 'movie' : 'series',
                    }
                  : undefined),
            }}
            onBack={() => setPicker(false)}
            onChoose={value => {
              useMetadataOverrideStore
                .getState()
                .setMetadata(provider, link, {
                  ...value,
                  ...(episodeMetadata ? {useEpisodeMetadata: true} : {}),
                });
              close();
            }}
          />
        </KeyboardAvoidingView>
      ) : (
        <View style={{flex: 1}}>
          <Pressable
            accessibilityLabel="Dismiss more options"
            focusable={false}
            onPress={close}
            style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0}}
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
              width: metadata ? 232 : 192,
              paddingVertical: 8,
              borderRadius: 16,
              backgroundColor: colors.surfaceContainerHigh,
              elevation: 8,
              shadowColor: '#000',
              shadowOpacity: 0.2,
              shadowRadius: 12,
              shadowOffset: {width: 0, height: 4},
            }}>
            {onSearchTitle && (
              <TVFocusable
                hasTVPreferredFocus={isTV}
                borderRadius={10}
                accessibilityRole="button"
                accessibilityLabel="Search title"
                onPress={() => {
                  close();
                  onSearchTitle();
                }}
                style={{
                  minHeight: 48,
                  paddingHorizontal: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                }}>
                <MaterialCommunityIcons
                  name="magnify"
                  size={20}
                  color={colors.onSurface}
                />
                <AppText
                  style={{
                    color: colors.onSurface,
                    fontSize: 14,
                    fontWeight: '400',
                    letterSpacing: 0,
                    flex: 1,
                  }}>
                  Search
                </AppText>
              </TVFocusable>
            )}
            <TVFocusable
              hasTVPreferredFocus={isTV && !onSearchTitle}
              borderRadius={10}
              accessibilityRole="button"
              accessibilityLabel="Edit metadata"
              onPress={() => setPicker(true)}
              style={{
                minHeight: 48,
                paddingHorizontal: 16,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              }}>
              <MaterialCommunityIcons
                name="pencil-outline"
                size={20}
                color={colors.onSurface}
              />
              <AppText
                style={{
                  color: colors.onSurface,
                  fontSize: 14,
                  fontWeight: '400',
                  letterSpacing: 0,
                  flex: 1,
                }}>
                Edit metadata
              </AppText>
            </TVFocusable>
            {metadata && (
              <TVFocusable
                borderRadius={10}
                accessibilityRole="button"
                accessibilityLabel="Use provider metadata"
                onPress={() => {
                  useMetadataOverrideStore
                    .getState()
                    .setMetadata(provider, link);
                  close();
                }}
                style={{
                  minHeight: 48,
                  paddingHorizontal: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                }}>
                <MaterialCommunityIcons
                  name="restore"
                  size={20}
                  color={colors.onSurface}
                />
                <AppText
                  style={{
                    color: colors.onSurface,
                    fontSize: 14,
                    fontWeight: '400',
                    letterSpacing: 0,
                    flex: 1,
                  }}>
                  Use provider metadata
                </AppText>
              </TVFocusable>
            )}
          </TVFocusGuide>
        </View>
      )}
    </Modal>
  );
}
