import {SettingsSearchScrollView} from '../../components/ui/SettingsSearchTarget';
import {useFocusEffect} from '@react-navigation/native';
import {
  View,
  Modal,
  Pressable,
  BackHandler,
} from 'react-native';
import React, {useState, useCallback} from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {settingsStorage} from '../../lib/storage';
import SettingsRow from '../../components/ui/SettingsRow';
import SettingsSliderRow from '../../components/ui/SettingsSliderRow';
import SettingsSection from '../../components/ui/SettingsSection';
import AppText from '../../components/ui/Text';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import {isTV} from '../../lib/tv';

const FONT_OPTIONS = [
  {id: 'default', name: 'Default (System)', fontFam: undefined},
  {id: 'sans-serif', name: 'Sans-Serif', fontFam: 'sans-serif'},
  {id: 'serif', name: 'Serif', fontFam: 'serif'},
  {id: 'monospace', name: 'Monospace', fontFam: 'monospace'},
  {id: 'casual', name: 'Casual', fontFam: 'sans-serif-condensed'},
  {id: 'cursive', name: 'Cursive', fontFam: 'cursive'},
] as const;

const COLOR_OPTIONS = [
  {color: '#FFFFFF', name: 'White'},
  {color: '#FFFF00', name: 'Yellow'},
  {color: '#00FFFF', name: 'Cyan'},
  {color: '#00FF00', name: 'Green'},
  {color: '#FF00FF', name: 'Magenta'},
  {color: '#FFD700', name: 'Gold'},
  {color: '#CCCCCC', name: 'Light Gray'},
] as const;

const EDGE_OPTIONS = [
  {
    id: 'outline',
    name: 'Outline (Stroke)',
    description: 'Crisp outline border around text',
  },
  {
    id: 'dropShadow',
    name: 'Drop Shadow',
    description: 'Soft shadow beneath text',
  },
  {
    id: 'raised',
    name: 'Raised',
    description: 'Embossed highlight with depth',
  },
  {
    id: 'depressed',
    name: 'Depressed',
    description: 'Inset bevel depth shadow',
  },
  {
    id: 'none',
    name: 'None',
    description: 'Flat text without edge effects',
  },
] as const;

const EDGE_COLOR_OPTIONS = [
  {color: '#000000', name: 'Black (Default)'},
  {color: '#222222', name: 'Dark Gray'},
  {color: '#555555', name: 'Medium Gray'},
  {color: '#FFFFFF', name: 'White'},
  {color: '#FF0000', name: 'Red'},
  {color: '#0000FF', name: 'Blue'},
  {color: '#FFFF00', name: 'Yellow'},
] as const;

const SubtitlePreference = ({navigation}: any) => {
  const colors = useM3Colors();

  const [fontSize, setFontSize] = useState(
    settingsStorage.getSubtitleFontSize(),
  );
  const [opacity, setOpacity] = useState(settingsStorage.getSubtitleOpacity());
  const [textOpacity, setTextOpacity] = useState(
    settingsStorage.getSubtitleTextOpacity(),
  );
  const [bottomElevation, setBottomElevation] = useState(
    settingsStorage.getSubtitleBottomPadding(),
  );
  const [textColor, setTextColor] = useState(
    settingsStorage.getSubtitleTextColor(),
  );
  const [fontFamily, setFontFamily] = useState(
    settingsStorage.getSubtitleFontFamily(),
  );
  const [edgeType, setEdgeType] = useState(
    settingsStorage.getSubtitleEdgeType(),
  );
  const [edgeColor, setEdgeColor] = useState(
    settingsStorage.getSubtitleEdgeColor(),
  );
  const [outlineWidth, setOutlineWidth] = useState(
    settingsStorage.getSubtitleOutlineWidth(),
  );
  const [previewBg, setPreviewBg] = useState<'dark' | 'light'>('dark');

  const [fontModalVisible, setFontModalVisible] = useState(false);
  const [colorModalVisible, setColorModalVisible] = useState(false);
  const [edgeModalVisible, setEdgeModalVisible] = useState(false);
  const [edgeColorModalVisible, setEdgeColorModalVisible] = useState(false);

  // Register only while this screen is focused. A hidden screen in a
  // mounted tab or stack must not swallow back presses.
  useFocusEffect(
    useCallback(() => {
      if (!isTV) {
        return;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (fontModalVisible) {
          setFontModalVisible(false);
          return true;
        }
        if (colorModalVisible) {
          setColorModalVisible(false);
          return true;
        }
        if (edgeModalVisible) {
          setEdgeModalVisible(false);
          return true;
        }
        if (edgeColorModalVisible) {
          setEdgeColorModalVisible(false);
          return true;
        }
        if (navigation?.canGoBack?.()) {
          navigation.goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [
      fontModalVisible,
      colorModalVisible,
      edgeModalVisible,
      edgeColorModalVisible,
      navigation,
    ]),
  );

  const handleSelectFont = (fontId: string) => {
    settingsStorage.setSubtitleFontFamily(fontId);
    setFontFamily(fontId);
    setFontModalVisible(false);
  };

  const handleSelectColor = (colorHex: string) => {
    settingsStorage.setSubtitleTextColor(colorHex);
    setTextColor(colorHex);
    setColorModalVisible(false);
  };

  const handleSelectEdge = (
    edgeId: 'outline' | 'dropShadow' | 'raised' | 'depressed' | 'none',
  ) => {
    settingsStorage.setSubtitleEdgeType(edgeId);
    setEdgeType(edgeId);
    setEdgeModalVisible(false);
  };

  const handleSelectEdgeColor = (colorHex: string) => {
    settingsStorage.setSubtitleEdgeColor(colorHex);
    setEdgeColor(colorHex);
    setEdgeColorModalVisible(false);
  };

  const handleReset = () => {
    settingsStorage.setSubtitleFontSize(16);
    settingsStorage.setSubtitleOpacity(1);
    settingsStorage.setSubtitleTextOpacity(1);
    settingsStorage.setSubtitleBottomPadding(10);
    settingsStorage.setSubtitleTextColor('#FFFFFF');
    settingsStorage.setSubtitleFontFamily('default');
    settingsStorage.setSubtitleEdgeType('outline');
    settingsStorage.setSubtitleEdgeColor('#000000');
    settingsStorage.setSubtitleOutlineWidth(2);

    setFontSize(16);
    setOpacity(1);
    setTextOpacity(1);
    setBottomElevation(10);
    setTextColor('#FFFFFF');
    setFontFamily('default');
    setEdgeType('outline');
    setEdgeColor('#000000');
    setOutlineWidth(2);
  };

  const currentFontName =
    FONT_OPTIONS.find(f => f.id === fontFamily)?.name || 'Default';
  const currentColorName =
    COLOR_OPTIONS.find(c => c.color.toLowerCase() === textColor.toLowerCase())
      ?.name || textColor;
  const currentEdgeName =
    EDGE_OPTIONS.find(e => e.id === edgeType)?.name || 'Outline';
  const currentEdgeColorName =
    EDGE_COLOR_OPTIONS.find(
      c => c.color.toLowerCase() === edgeColor.toLowerCase(),
    )?.name || edgeColor;

  const previewFont =
    FONT_OPTIONS.find(f => f.id === fontFamily)?.fontFam || undefined;

  let shadowStyle: any = {};
  if (edgeType === 'outline') {
    shadowStyle = {
      textShadowColor: edgeColor,
      textShadowOffset: {width: 0, height: 0},
      textShadowRadius: outlineWidth * 3.5,
    };
  } else if (edgeType === 'dropShadow') {
    shadowStyle = {
      textShadowColor: edgeColor,
      textShadowOffset: {width: outlineWidth * 1.8, height: outlineWidth * 2.2},
      textShadowRadius: outlineWidth * 2.5,
    };
  } else if (edgeType === 'raised') {
    shadowStyle = {
      textShadowColor: edgeColor,
      textShadowOffset: {width: outlineWidth * 1.2, height: outlineWidth * 1.5},
      textShadowRadius: outlineWidth * 1.2,
    };
  } else if (edgeType === 'depressed') {
    shadowStyle = {
      textShadowColor: edgeColor,
      textShadowOffset: {
        width: -outlineWidth * 1.2,
        height: -outlineWidth * 1.2,
      },
      textShadowRadius: outlineWidth * 1.2,
    };
  }

  return (
    <TVFocusGuide
      autoFocus={true}
      trapFocusRight={true}
      trapFocusDown={true}
      style={{flex: 1}}>
      <SettingsSearchScrollView
        searchFallback={edgeType === 'none' ? {
          'Outline & shadow color': 'Edge & shadow effect',
          'Outline & shadow size': 'Edge & shadow effect',
        } : undefined}
        focusable={false}
        accessible={false}
        className="h-full w-full bg-m3-background"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingBottom: 40, paddingTop: 20}}>
        <View className="px-5">
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 12,
            }}>
            <TVFocusable
              hasTVPreferredFocus={isTV}
              accessibilityLabel="Go back"
              accessibilityRole="button"
              onPress={() => navigation.goBack()}
              borderRadius={22}
              style={{
                alignItems: 'center',
                height: 44,
                justifyContent: 'center',
                marginRight: 10,
                width: 44,
              }}>
              <MaterialCommunityIcons
                name="arrow-left"
                size={28}
                color={colors.onBackground}
              />
            </TVFocusable>
            <AppText
              role="headlineLargeEmphasized"
              className="text-m3-on-background">
              Subtitle Preferences
            </AppText>
          </View>
          <AppText
            role="bodyLarge"
            className="mb-5 mt-1 text-m3-on-surface-variant">
            Tune subtitle typography, appearance, and placement
          </AppText>

          {/* Live Subtitle Preview Card */}
          <View
            className="mb-6 w-full overflow-hidden rounded-3xl border"
            style={{
              backgroundColor: previewBg === 'dark' ? '#0a0a0f' : '#f5f5f7',
              borderColor:
                previewBg === 'dark'
                  ? 'rgba(255,255,255,0.1)'
                  : 'rgba(0,0,0,0.12)',
              minHeight: 180,
              paddingTop: 54,
              justifyContent: 'flex-end',
              alignItems: 'center',
              paddingBottom: Math.min(Math.max(bottomElevation + 8, 12), 48),
              paddingHorizontal: 16,
            }}>
            {/* Simulated Video Scene Backdrop */}
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: previewBg === 'dark' ? '#12131a' : '#ffffff',
              }}>
              <View
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 16,
                  right: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    opacity: previewBg === 'dark' ? 0.6 : 0.7,
                  }}>
                  <MaterialCommunityIcons
                    name="play-circle-outline"
                    size={16}
                    color={previewBg === 'dark' ? 'white' : '#12131a'}
                  />
                  <AppText
                    className="text-xs font-semibold tracking-wider"
                    style={{
                      color: previewBg === 'dark' ? 'white' : '#12131a',
                    }}>
                    LIVE PREVIEW
                  </AppText>
                </View>

                {/* Background Theme Switcher */}
                <TVFocusable
                  accessibilityRole="button"
                  accessibilityLabel={
                    previewBg === 'dark'
                      ? 'Switch to light background preview'
                      : 'Switch to dark background preview'
                  }
                  onPress={() => {
                    if (settingsStorage.isHapticFeedbackEnabled()) {
                      ReactNativeHapticFeedback.trigger('effectTick', {
                        enableVibrateFallback: true,
                        ignoreAndroidSystemSettings: false,
                      });
                    }
                    setPreviewBg(prev => (prev === 'dark' ? 'light' : 'dark'));
                  }}
                  borderRadius={20}
                  focusScale={1.05}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    paddingHorizontal: 10,
                    paddingVertical: 4.5,
                    borderRadius: 20,
                    backgroundColor:
                      previewBg === 'dark'
                        ? 'rgba(255, 255, 255, 0.12)'
                        : 'rgba(0, 0, 0, 0.07)',
                    borderWidth: 1,
                    borderColor:
                      previewBg === 'dark'
                        ? 'rgba(255, 255, 255, 0.15)'
                        : 'rgba(0, 0, 0, 0.1)',
                  }}>
                  <MaterialCommunityIcons
                    name={
                      previewBg === 'dark' ? 'weather-sunny' : 'weather-night'
                    }
                    size={14}
                    color={previewBg === 'dark' ? '#F4F5F8' : '#1E1E24'}
                  />
                  <AppText
                    style={{
                      fontSize: 11,
                      fontWeight: '600',
                      color: previewBg === 'dark' ? '#F4F5F8' : '#1E1E24',
                    }}>
                    {previewBg === 'dark' ? 'White BG' : 'Dark BG'}
                  </AppText>
                </TVFocusable>
              </View>
            </View>

            {/* Subtitle box */}
            <View
              style={{
                backgroundColor: `rgba(0, 0, 0, ${opacity})`,
                paddingHorizontal: 14,
                paddingVertical: 6,
                borderRadius: 8,
                maxWidth: '92%',
                alignItems: 'center',
              }}>
              <AppText
                style={{
                  color: textColor,
                  opacity: textOpacity,
                  fontSize: fontSize,
                  lineHeight: Math.round(fontSize * 1.35),
                  fontFamily: previewFont,
                  fontWeight: '600',
                  textAlign: 'center',
                  ...shadowStyle,
                }}>
                Subtitle preview for video playback.
              </AppText>
            </View>
          </View>

          {/* Text Typography Section */}
          <SettingsSection title="Typography">
            <SettingsSliderRow
              title="Font size"
              description="Size in scaled pixels"
              icon="format-size"
              value={fontSize}
              min={10}
              max={32}
              step={1}
              valueDisplay={`${fontSize} SP`}
              widestValue="32 SP"
              onValueChange={(val: number) => {
                setFontSize(val);
              }}
              onValueChangeFinished={value =>
                settingsStorage.setSubtitleFontSize(value)
              }
            />
            <SettingsRow
              title="Font style"
              description={currentFontName}
              icon="format-font"
              onPress={() => setFontModalVisible(true)}
            />
          </SettingsSection>

          {/* Appearance & Color Section */}
          <SettingsSection title="Appearance">
            <SettingsRow
              title="Text color"
              description={currentColorName}
              icon="palette-outline"
              onPress={() => setColorModalVisible(true)}
              trailing={
                <View className="flex-row items-center gap-2">
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: textColor,
                      borderWidth: 1.5,
                      borderColor: 'rgba(255,255,255,0.3)',
                    }}
                  />
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={22}
                    color={colors.onSurfaceVariant}
                  />
                </View>
              }
            />
            <SettingsRow
              title="Edge & shadow effect"
              description={currentEdgeName}
              icon="box-shadow"
              onPress={() => setEdgeModalVisible(true)}
            />
            {edgeType !== 'none' && (
              <>
                <SettingsRow
                  title="Outline & shadow color"
                  description={currentEdgeColorName}
                  icon="border-color"
                  onPress={() => setEdgeColorModalVisible(true)}
                  trailing={
                    <View className="flex-row items-center gap-2">
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          backgroundColor: edgeColor,
                          borderWidth: 1.5,
                          borderColor: 'rgba(255,255,255,0.3)',
                        }}
                      />
                      <MaterialCommunityIcons
                        name="chevron-right"
                        size={22}
                        color={colors.onSurfaceVariant}
                      />
                    </View>
                  }
                />
                <SettingsSliderRow
                  title="Outline & shadow size"
                  description="Border and shadow thickness"
                  icon="arrow-expand-all"
                  value={outlineWidth}
                  min={1}
                  max={6}
                  step={1}
                  valueDisplay={`${outlineWidth}px`}
                  widestValue="6px"
                  onValueChange={(val: number) => {
                    setOutlineWidth(val);
                  }}
                  onValueChangeFinished={value =>
                    settingsStorage.setSubtitleOutlineWidth(value)
                  }
                />
              </>
            )}
            <SettingsSliderRow
              title="Text opacity"
              description="Opacity of subtitle text and its outline"
              icon="format-color-text"
              value={textOpacity}
              min={0.2}
              max={1}
              step={0.05}
              valueDisplay={`${Math.round(textOpacity * 100)}%`}
              widestValue="100%"
              onValueChange={(val: number) => {
                const rounded = parseFloat(val.toFixed(2));
                setTextOpacity(rounded);
              }}
              onValueChangeFinished={value =>
                settingsStorage.setSubtitleTextOpacity(value)
              }
            />
            <SettingsSliderRow
              title="Background opacity"
              description="Opacity of subtitle background box"
              icon="opacity"
              value={opacity}
              min={0}
              max={1}
              step={0.05}
              valueDisplay={`${Math.round(opacity * 100)}%`}
              widestValue="100%"
              onValueChange={(val: number) => {
                const rounded = parseFloat(val.toFixed(2));
                setOpacity(rounded);
              }}
              onValueChangeFinished={value =>
                settingsStorage.setSubtitleOpacity(value)
              }
            />
          </SettingsSection>

          {/* Placement Section */}
          <SettingsSection title="Placement">
            <SettingsSliderRow
              title="Bottom elevation"
              description="Distance from the bottom"
              icon="arrow-expand-vertical"
              value={bottomElevation}
              min={0}
              max={80}
              step={1}
              valueDisplay={`${bottomElevation}dp`}
              widestValue="80dp"
              onValueChange={(val: number) => {
                setBottomElevation(val);
              }}
              onValueChangeFinished={value =>
                settingsStorage.setSubtitleBottomPadding(value)
              }
            />
          </SettingsSection>

          {/* System & Reset Section */}
          <SettingsSection title="System">
            <SettingsRow
              title="Reset to defaults"
              description="Font 16, White, Outline 2px, 100% text and background opacity, Elevation 10"
              icon="restore"
              divider={false}
              onPress={handleReset}
            />
          </SettingsSection>
        </View>

        {/* Font Family Selection Modal */}
        <Modal
          visible={fontModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setFontModalVisible(false)}>
          <Pressable
            focusable={false}
            accessible={false}
            className="flex-1 justify-center items-center bg-black/60 px-5"
            onPress={() => setFontModalVisible(false)}>
            <TVFocusGuide autoFocus={true} trapFocusRight={true}>
              <Pressable
                focusable={false}
                className="w-full max-w-sm rounded-3xl p-5"
                style={{backgroundColor: colors.surfaceContainerHigh}}
                onPress={e => e.stopPropagation()}>
                <AppText role="titleLarge" className="mb-4 text-m3-on-surface">
                  Select Font Style
                </AppText>
                {FONT_OPTIONS.map(opt => {
                  const selected = opt.id === fontFamily;
                  return (
                    <TVFocusable
                      key={opt.id}
                      hasTVPreferredFocus={isTV && selected}
                      borderRadius={16}
                      accessibilityRole="button"
                      accessibilityLabel={opt.name}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingVertical: 12,
                        paddingHorizontal: 12,
                        borderRadius: 16,
                        marginBottom: 4,
                        backgroundColor: selected
                          ? colors.secondaryContainer
                          : 'transparent',
                      }}
                      onPress={() => handleSelectFont(opt.id)}>
                      <AppText
                        style={{
                          fontFamily: opt.fontFam,
                          fontSize: 16,
                          color: selected
                            ? colors.onSecondaryContainer
                            : colors.onSurface,
                        }}>
                        {opt.name}
                      </AppText>
                      {selected && (
                        <MaterialIcons
                          name="check"
                          size={20}
                          color={colors.onSecondaryContainer}
                        />
                      )}
                    </TVFocusable>
                  );
                })}
              </Pressable>
            </TVFocusGuide>
          </Pressable>
        </Modal>

        {/* Text Color Selection Modal */}
        <Modal
          visible={colorModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setColorModalVisible(false)}>
          <Pressable
            focusable={false}
            accessible={false}
            className="flex-1 justify-center items-center bg-black/60 px-5"
            onPress={() => setColorModalVisible(false)}>
            <TVFocusGuide autoFocus={true} trapFocusRight={true}>
              <Pressable
                focusable={false}
                className="w-full max-w-sm rounded-3xl p-5"
                style={{backgroundColor: colors.surfaceContainerHigh}}
                onPress={e => e.stopPropagation()}>
                <AppText role="titleLarge" className="mb-4 text-m3-on-surface">
                  Select Text Color
                </AppText>
                {COLOR_OPTIONS.map(opt => {
                  const selected =
                    opt.color.toLowerCase() === textColor.toLowerCase();
                  return (
                    <TVFocusable
                      key={opt.color}
                      hasTVPreferredFocus={isTV && selected}
                      borderRadius={16}
                      accessibilityRole="button"
                      accessibilityLabel={opt.name}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingVertical: 12,
                        paddingHorizontal: 12,
                        borderRadius: 16,
                        marginBottom: 4,
                        backgroundColor: selected
                          ? colors.secondaryContainer
                          : 'transparent',
                      }}
                      onPress={() => handleSelectColor(opt.color)}>
                      <View className="flex-row items-center gap-3">
                        <View
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 11,
                            backgroundColor: opt.color,
                            borderWidth: 1.5,
                            borderColor: 'rgba(255,255,255,0.4)',
                          }}
                        />
                        <AppText
                          style={{
                            fontSize: 16,
                            color: selected
                              ? colors.onSecondaryContainer
                              : colors.onSurface,
                          }}>
                          {opt.name}
                        </AppText>
                      </View>
                      {selected && (
                        <MaterialIcons
                          name="check"
                          size={20}
                          color={colors.onSecondaryContainer}
                        />
                      )}
                    </TVFocusable>
                  );
                })}
              </Pressable>
            </TVFocusGuide>
          </Pressable>
        </Modal>

        {/* Edge / Shadow Effect Modal */}
        <Modal
          visible={edgeModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setEdgeModalVisible(false)}>
          <Pressable
            focusable={false}
            accessible={false}
            className="flex-1 justify-center items-center bg-black/60 px-5"
            onPress={() => setEdgeModalVisible(false)}>
            <TVFocusGuide autoFocus={true} trapFocusRight={true}>
              <Pressable
                focusable={false}
                className="w-full max-w-sm rounded-3xl p-5"
                style={{backgroundColor: colors.surfaceContainerHigh}}
                onPress={e => e.stopPropagation()}>
                <AppText role="titleLarge" className="mb-4 text-m3-on-surface">
                  Select Edge Effect
                </AppText>
                {EDGE_OPTIONS.map(opt => {
                  const selected = opt.id === edgeType;
                  return (
                    <TVFocusable
                      key={opt.id}
                      hasTVPreferredFocus={isTV && selected}
                      borderRadius={16}
                      accessibilityRole="button"
                      accessibilityLabel={opt.name}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingVertical: 12,
                        paddingHorizontal: 12,
                        borderRadius: 16,
                        marginBottom: 4,
                        backgroundColor: selected
                          ? colors.secondaryContainer
                          : 'transparent',
                      }}
                      onPress={() => handleSelectEdge(opt.id)}>
                      <View className="flex-1 mr-2">
                        <AppText
                          style={{
                            fontSize: 16,
                            fontWeight: '600',
                            color: selected
                              ? colors.onSecondaryContainer
                              : colors.onSurface,
                          }}>
                          {opt.name}
                        </AppText>
                        <AppText
                          className="mt-0.5 text-xs text-white/50"
                          style={{
                            color: selected
                              ? colors.onSecondaryContainer
                              : colors.onSurfaceVariant,
                          }}>
                          {opt.description}
                        </AppText>
                      </View>
                      {selected && (
                        <MaterialIcons
                          name="check"
                          size={20}
                          color={colors.onSecondaryContainer}
                        />
                      )}
                    </TVFocusable>
                  );
                })}
              </Pressable>
            </TVFocusGuide>
          </Pressable>
        </Modal>

        {/* Edge / Shadow Color Modal */}
        <Modal
          visible={edgeColorModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setEdgeColorModalVisible(false)}>
          <Pressable
            focusable={false}
            accessible={false}
            className="flex-1 justify-center items-center bg-black/60 px-5"
            onPress={() => setEdgeColorModalVisible(false)}>
            <TVFocusGuide autoFocus={true} trapFocusRight={true}>
              <Pressable
                focusable={false}
                className="w-full max-w-sm rounded-3xl p-5"
                style={{backgroundColor: colors.surfaceContainerHigh}}
                onPress={e => e.stopPropagation()}>
                <AppText role="titleLarge" className="mb-4 text-m3-on-surface">
                  Select Outline & Shadow Color
                </AppText>
                {EDGE_COLOR_OPTIONS.map(opt => {
                  const selected =
                    opt.color.toLowerCase() === edgeColor.toLowerCase();
                  return (
                    <TVFocusable
                      key={opt.color}
                      hasTVPreferredFocus={isTV && selected}
                      borderRadius={16}
                      accessibilityRole="button"
                      accessibilityLabel={opt.name}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingVertical: 12,
                        paddingHorizontal: 12,
                        borderRadius: 16,
                        marginBottom: 4,
                        backgroundColor: selected
                          ? colors.secondaryContainer
                          : 'transparent',
                      }}
                      onPress={() => handleSelectEdgeColor(opt.color)}>
                      <View className="flex-row items-center gap-3">
                        <View
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 11,
                            backgroundColor: opt.color,
                            borderWidth: 1.5,
                            borderColor: 'rgba(255,255,255,0.4)',
                          }}
                        />
                        <AppText
                          style={{
                            fontSize: 16,
                            color: selected
                              ? colors.onSecondaryContainer
                              : colors.onSurface,
                          }}>
                          {opt.name}
                        </AppText>
                      </View>
                      {selected && (
                        <MaterialIcons
                          name="check"
                          size={20}
                          color={colors.onSecondaryContainer}
                        />
                      )}
                    </TVFocusable>
                  );
                })}
              </Pressable>
            </TVFocusGuide>
          </Pressable>
        </Modal>
      </SettingsSearchScrollView>
    </TVFocusGuide>
  );
};

export default SubtitlePreference;
