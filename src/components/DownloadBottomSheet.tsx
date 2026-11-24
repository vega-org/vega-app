import {usesExternalApp} from '../lib/externalApps';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  Text,
  TouchableOpacity,
  ToastAndroid,
  View,
  Modal,
  ScrollView,
  StyleSheet,
  UIManager,
  findNodeHandle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import React, { useEffect, useMemo, useRef } from 'react';
import { Stream } from '../lib/providers/types';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetSectionList,
} from '@gorhom/bottom-sheet';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import LoadingIndicator from './ui/LoadingIndicator';
import RNReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { Clipboard } from 'react-native';
import { TextTrackType } from 'react-native-video';
import { settingsStorage } from '../lib/storage';
import { useM3Colors } from '../theme/M3PaletteContext';
import { isTV } from '../lib/tv';
import { TVFocusable, TVFocusGuide } from './tv';
import SearchSubtitles, { FoundSubtitle } from './SearchSubtitles';

const NativeTouchableOpacity = TouchableOpacity;

type SheetButtonProps = React.ComponentProps<typeof TouchableOpacity> & {
  hasTVPreferredFocus?: boolean;
  focusBorderRadius?: number;
};

const SheetButton = ({
  activeOpacity,
  hitSlop,
  style,
  hasTVPreferredFocus,
  focusBorderRadius = 12,
  onPress,
  onLongPress,
  accessibilityLabel,
  disabled,
  testID,
  children,
  ...props
}: SheetButtonProps) => {
  if (isTV) {
    return (
      <TVFocusable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        disabled={disabled}
        testID={testID}
        style={style as StyleProp<ViewStyle>}
        borderRadius={focusBorderRadius}
        focusScale={1}
        hasTVPreferredFocus={hasTVPreferredFocus}
        onPress={() => onPress?.(undefined as any)}
        onLongPress={() => onLongPress?.(undefined as any)}>
        {children}
      </TVFocusable>
    );
  }

  return (
    <NativeTouchableOpacity
      {...props}
      activeOpacity={activeOpacity}
      hitSlop={hitSlop}
      style={style}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      testID={testID}>
      {children}
    </NativeTouchableOpacity>
  );
};

const SheetRow = ({children, style, onPress}: {
  children: React.ReactNode;
  style: StyleProp<ViewStyle>;
  onPress: () => void;
}) => isTV ? (
  <View style={style}>{children}</View>
) : (
  <NativeTouchableOpacity activeOpacity={0.7} style={style} onPress={onPress}>
    {children}
  </NativeTouchableOpacity>
);

const SheetRowMain = ({children, style, onPress, label, preferred, focusRef}: {
  children: React.ReactNode;
  style: StyleProp<ViewStyle>;
  onPress: () => void;
  label: string;
  preferred: boolean;
  focusRef?: React.Ref<View>;
}) => isTV ? (
  <TVFocusable
    ref={focusRef}
    accessibilityRole="button"
    accessibilityLabel={label}
    hasTVPreferredFocus={preferred}
    borderRadius={12}
    focusScale={1}
    style={style}
    onPress={onPress}>
    {children}
  </TVFocusable>
) : <View style={style}>{children}</View>;

export interface DownloadedSubtitleItem {
  id: string;
  title: string;
  language?: string;
  filePath?: string;
}

type AvailableSubtitle = NonNullable<Stream['subtitles']>[number];
type SubtitleItem = AvailableSubtitle | DownloadedSubtitleItem;

type SubtitleSection = {
  key: 'downloaded' | 'available';
  title?: string;
  data: SubtitleItem[];
};

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
  /** Initial OpenSubtitles query, such as an IMDb ID or title. */
  subtitleSearchQuery?: string;
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
  subtitleSearchQuery,
}: Props) => {
  const bottomSheetRef = useRef<BottomSheet>(null);
  // The sheet only caps its content height after it measures itself. When
  // cached streams render on the first frame, the list lays out at its full
  // content height and has nothing to scroll, so cap it from the modal size.
  const [sheetContainerHeight, setSheetContainerHeight] = React.useState(0);
  const tvCloseRef = useRef<View>(null);
  const tvFirstRowRef = useRef<View>(null);
  const closeSheet = () => {
    if (isTV) setModal(false);
    else bottomSheetRef.current?.close?.();
  };
  const colors = useM3Colors();
  const [activeTab, setActiveTab] = React.useState<1 | 2>(1);
  const [searchQuery, setSearchQuery] = React.useState(subtitleSearchQuery ?? '');
  useEffect(() => {
    setSearchQuery(subtitleSearchQuery ?? '');
  }, [subtitleSearchQuery]);
  const isAlwaysExternal =
    usesExternalApp('downloader');
  const streams = useMemo(() => Array.isArray(data) ? data : [], [data]);

  const downloadedSubs = downloadedSubtitles || [];
  const hasDownloadedSubs = downloadedSubs.length > 0;

  const streamSubtitles = useMemo(() => {
    const seenUris = new Set<string>();
    const languagesByTitle = new Map<string, Set<AvailableSubtitle['language']>>();
    const unique: AvailableSubtitle[] = [];

    for (const stream of streams) {
      for (const sub of stream.subtitles ?? []) {
        if (!sub) continue;

        const languages =
          languagesByTitle.get(sub.title) ?? new Set<AvailableSubtitle['language']>();
        if (!seenUris.has(sub.uri) && !languages.has(sub.language)) {
          unique.push(sub);
        }
        // Earlier subtitles count as duplicates even when they were omitted.
        seenUris.add(sub.uri);
        languages.add(sub.language);
        languagesByTitle.set(sub.title, languages);
      }
    }

    return unique;
  }, [streams]);

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
          <SheetButton
            accessibilityLabel="Delete downloaded video"
            activeOpacity={0.7}
            onPress={() => {
              onDeleteVideo?.();
              closeSheet();
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
          </SheetButton>
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
      <SheetRow
        key={index}
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
          closeSheet();
        }}>
        <SheetRowMain
          label={`Download ${item.server || 'Unknown Server'}${item.quality ? `, ${formatQualityLabel(item.quality)}` : ''}`}
          preferred={!hasSubtitles && index === 0}
          focusRef={index === 0 ? tvFirstRowRef : undefined}
          onPress={() => {
            if (isAlwaysExternal) {
              onPressExternalVideo?.(item);
            } else {
              onPressVideo(item);
            }
            closeSheet();
          }}
          style={{
            flex: 1,
            justifyContent: 'center',
            marginRight: 10,
            minHeight: isTV ? 52 : undefined,
          }}>
          <Text
            numberOfLines={1}
            style={{
              color: colors.onSurface,
              fontSize: 15,
              fontWeight: '600',
            }}>
            {item.server || 'Unknown Server'}
          </Text>
          {(() => {
            const rawTags: string[] = Array.isArray(item.tags)
              ? item.tags
              : typeof item.tag === 'string'
              ? [item.tag]
              : [];
            const tags = rawTags
              .map(t => (typeof t === 'string' ? t.trim() : ''))
              .filter(
                t =>
                  Boolean(t) &&
                  t.toLowerCase() !== item.quality?.trim().toLowerCase(),
              );

            const hasQuality = Boolean(item.quality);
            const hasTags = tags.length > 0;

            if (!hasQuality && !hasTags) {
              return null;
            }

            return (
              <View
                style={{
                  alignItems: 'center',
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: 6,
                  marginTop: 4,
                }}>
                {item.quality ? (
                  <View
                    style={{
                      backgroundColor: colors.secondaryContainer,
                      borderRadius: 8,
                      paddingHorizontal: 7,
                      paddingVertical: 2,
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
                {tags.map((t, tIdx) => (
                  <View
                    key={tIdx}
                    style={{
                      backgroundColor: colors.surfaceContainerHighest,
                      borderRadius: 8,
                      paddingHorizontal: 7,
                      paddingVertical: 2,
                    }}>
                    <Text
                      style={{
                        color: colors.onSurfaceVariant,
                        fontSize: 11,
                        fontWeight: '700',
                      }}>
                      {t.toUpperCase()}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })()}
        </SheetRowMain>

        {/* Action buttons */}
        <View
          style={{
            alignItems: 'center',
            flexDirection: 'row',
            gap: 6,
            flexShrink: 0,
          }}>
          {/* Copy Button */}
          <SheetButton
            accessibilityLabel={`Copy link for ${item.server || 'Unknown Server'}`}
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
          </SheetButton>

          {/* External / Internal Button */}
          <SheetButton
            accessibilityLabel={`${isAlwaysExternal ? 'Download in Vega' : 'Open externally'}: ${item.server || 'Unknown Server'}`}
            activeOpacity={0.7}
            onPress={() => {
              if (isAlwaysExternal) {
                onPressVideo(item);
              } else {
                onPressExternalVideo?.(item);
              }
              closeSheet();
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
              name={isAlwaysExternal ? 'download-outline' : 'open-in-new'}
              size={18}
              color={colors.onSurfaceVariant}
            />
          </SheetButton>
        </View>
      </SheetRow>
    ));
  };

  const renderSubtitlePlaceholder = () => {
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

    return null;
  };

  const renderDownloadedSubtitle = (sub: DownloadedSubtitleItem) => (
    <View
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
      <SheetButton
        accessibilityLabel={`Delete downloaded subtitle ${sub.title}`}
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
      </SheetButton>
    </View>
  );

  const renderAvailableSubtitle = (sub: AvailableSubtitle) => {
    const subDownloaded = isSubDownloaded
      ? isSubDownloaded(sub.title)
      : false;
    const SubtitleRow = subDownloaded ? View : SheetButton;
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
          marginVertical: 4,
          paddingRight: 14,
        }}>
        <SubtitleRow
          {...(!subDownloaded && {
            accessibilityLabel: `Download subtitle ${sub.title}`,
            activeOpacity: 0.7,
            onPress: () => {
              onPressSubs({
                link: sub.uri,
                type: TextTrackType.VTT,
                title: sub.title,
              });
              closeSheet();
            },
          })}
          style={{
            flex: 1,
            justifyContent: 'center',
            marginRight: 10,
            paddingLeft: 14,
            paddingVertical: 8,
            minHeight: 56,
          }}>
          <Text
            numberOfLines={1}
            style={{
              color: colors.onSurface,
              fontSize: 15,
              fontWeight: '600',
            }}>
            {sub.title}
          </Text>
          {sub.type ? (
            <View
              style={{
                alignSelf: 'flex-start',
                backgroundColor: colors.secondaryContainer,
                borderRadius: 8,
                marginTop: 4,
                paddingHorizontal: 7,
                paddingVertical: 2,
              }}>
              <Text
                style={{
                  color: colors.onSecondaryContainer,
                  fontSize: 11,
                  fontWeight: '700',
                }}>
                {sub.type.toUpperCase()}
              </Text>
            </View>
          ) : null}
        </SubtitleRow>

        <View
          style={{
            alignItems: 'center',
            flexDirection: 'row',
            gap: 6,
            flexShrink: 0,
          }}>
          {/* Copy Subtitle Link Button */}
          <SheetButton
            accessibilityLabel={`Copy subtitle link for ${sub.title}`}
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
          </SheetButton>

          {/* External Subtitle Button */}
          <SheetButton
            accessibilityLabel={`Open subtitle externally: ${sub.title}`}
            activeOpacity={0.7}
            onPress={() => {
              onPressExternalSubs?.({
                link: sub.uri,
                type: TextTrackType.VTT,
                title: sub.title,
              });
              closeSheet();
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
          </SheetButton>

          {/* Delete downloaded subtitle */}
          {subDownloaded ? (
            <SheetButton
              accessibilityLabel={`Delete downloaded subtitle ${sub.title}`}
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
            </SheetButton>
          ) : null}
        </View>
      </View>
    );
  };

  const renderSubtitleTab = () => {
    const sections: SubtitleSection[] = [];
    if (!loading) {
      if (hasDownloadedSubs) {
        sections.push({key: 'downloaded', title: 'Downloaded', data: downloadedSubs});
      }
      if (streamSubtitles.length > 0) {
        sections.push({
          key: 'available',
          title: hasDownloadedSubs ? 'Available' : undefined,
          data: streamSubtitles,
        });
      }
    }

    const renderItem = (item: SubtitleItem) =>
      'uri' in item ? renderAvailableSubtitle(item) : renderDownloadedSubtitle(item);
    const itemKey = (item: SubtitleItem, index: number) =>
      'uri' in item ? item.uri : item.id || String(index);
    const renderHeader = ({key, title}: SubtitleSection) => title ? (
      <Text
        style={{
          color: key === 'downloaded' ? colors.primary : colors.onSurfaceVariant,
          fontSize: 12,
          fontWeight: '700',
          letterSpacing: 0.8,
          marginBottom: 6,
          marginTop: key === 'available' ? 12 : 0,
          textTransform: 'uppercase',
        }}>
        {title}
      </Text>
    ) : null;
    const searchRow = (
      <View style={{marginBottom: 8}}>
        <SearchSubtitles
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onAddSubtitle={(track: FoundSubtitle) => {
            if (!track.uri) return;
            onPressSubs({
              link: track.uri,
              type: TextTrackType.SUBRIP,
              title: track.title?.trim() || track.language || 'Subtitle',
            });
            closeSheet();
          }}
          renderTrigger={open => (
            <SheetButton
              accessibilityLabel="Search subtitles online"
              activeOpacity={0.7}
              onPress={open}
              style={{
                alignItems: 'center',
                backgroundColor: colors.surfaceContainerHighest,
                borderColor: colors.outlineVariant,
                borderRadius: 16,
                borderWidth: 1,
                flexDirection: 'row',
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
              }}>
              <MaterialCommunityIcons
                name="earth"
                size={22}
                color={colors.onSurfaceVariant}
              />
              <View style={{flex: 1}}>
                <Text
                  style={{
                    color: colors.onSurface,
                    fontSize: 14,
                    fontWeight: '700',
                  }}>
                  Search subtitles online
                </Text>
                <Text
                  style={{
                    color: colors.onSurfaceVariant,
                    fontSize: 12,
                  }}>
                  Download subtitles for offline playback
                </Text>
              </View>
            </SheetButton>
          )}
        />
      </View>
    );
    const placeholder = renderSubtitlePlaceholder();
    const footer = !loading && hasDownloadedSubs && streamSubtitles.length === 0 ? (
      <Text
        style={{
          color: colors.onSurfaceVariant,
          fontSize: 13,
          textAlign: 'center',
          marginTop: 20,
        }}>
        No extra subtitles available
      </Text>
    ) : null;

    if (isTV) {
      // Keep every row available to the TV's native D-pad focus traversal.
      return (
        <ScrollView
          focusable={false}
          accessible={false}
          contentContainerStyle={{paddingBottom: 24}}>
          {searchRow}
          {placeholder}
          {sections.map(section => (
            <React.Fragment key={section.key}>
              {renderHeader(section)}
              {section.data.map((item, index) => (
                <React.Fragment key={itemKey(item, index)}>
                  {renderItem(item)}
                </React.Fragment>
              ))}
            </React.Fragment>
          ))}
          {footer}
        </ScrollView>
      );
    }

    return (
      <BottomSheetSectionList<SubtitleItem, SubtitleSection>
        sections={sections}
        keyExtractor={itemKey}
        renderItem={({item}) => renderItem(item)}
        renderSectionHeader={({section}) => renderHeader(section)}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={searchRow}
        ListEmptyComponent={placeholder}
        ListFooterComponent={footer}
        contentContainerStyle={{paddingBottom: 36, paddingTop: hasSubtitles ? 0 : 12}}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={16}
        windowSize={5}
      />
    );
  };

  if (!showModal) {
    return null;
  }

  if (isTV) {
    const closePreferred = hasSubtitles || loading || streams.length === 0;
    return (
      <Modal
        visible
        transparent
        animationType="none"
        onRequestClose={() => setModal(false)}
        onShow={() => {
          setTimeout(() => {
            // Same target as hasTVPreferredFocus: the first source, else Close.
            const handle =
              findNodeHandle(closePreferred ? null : tvFirstRowRef.current) ??
              findNodeHandle(tvCloseRef.current);
            if (handle) UIManager.dispatchViewManagerCommand(handle, 'requestTVFocus', []);
          }, 250);
        }}>
        <View style={{flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 0, 0, 0.78)'}}>
          <TVFocusGuide
            autoFocus
            trapFocusLeft
            trapFocusRight
            trapFocusUp
            trapFocusDown
            style={{
              backgroundColor: colors.surfaceContainerLow,
              borderColor: colors.outlineVariant,
              borderRadius: 24,
              borderWidth: 1,
              maxHeight: '85%',
              minHeight: 240,
              padding: 24,
              width: '80%',
            }}>
            <TVFocusable
              ref={tvCloseRef}
              accessibilityRole="button"
              accessibilityLabel="Close downloads"
              hasTVPreferredFocus={closePreferred}
              focusScale={1}
              onPress={() => setModal(false)}
              style={{alignSelf: 'flex-end', alignItems: 'center', justifyContent: 'center', minHeight: 48, minWidth: 100, marginBottom: 12}}>
              <Text style={{color: colors.onSurface, fontSize: 18}}>Close</Text>
            </TVFocusable>
            {(
              <View style={{flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 12}}>
                {([{label: 'Video', value: 1 as const}, {label: 'Subtitle', value: 2 as const}] as const).map(tab => (
                  <SheetButton
                    key={tab.value}
                    accessibilityLabel={`${tab.label} download sources`}
                    onPress={() => setActiveTab(tab.value)}
                    style={{backgroundColor: activeTab === tab.value ? colors.secondaryContainer : colors.surfaceContainerHighest, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12}}>
                    <Text style={{color: activeTab === tab.value ? colors.onSecondaryContainer : colors.onSurface, fontSize: 16}}>{tab.label}</Text>
                  </SheetButton>
                ))}
              </View>
            )}
            {activeTab === 1 ? (
              <ScrollView
                focusable={false}
                accessible={false}
                contentContainerStyle={{paddingBottom: 24}}>
                {renderVideoTab()}
              </ScrollView>
            ) : renderSubtitleTab()}
          </TVFocusGuide>
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      visible={showModal}
      transparent
      animationType="none"
      onRequestClose={() => setModal(false)}
      statusBarTranslucent>
      <GestureHandlerRootView
        style={StyleSheet.absoluteFill}
        onLayout={event => setSheetContainerHeight(event.nativeEvent.layout.height)}>
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
          <TVFocusGuide
            autoFocus={isTV}
            trapFocusLeft={isTV}
            trapFocusRight={isTV}
            trapFocusUp={isTV}
            trapFocusDown={isTV}
            style={{
              backgroundColor: colors.surfaceContainerLow,
              // Height of the 85% snap point minus the 24 px handle.
              ...(sheetContainerHeight > 0
                ? {height: sheetContainerHeight * 0.85 - 24}
                : {flex: 1}),
              paddingHorizontal: 16,
              paddingTop: 8,
            }}>
            {isTV && (
              <SheetButton
                accessibilityLabel="Close downloads"
                hasTVPreferredFocus={loading || streams.length === 0}
                onPress={() => setModal(false)}
                style={{
                  alignSelf: 'flex-end',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 44,
                  minWidth: 80,
                  marginBottom: 8,
                }}>
                <Text style={{color: colors.onSurface, fontSize: 16}}>Close</Text>
              </SheetButton>
            )}
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
            {(
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
                    <SheetButton
                      key={tab.value}
                      accessibilityLabel={`${tab.label} download sources`}
                      hasTVPreferredFocus={tab.value === 1}
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
                    </SheetButton>
                  );
                })}
              </View>
            )}
            {activeTab === 1 ? (
              <BottomSheetScrollView
                contentContainerStyle={{
                  paddingBottom: 36,
                  paddingTop: hasSubtitles ? 0 : 12,
                }}
                showsVerticalScrollIndicator={false}>
                {renderVideoTab()}
              </BottomSheetScrollView>
            ) : renderSubtitleTab()}
          </TVFocusGuide>
        </BottomSheet>
      </GestureHandlerRootView>
    </Modal>
  );
};

export default DownloadBottomSheet;
