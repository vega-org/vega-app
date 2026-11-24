import {MaterialCommunityIcons} from '@expo/vector-icons';
import React, {useEffect, useState} from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import Text from '../../../components/ui/Text';
import {TVFocusable} from '../../../components/tv';
import {socialLinks} from '../../../lib/constants';
import {useM3Colors} from '../../../theme/M3PaletteContext';
import {readableOnColor} from '../../../theme/seeds';
import {useTVFocusBorderColor} from '../../../lib/tv/useTVFocusBorderColor';
import {isTV} from '../../../lib/tv';

interface AddSourceModalProps {
  visible: boolean;
  initialValue?: string;
  // GitHub token from the add source intent. Selects "Private" when set.
  initialToken?: string;
  onClose: () => void;
  // token is undefined for a public source.
  onAdd: (value: string, token?: string) => void;
}

export const AddSourceModal: React.FC<AddSourceModalProps> = ({
  visible,
  initialValue,
  initialToken,
  onClose,
  onAdd,
}) => {
  const colors = useM3Colors();
  const focusBorderColor = useTVFocusBorderColor();
  const [inputValue, setInputValue] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isTokenFocused, setIsTokenFocused] = useState(false);

  useEffect(() => {
    if (visible && initialValue) {
      setInputValue(initialValue);
    }
  }, [visible, initialValue]);

  useEffect(() => {
    if (visible && initialToken) {
      setIsPrivate(true);
      setToken(initialToken);
    }
  }, [visible, initialToken]);

  const resetForm = () => {
    setInputValue('');
    setIsPrivate(false);
    setToken('');
    setShowToken(false);
  };

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      e => {
        setKeyboardHeight(e.endCoordinates.height);
      },
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
      },
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleConfirm = () => {
    const trimmed = inputValue.trim();
    if (trimmed) {
      onAdd(trimmed, isPrivate ? token : undefined);
      resetForm();
    }
  };

  const renderVisibilityOption = (
    value: boolean,
    label: string,
    icon: 'earth' | 'lock',
  ) => {
    const selected = isPrivate === value;
    return (
      <TVFocusable
        accessibilityRole="radio"
        accessibilityState={{selected}}
        accessibilityLabel={`${label} source`}
        onPress={() => setIsPrivate(value)}
        borderRadius={14}
        focusScale={1.05}
        style={{
          height: 44,
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          backgroundColor: selected
            ? colors.secondaryContainer
            : colors.surfaceContainerHighest,
          borderColor: selected ? colors.secondary : colors.outlineVariant,
          borderRadius: 14,
          borderWidth: 1,
        }}>
        <MaterialCommunityIcons
          name={icon}
          size={18}
          color={
            selected ? colors.onSecondaryContainer : colors.onSurfaceVariant
          }
        />
        <Text
          className="font-medium"
          style={{
            color: selected
              ? colors.onSecondaryContainer
              : colors.onSurfaceVariant,
          }}>
          {label}
        </Text>
      </TVFocusable>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType={isTV ? "none" : "fade"}
      transparent
      onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-center items-center bg-black/60 px-4"
        style={{
          paddingBottom: Platform.OS === 'android' ? keyboardHeight : 0,
        }}>
        <Pressable
          focusable={false}
          accessible={false}
          importantForAccessibility="no"
          style={{position: 'absolute', top: 0, bottom: 0, left: 0, right: 0}}
          onPress={() => {
            if (keyboardHeight > 0) {
              Keyboard.dismiss();
            } else {
              handleClose();
            }
          }}
        />
        <View
          style={{
            backgroundColor: colors.surfaceContainerHigh,
            borderRadius: 28,
            maxWidth: 420,
            overflow: 'hidden',
            padding: 24,
            width: 340,
          }}>
          <View className="flex-row items-center justify-between mb-3">
            <Text
              className="text-base font-semibold w-fit"
              style={{color: colors.onSurface}}
              numberOfLines={1}>
              Add Source
            </Text>
            <TVFocusable
              hasTVPreferredFocus={isTV}
              accessibilityRole="button"
              accessibilityLabel="Close add source dialog"
              onPress={handleClose}
              borderRadius={14}
              focusScale={1.1}
              style={{
                height: 40,
                width: 40,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surfaceContainerHighest,
                borderRadius: 14,
              }}>
              <MaterialCommunityIcons
                name="close"
                size={22}
                color={colors.onSurfaceVariant}
              />
            </TVFocusable>
          </View>
          <Text className="text-sm font-medium" style={{color: colors.onSurface}}>
            Enter an author name, repo URL or manifest URL.
          </Text>
          <Text
            className="text-sm mt-[4px]"
            style={{color: colors.onSurfaceVariant, lineHeight: 20}}>
            How to create provider{' '}
            <Text
              accessibilityRole="link"
              style={{color: '#38BDF8', fontSize: 14, lineHeight: 20}}
              onPress={() => Linking.openURL(socialLinks.github + '#vega-app')}>
              here
            </Text>
          </Text>
          <Text
            className="text-sm mt-[4px]"
            style={{color: colors.onSurfaceVariant, lineHeight: 20}}>
            or join Discord for support{' '}
            <Text
              accessibilityRole="link"
              style={{color: '#38BDF8', fontSize: 14, lineHeight: 20}}
              onPress={() => Linking.openURL(socialLinks.discord)}>
              Discord
            </Text>
          </Text>
          <TextInput
            className="h-14 px-4 mt-4"
            focusable={true}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            style={{
              backgroundColor: colors.surfaceContainerHighest,
              borderColor: isInputFocused ? focusBorderColor : colors.outlineVariant,
              borderRadius: 18,
              borderWidth: isInputFocused ? 2.5 : 1,
              color: colors.onSurface,
            }}
            placeholder="author, author@cb or repo URL"
            placeholderTextColor={colors.onSurfaceVariant}
            selectionColor={colors.primary}
            value={inputValue}
            onChangeText={setInputValue}
            onSubmitEditing={handleConfirm}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View className="flex-row gap-2 mt-3">
            {renderVisibilityOption(false, 'Public', 'earth')}
            {renderVisibilityOption(true, 'Private', 'lock')}
          </View>
          {isPrivate && (
            <>
              <View className="flex-row items-center gap-2 mt-3">
                <TextInput
                  className="h-14 px-4 flex-1"
                  focusable={true}
                  onFocus={() => setIsTokenFocused(true)}
                  onBlur={() => setIsTokenFocused(false)}
                  style={{
                    backgroundColor: colors.surfaceContainerHighest,
                    borderColor: isTokenFocused
                      ? focusBorderColor
                      : colors.outlineVariant,
                    borderRadius: 18,
                    borderWidth: isTokenFocused ? 2.5 : 1,
                    color: colors.onSurface,
                  }}
                  placeholder="Access token"
                  placeholderTextColor={colors.onSurfaceVariant}
                  selectionColor={colors.primary}
                  value={token}
                  onChangeText={setToken}
                  onSubmitEditing={handleConfirm}
                  secureTextEntry={!showToken}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TVFocusable
                  accessibilityRole="button"
                  accessibilityLabel={showToken ? 'Hide token' : 'Show token'}
                  onPress={() => setShowToken(current => !current)}
                  borderRadius={14}
                  focusScale={1.1}
                  style={{
                    height: 56,
                    width: 48,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.surfaceContainerHighest,
                    borderRadius: 14,
                  }}>
                  <MaterialCommunityIcons
                    name={showToken ? 'eye-off' : 'eye'}
                    size={22}
                    color={colors.onSurfaceVariant}
                  />
                </TVFocusable>
              </View>
              <Text
                className="text-xs mt-2"
                style={{color: colors.onSurfaceVariant, lineHeight: 16}}>
                GitHub only. Use a fine-grained token with read-only Contents
                access to this repo. The token is stored encrypted on this
                device.
              </Text>
            </>
          )}
          <View className="flex-row gap-2 mt-4">
            <TVFocusable
              accessibilityRole="button"
              onPress={handleClose}
              borderRadius={16}
              focusScale={1.05}
              style={{
                height: 48,
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surfaceContainerHighest,
                borderRadius: 16,
              }}>
              <Text className="font-medium" style={{color: colors.onSurface}}>
                Cancel
              </Text>
            </TVFocusable>

            <TVFocusable
              accessibilityRole="button"
              onPress={handleConfirm}
              borderRadius={16}
              focusScale={1.05}
              style={{
                height: 48,
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.primary,
                borderRadius: 16,
              }}>
              <Text
                className="font-medium"
                style={{color: readableOnColor(colors.primary)}}>
                Confirm
              </Text>
            </TVFocusable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};
