import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  Text,
  TouchableOpacity,
  ToastAndroid,
  View,
  Modal,
  StyleSheet,
} from 'react-native';
import React, { useEffect, useRef } from 'react';
import { Stream } from '../lib/providers/types';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import LoadingIndicator from './ui/LoadingIndicator';
import RNReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { Clipboard } from 'react-native';
import { TextTrackType } from 'react-native-video';
import { settingsStorage } from '../lib/storage';
import { useM3Colors } from '../theme/M3PaletteContext';

export interface DownloadedSubtitleItem {
  id: string;
  title: string;
  language?: string;
  filePath?: string;
}

const formatQualityLabel = (quality?: string): string => {
  if (!quality) return '';
  const trimmed = quality.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'auto' || lower === '4k' || lower === 'uhd' || lower === 'hd') {
    return trimmed;
  }
  if (lower.endsWith('p')) {
    return trimmed;
  }
  if (/^\d+$/.test(trimmed)) {
    return `${trimmed}p`;
  }
  return trimmed;
};

type Props = {
  data: Stream[];
  loading: boolean;
  title?: string;
  showModal: boolean;
  setModal: (value: boolean) => void;
  onPressVideo: (item: any) => void;
  onPressExternalVideo?: (item: any) => void;
  onPressSubs: (item: any) => void;
  onPressExternalSubs?: (item: any) => void;
  error?: string | null;
  videoDownloaded?: boolean;
  downloadedServer?: string;
  onDeleteVideo?: () => void;
  downloadedSubtitles?: DownloadedSubtitleItem[];
  isSubDownloaded?: (subTitle: string) => boolean;
  onDeleteSub?: (subTitle: string) => void;
};
const DownloadBottomSheet = ({
  data,
  loading,
  showModal,
  setModal,
  title,
  onPressSubs,
  onPressExternalSubs,
  onPressVideo,
  onPressExternalVideo,
  error,
  videoDownloaded,
  downloadedServer,
  onDeleteVideo,
  downloadedSubtitles,
  isSubDownloaded,
  onDeleteSub,
}: Props) => {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const colors = useM3Colors();
  const [activeTab, setActiveTab] = React.useState<1 | 2>(1);
  const isAlwaysExternal =
    settingsStorage.getBool('alwaysExternalDownloader') === true;
  const streams = Array.isArray(data) ? data : [];

  const downloadedSubs = downloadedSubtitles || [];
  const hasDownloadedSubs = downloadedSubs.length > 0;

  const rawSubtitles = streams
    .flatMap(server => server.subtitles || [])
    .filter(Boolean);

  const streamSubtitles = rawSubtitles.filter(
    (sub, index, self) =>
      index ===
      self.findIndex(
        s =>
          s.uri === sub.uri ||
          (s.title === sub.title && s.language === sub.language),
      ),
  );

  const hasSubtitles = hasDownloadedSubs || streamSubtitles.length > 0;

  const handleCopy = (link: string) => {
    if (settingsStorage.isHapticFeedbackEnabled()) {
      RNReactNativeHapticFeedback.trigger('effectTick', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }
    Clipboard.setString(link);
    ToastAndroid.show('Link copied', ToastAndroid.SHORT);
  };

  useEffect(() => {
    if (showModal) {
      setActiveTab(1);
      bottomSheetRef.current?.snapToIndex?.(0);
    }
  }, [showModal]);

  const renderVideoTab = () => {
    if (videoDownloaded) {
      return (
        <View
          style={{
            alignItems: 'center',
            backgroundColor: colors.surfaceContainerHighest,
            borderColor: colors.outlineVariant,
            borderRadius: 16,
            borderWidth: 1,
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginVertical: 6,
            paddingHorizontal: 16,
            paddingVertical: 14,
          }}>
          <View style={{ alignItems: 'center', flexDirection: 'row', gap: 12 }}>
            <View
              style={{
                alignItems: 'center',
                backgroundColor: colors.primaryContainer,
                borderRadius: 12,
                height: 38,
                justifyContent: 'center',
                width: 38,
              }}>
              <MaterialCommunityIcons
                name="check-circle"
                size={22}
                color={colors.onPrimaryContainer}
              />
            </View>
            <View>
              <Text
                style={{
                  color: colors.onSurface,
                  fontSize: 15,
                  fontWeight: '700',
                }}>
                Video Downloaded
              </Text>
              {downloadedServer && (
                <Text
                  style={{
                    color: colors.onSurfaceVariant,
                    fontSize: 12,
                    marginTop: 2,
                  }}>
                  {downloadedServer}
                </Text>
              )}
            </View>
          </View>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => {
              onDeleteVideo?.();
              bottomSheetRef.current?.close?.();
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              alignItems: 'center',
              backgroundColor: colors.errorContainer,
              borderRadius: 12,
              height: 38,
              justifyContent: 'center',
              width: 38,
            }}>
            <MaterialCommunityIcons
              name="delete-outline"
              size={20}
              color={colors.onErrorContainer}
            />
          </TouchableOpacity>
        </View>
      );
    }

    if (loading) {
      return (
        <View style={{ alignItems: 'center', paddingVertical: 40 }}>
          <LoadingIndicator size={60} color={colors.primary} />
        </View>
      );
    }

    if (error && streams.length === 0) {
      return (
        <View style={{ alignItems: 'center', paddingVertical: 36 }}>
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={40}
            color={colors.error}
          />
          <Text
            style={{
              color: colors.error,
              fontSize: 14,
              fontWeight: '600',
              marginTop: 10,
              textAlign: 'center',
            }}>
            {error}
          </Text>
        </View>
      );
    }

    if (streams.length === 0) {
      return (
        <View style={{ alignItems: 'center', paddingVertical: 36 }}>
          <MaterialCommunityIcons
            name="cloud-off-outline"
            size={40}
            color={colors.onSurfaceVariant}
          />
          <Text
            style={{
              color: colors.onSurfaceVariant,
              fontSize: 14,
              marginTop: 10,
              textAlign: 'center',
            }}>
            No download servers available
          </Text>
        </View>
      );
    }

    return streams.map((item, index) => (
      <TouchableOpacity
        key={index}
        activeOpacity={0.7}
        style={{
          alignItems: 'center',
          backgroundColor: colors.surfaceContainerHighest,
          borderColor: colors.outlineVariant,
          borderRadius: 16,
          borderWidth: 1,
          flexDirection: 'row',
          gap: 10,
          justifyContent: 'space-between',
          marginVertical: 5,
          paddingHorizontal: 14,
          paddingVertical: 12,
        }}
        onPress={() => {
          if (isAlwaysExternal) {
            onPressExternalVideo?.(item);
          } else {
            onPressVideo(item);
          }
          bottomSheetRef.current?.close?.();
        }}>
        <View
          style={{
            alignItems: 'center',
            flex: 1,
            flexDirection: 'row',
            gap: 8,
          }}>
          <Text
            numberOfLines={1}
            style={{
              color: colors.onSurface,
              fontSize: 15,
              fontWeight: '600',
              flexShrink: 1,
            }}>
            {item.server}
          </Text>
          {item.quality ? (
            <View
              style={{
                backgroundColor: colors.secondaryContainer,
                borderRadius: 10,
                paddingHorizontal: 8,
                paddingVertical: 3,
              }}>
              <Text
                style={{
                  color: colors.onSecondaryContainer,
                  fontSize: 11,
                  fontWeight: '700',
                }}>
                {formatQualityLabel(item.quality)}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Action buttons */}
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 6 }}>
          {/* Copy Button */}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => handleCopy(item.link)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              alignItems: 'center',
              backgroundColor: colors.surfaceContainerHighest,
              borderRadius: 10,
              justifyContent: 'center',
              padding: 8,
            }}>
            <MaterialCommunityIcons
              name="content-copy"
              size={18}
              color={colors.onSurfaceVariant}
            />
          </TouchableOpacity>

          {/* External / Internal Button */}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => {
              if (isAlwaysExternal) {
                onPressVideo(item);
              } else {
                onPressExternalVideo?.(item);
              }
              bottomSheetRef.current?.close?.();
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              alignItems: 'center',
              backgroundColor: colors.primaryContainer,
              borderRadius: 10,
              justifyContent: 'center',
              padding: 8,
            }}>
            <MaterialCommunityIcons
              name={isAlwaysExternal ? 'download-outline' : 'open-in-new'}
              size={18}
              color={colors.onPrimaryContainer}
            />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    ));
  };

  const renderSubtitleTab = () => {
    if (loading) {
      return (
        <View style={{ alignItems: 'center', paddingVertical: 40 }}>
          <LoadingIndicator size={40} color={colors.primary} />
          <Text
            style={{
              color: colors.onSurfaceVariant,
              fontSize: 13,
              marginTop: 14,
            }}>
            Fetching subtitles…
          </Text>
        </View>
      );
    }

    if (!hasSubtitles) {
      return (
        <View style={{ alignItems: 'center', paddingVertical: 36 }}>
          <MaterialCommunityIcons
            name="subtitles-outline"
            size={40}
            color={colors.onSurfaceVariant}
          />
          <Text
            style={{
              color: colors.onSurfaceVariant,
              fontSize: 14,
              marginTop: 10,
              textAlign: 'center',
            }}>
            No subtitles available
          </Text>
        </View>
      );
    }

    return (
      <>
        {/* Downloaded Subtitles Section */}
        {downloadedSubs.length > 0 ? (
          <View style={{ marginBottom: 12 }}>
            <Text
              style={{
                color: colors.primary,
                fontSize: 12,
                fontWeight: '700',
                letterSpacing: 0.8,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
              Downloaded
            </Text>
            {downloadedSubs.map((sub, index) => (
              <View
                key={sub.id || index}
                style={{
                  alignItems: 'center',
                  backgroundColor: colors.surfaceContainerHighest,
                  borderColor: colors.outlineVariant,
                  borderRadius: 16,
                  borderWidth: 1,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  marginVertical: 4,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                }}>
                <View
                  style={{
                    alignItems: 'center',
                    flexDirection: 'row',
                    gap: 10,
                    flex: 1,
                  }}>
                  <MaterialCommunityIcons
                    name="check-circle"
                    size={20}
                    color={colors.primary}
                  />
                  <Text
                    numberOfLines={1}
                    style={{
                      color: colors.onSurface,
                      fontSize: 14,
                      fontWeight: '600',
                      flex: 1,
                    }}>
                    {sub.title}
                  </Text>
                </View>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => {
                    onDeleteSub?.(sub.title);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{
                    alignItems: 'center',
                    backgroundColor: colors.errorContainer,
                    borderRadius: 10,
                    height: 34,
                    justifyContent: 'center',
                    width: 34,
                  }}>
                  <MaterialCommunityIcons
                    name="delete-outline"
                    size={18}
                    color={colors.onErrorContainer}
                  />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        {/* Stream Subtitles Section */}
        {streamSubtitles.length > 0 ? (
          <View>
            {downloadedSubs.length > 0 ? (
              <Text
                style={{
                  color: colors.onSurfaceVariant,
                  fontSize: 12,
                  fontWeight: '700',
                  letterSpacing: 0.8,
                  marginBottom: 6,
                  textTransform: 'uppercase',
                }}>
                Available
              </Text>
            ) : null}
            {streamSubtitles.map((sub, index) => {
              const subDownloaded = isSubDownloaded
                ? isSubDownloaded(sub.title)
                : false;
              return (
                <View
                  key={index}
                  style={{
                    alignItems: 'center',
                    backgroundColor: colors.surfaceContainerHighest,
                    borderColor: colors.outlineVariant,
                    borderRadius: 16,
                    borderWidth: 1,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    marginVertical: 4,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                  }}>
                  <View
                    style={{
                      alignItems: 'center',
                      flexDirection: 'row',
                      gap: 8,
                      flex: 1,
                    }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: colors.onSurface,
                        fontSize: 14,
                        fontWeight: '600',
                        flex: 1,
                      }}>
                      {sub.title}
                    </Text>
                    {sub.type ? (
                      <View
                        style={{
                          backgroundColor: colors.secondaryContainer,
                          borderRadius: 8,
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                        }}>
                        <Text
                          style={{
                            color: colors.onSecondaryContainer,
                            fontSize: 10,
                            fontWeight: '700',
                          }}>
                          {sub.type.toUpperCase()}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <View
                    style={{
                      alignItems: 'center',
                      flexDirection: 'row',
                      gap: 6,
                    }}>
                    {/* Copy Subtitle Link Button */}
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => handleCopy(sub.uri)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={{
                        alignItems: 'center',
                        backgroundColor: colors.surfaceContainerHighest,
                        borderRadius: 10,
                        justifyContent: 'center',
                        padding: 8,
                      }}>
                      <MaterialCommunityIcons
                        name="content-copy"
                        size={18}
                        color={colors.onSurfaceVariant}
                      />
                    </TouchableOpacity>

                    {/* External Subtitle Button */}
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => {
                        onPressExternalSubs?.({
                          link: sub.uri,
                          type: TextTrackType.VTT,
                          title: sub.title,
                        });
                        bottomSheetRef.current?.close?.();
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={{
                        alignItems: 'center',
                        backgroundColor: colors.surfaceContainerHighest,
                        borderRadius: 10,
                        justifyContent: 'center',
                        padding: 8,
                      }}>
                      <MaterialCommunityIcons
                        name="open-in-new"
                        size={18}
                        color={colors.onSurfaceVariant}
                      />
                    </TouchableOpacity>

                    {/* Download / Delete Subtitle Button */}
                    {subDownloaded ? (
                      <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={() => {
                          onDeleteSub?.(sub.title);
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={{
                          alignItems: 'center',
                          backgroundColor: colors.errorContainer,
                          borderRadius: 10,
                          height: 34,
                          justifyContent: 'center',
                          width: 34,
                        }}>
                        <MaterialCommunityIcons
                          name="delete-outline"
                          size={18}
                          color={colors.onErrorContainer}
                        />
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={() => {
                          onPressSubs({
                            link: sub.uri,
                            type: TextTrackType.VTT,
                            title: sub.title,
                          });
                          bottomSheetRef.current?.close?.();
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={{
                          alignItems: 'center',
                          backgroundColor: colors.primaryContainer,
                          borderRadius: 10,
                          height: 34,
                          justifyContent: 'center',
                          width: 34,
                        }}>
                        <MaterialCommunityIcons
                          name="download"
                          size={18}
                          color={colors.onPrimaryContainer}
                        />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        ) : downloadedSubs.length > 0 ? (
          <Text
            style={{
              color: colors.onSurfaceVariant,
              fontSize: 13,
              textAlign: 'center',
              marginTop: 20,
            }}>
            No extra subtitles available
          </Text>
        ) : null}
      </>
    );
  };

  if (!showModal) {
    return null;
  }

  return (
    <Modal
      visible={showModal}
      transparent
      animationType="none"
      onRequestClose={() => setModal(false)}
      statusBarTranslucent>
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <BottomSheet
          ref={bottomSheetRef}
          index={0}
          enablePanDownToClose
          enableDynamicSizing={false}
          snapPoints={['50%', '85%']}
          backdropComponent={backdropProps => (
            <BottomSheetBackdrop
              {...backdropProps}
              disappearsOnIndex={-1}
              appearsOnIndex={0}
              pressBehavior="close"
            />
          )}
          backgroundStyle={{ backgroundColor: colors.surfaceContainerLow }}
          handleIndicatorStyle={{ backgroundColor: colors.outline }}
          onChange={index => {
            if (index === -1) {
              setModal(false);
            }
          }}
          onClose={() => setModal(false)}>
          <View
            style={{
              backgroundColor: colors.surfaceContainerLow,
              flex: 1,
              paddingHorizontal: 16,
              paddingTop: 8,
            }}>
            {title && (
              <Text
                style={{
                  color: colors.onSurface,
                  fontSize: 20,
                  fontWeight: '700',
                  textAlign: 'center',
                }}>
                {title}
              </Text>
            )}
            {hasSubtitles && (
              <View
                style={{
                  alignSelf: 'center',
                  borderBottomColor: colors.outlineVariant,
                  borderBottomWidth: 1,
                  flexDirection: 'row',
                  justifyContent: 'center',
                  marginBottom: 12,
                }}>
                {([
                  { label: 'Video', value: 1 as const },
                  { label: 'Subtitle', value: 2 as const },
                ] as const).map(tab => {
                  const selected = activeTab === tab.value;
                  return (
                    <TouchableOpacity
                      key={tab.value}
                      onPress={() => setActiveTab(tab.value)}
                      style={{
                        borderBottomColor: selected
                          ? colors.primary
                          : 'transparent',
                        borderBottomWidth: 2,
                        marginBottom: -1,
                        paddingHorizontal: 24,
                        paddingVertical: 10,
                      }}>
                      <Text
                        style={{
                          color: selected
                            ? colors.primary
                            : colors.onSurfaceVariant,
                          fontSize: 14,
                          fontWeight: selected ? '700' : '500',
                        }}>
                        {tab.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <BottomSheetScrollView
              contentContainerStyle={{
                paddingBottom: 36,
                paddingTop: hasSubtitles ? 0 : 12,
              }}
              showsVerticalScrollIndicator={false}>
              {activeTab === 1 ? renderVideoTab() : renderSubtitleTab()}
            </BottomSheetScrollView>
          </View>
        </BottomSheet>
      </GestureHandlerRootView>
    </Modal>
  );
};

export default DownloadBottomSheet;
