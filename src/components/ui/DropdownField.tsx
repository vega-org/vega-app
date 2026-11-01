import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  DropdownMenuItem,
  HorizontalDivider,
  ExposedDropdownMenu,
  ExposedDropdownMenuBox,
  Host,
  RNHostView,
  Shape,
  Text,
  TextField,
} from '@expo/ui/jetpack-compose';
import {clip, fillMaxWidth, menuAnchor, padding, Shapes} from '@expo/ui/jetpack-compose/modifiers';
import React, {useState, useEffect} from 'react';
import {
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  View,
  ViewStyle,
} from 'react-native';
import {useM3Colors, useM3HostTheme} from '../../theme/M3PaletteContext';
import {LEGACY_TERTIARY_BACKGROUND} from '../../theme/seeds';
import {isTV} from '../../lib/tv';
import {TVFocusable, TVFocusGuide} from '../tv';
import {useTVFocusBorderColor} from '../../lib/tv/useTVFocusBorderColor';

interface DropdownFieldProps<T> {
  options: readonly T[];
  value?: T;
  getKey: (option: T) => string;
  getLabel: (option: T) => string;
  onChange: (option: T) => void;
  placeholder?: string;
  showFullOptionLabels?: boolean;
  style?: ViewStyle;
  disabled?: boolean;
}

const DropdownField = <T,>({
  options,
  value,
  getKey,
  getLabel,
  onChange,
  placeholder = 'Select',
  showFullOptionLabels = false,
  style,
  disabled = false,
}: DropdownFieldProps<T>) => {
  const colors = useM3Colors();
  const hostTheme = useM3HostTheme();
  const tvFocusBorder = useTVFocusBorderColor();
  const [expanded, setExpanded] = useState(false);
  const selectedKey = value ? getKey(value) : undefined;
  const selectedOption = options.find(option => getKey(option) === selectedKey);
  const selectedLabel = selectedOption ? getLabel(selectedOption) : placeholder;

  useEffect(() => {
    if (!isTV || !expanded) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setExpanded(false);
      return true;
    });
    return () => sub.remove();
  }, [expanded]);

  if (isTV) {
    const dialogTitle =
      placeholder && placeholder !== 'Select' ? placeholder : 'Select Season';

    return (
      <View style={[{width: '100%', minHeight: 56}, style]}>
        <TVFocusable
          onPress={() => !disabled && setExpanded(true)}
          disabled={disabled}
          borderRadius={16}
          focusScale={1.03}
          focusBorderColor={tvFocusBorder}
          style={{
            backgroundColor: LEGACY_TERTIARY_BACKGROUND,
            borderRadius: 16,
            paddingHorizontal: 16,
            paddingVertical: 14,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderWidth: 1,
            borderColor: colors.outlineVariant,
            opacity: disabled ? 0.45 : 1,
          }}>
          <RNText
            numberOfLines={1}
            style={{
              fontSize: 14,
              color: colors.onSurface,
              fontWeight: value ? '600' : '400',
              flex: 1,
              marginRight: 8,
            }}>
            {selectedLabel}
          </RNText>
          <MaterialCommunityIcons
            name={expanded ? 'menu-up' : 'menu-down'}
            size={24}
            color={colors.primary}
          />
        </TVFocusable>

        <Modal
          visible={expanded}
          transparent
          animationType="fade"
          onRequestClose={() => setExpanded(false)}>
          <View
            style={{
              flex: 1,
              backgroundColor: 'rgba(0, 0, 0, 0.78)',
              justifyContent: 'center',
              alignItems: 'center',
              padding: 24,
            }}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setExpanded(false)}
            />
            <TVFocusGuide autoFocus={true} trapFocusRight={true}>
              <View
                style={{
                  width: '90%',
                  maxWidth: 480,
                  maxHeight: '80%',
                  backgroundColor: '#1E1E1E',
                  borderRadius: 20,
                  padding: 20,
                  borderWidth: 1,
                  borderColor: 'rgba(255, 255, 255, 0.12)',
                  zIndex: 10,
                  overflow: 'hidden',
                }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 16,
                    paddingHorizontal: 4,
                  }}>
                  <RNText
                    style={{
                      fontSize: 18,
                      fontWeight: '700',
                      color: '#FFFFFF',
                    }}>
                    {dialogTitle}
                  </RNText>
                  <TVFocusable
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    borderRadius={18}
                    focusScale={1}
                    focusBorderColor={tvFocusBorder}
                    onPress={() => setExpanded(false)}
                    style={{padding: 6}}>
                    <MaterialCommunityIcons
                      name="close"
                      size={24}
                      color="#AAAAAA"
                    />
                  </TVFocusable>
                </View>

                <ScrollView
                  focusable={false}
                  accessible={false}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingHorizontal: 4,
                    paddingVertical: 4,
                  }}>
                {options.map(option => {
                  const key = getKey(option);
                  const selected = key === selectedKey;
                  return (
                    <TVFocusable
                      key={key}
                      onPress={() => {
                        onChange(option);
                        setExpanded(false);
                      }}
                      hasTVPreferredFocus={selected}
                      borderRadius={12}
                      focusScale={1}
                      focusBorderColor={tvFocusBorder}
                      focusedStyle={{
                        backgroundColor: 'rgba(255, 255, 255, 0.14)',
                      }}
                      style={{
                        paddingVertical: 14,
                        paddingHorizontal: 16,
                        borderRadius: 12,
                        marginBottom: 8,
                        backgroundColor: selected
                          ? 'rgba(255, 255, 255, 0.08)'
                          : 'transparent',
                        borderWidth: 1,
                        borderColor: selected
                          ? 'rgba(255, 255, 255, 0.15)'
                          : 'transparent',
                      }}>
                      {({focused}) => (
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            width: '100%',
                          }}>
                          <RNText
                            numberOfLines={
                              showFullOptionLabels ? undefined : 2
                            }
                            style={{
                              fontSize: 16,
                              fontWeight:
                                focused || selected ? '700' : '400',
                              color: focused
                                ? '#FFFFFF'
                                : selected
                                ? '#FFFFFF'
                                : '#CCCCCC',
                              flex: 1,
                              marginRight: 8,
                            }}>
                            {getLabel(option)}
                          </RNText>
                          {selected && (
                            <MaterialCommunityIcons
                              name="check-circle"
                              size={22}
                              color={
                                focused
                                  ? tvFocusBorder
                                  : colors.primary || '#FFFFFF'
                              }
                            />
                          )}
                        </View>
                      )}
                    </TVFocusable>
                  );
                })}
              </ScrollView>
            </View>
          </TVFocusGuide>
        </View>
      </Modal>
      </View>
    );
  }

  return (
    <View style={[{width: '100%', minHeight: 56}, style]}>
      <Host
        matchContents={{vertical: true}}
        style={{width: '100%', minHeight: 56, opacity: disabled ? 0.45 : 1}}
        pointerEvents={disabled ? 'none' : 'auto'}
        {...hostTheme}>
      <ExposedDropdownMenuBox
        expanded={disabled ? false : expanded}
        onExpandedChange={next => !disabled && setExpanded(next)}>
        <TextField
          readOnly
          singleLine
          modifiers={[menuAnchor(), fillMaxWidth()]}
          shape={Shape.RoundedCorner({
            cornerRadii: {
              topStart: 16,
              topEnd: 16,
              bottomStart: 16,
              bottomEnd: 16,
            },
          })}
          textStyle={{fontSize: 14, color: colors.onSurface}}
          colors={{
            focusedContainerColor: LEGACY_TERTIARY_BACKGROUND,
            unfocusedContainerColor: LEGACY_TERTIARY_BACKGROUND,
            focusedTextColor: colors.onSurface,
            unfocusedTextColor: colors.onSurface,
            focusedIndicatorColor: colors.primary,
            unfocusedIndicatorColor: colors.outlineVariant,
            focusedPlaceholderColor: colors.onSurface,
            unfocusedPlaceholderColor: colors.onSurface,
          }}>
          <TextField.Placeholder>
            <Text
              color={colors.onSurface}
              maxLines={1}
              overflow="ellipsis"
              softWrap={false}>
              {selectedLabel}
            </Text>
          </TextField.Placeholder>
          <TextField.TrailingIcon>
            <RNHostView matchContents>
              <View
                style={{
                  alignItems: 'center',
                  height: 24,
                  justifyContent: 'center',
                  width: 24,
                }}>
                <MaterialCommunityIcons
                  name={expanded ? 'menu-up' : 'menu-down'}
                  size={22}
                  color={colors.primary}
                />
              </View>
            </RNHostView>
          </TextField.TrailingIcon>
        </TextField>
        <ExposedDropdownMenu
          expanded={expanded}
          containerColor={LEGACY_TERTIARY_BACKGROUND}
          modifiers={[clip(Shapes.RoundedCorner(16))]}
          onDismissRequest={() => setExpanded(false)}>
          {options.map((option, index) => {
            const key = getKey(option);
            const selected = key === selectedKey;
            return (
              <React.Fragment key={key}>
                {index > 0 && (
                  <HorizontalDivider
                    thickness={StyleSheet.hairlineWidth}
                    color={colors.outlineVariant}
                  />
                )}
                <DropdownMenuItem
                  elementColors={{
                    textColor: selected ? colors.primary : colors.onSurface,
                  }}
                  onClick={() => {
                    onChange(option);
                    setExpanded(false);
                  }}>
                  <DropdownMenuItem.Text>
                    <Text
                      color={selected ? colors.primary : colors.onSurface}
                      modifiers={[padding(0, 10, 0, 10)]}
                      maxLines={showFullOptionLabels ? undefined : 2}
                      overflow={showFullOptionLabels ? undefined : 'ellipsis'}
                      softWrap={showFullOptionLabels}
                      style={{fontWeight: selected ? '700' : '400'}}>
                      {getLabel(option)}
                    </Text>
                  </DropdownMenuItem.Text>
                </DropdownMenuItem>
              </React.Fragment>
            );
          })}
        </ExposedDropdownMenu>
      </ExposedDropdownMenuBox>
    </Host>
    </View>
  );
};

export default DropdownField;
