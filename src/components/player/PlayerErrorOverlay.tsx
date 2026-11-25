import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, {useEffect, useState} from 'react';
import {
  Clipboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import {TVFocusable} from '../tv';
import type {PlaybackErrorDetails} from '../../lib/player/playbackErrorRetry';

interface PlayerErrorOverlayProps {
  error: PlaybackErrorDetails | null;
  primaryColor: string;
  hasNextServer: boolean;
  isTV: boolean;
  onTryNextServer: () => void;
  onRetry: () => void;
  onGoBack: () => void;
}

function ActionButton({
  label,
  icon,
  isTV,
  backgroundColor,
  borderColor,
  textColor,
  onPress,
  hasTVPreferredFocus,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  isTV: boolean;
  backgroundColor: string;
  borderColor?: string;
  textColor: string;
  onPress: () => void;
  hasTVPreferredFocus?: boolean;
}) {
  const buttonStyle = [
    styles.button,
    {
      backgroundColor,
      borderColor: borderColor ?? 'transparent',
      borderWidth: borderColor ? 1 : 0,
    },
  ];
  const inner = (
    <View style={styles.buttonContent}>
      <MaterialIcons name={icon} size={18} color={textColor} />
      <Text style={[styles.buttonText, {color: textColor}]}>{label}</Text>
    </View>
  );

  if (isTV) {
    return (
      <TVFocusable
        hasTVPreferredFocus={hasTVPreferredFocus}
        focusBorderColor="#ffffff"
        focusScale={1.06}
        borderRadius={12}
        style={buttonStyle}
        onPress={onPress}>
        {inner}
      </TVFocusable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={({pressed}) => [buttonStyle, pressed && {opacity: 0.78}]}>
      {inner}
    </Pressable>
  );
}

export default function PlayerErrorOverlay({
  error,
  primaryColor,
  hasNextServer,
  isTV,
  onTryNextServer,
  onRetry,
  onGoBack,
}: PlayerErrorOverlayProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [error]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!error) return null;

  const handleCopyError = () => {
    Clipboard.setString(error.rawMessage);
    setCopied(true);
    if (Platform.OS === 'android') {
      ToastAndroid.show('Error details copied', ToastAndroid.SHORT);
    }
  };

  return (
    <View style={styles.backdrop} pointerEvents="auto">
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.iconBadge}>
            <MaterialIcons name="error-outline" size={24} color="#F87171" />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title}>{error.title}</Text>
            {error.codeLabel ? (
              <Text style={styles.codeLabel}>{error.codeLabel}</Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.summary} numberOfLines={4}>
          {error.summary}
        </Text>

        <View style={styles.actions}>
          {hasNextServer ? (
            <ActionButton
              label="Try next server"
              icon="skip-next"
              isTV={isTV}
              hasTVPreferredFocus={true}
              backgroundColor={primaryColor}
              textColor="#FFFFFF"
              onPress={onTryNextServer}
            />
          ) : null}
          <ActionButton
            label={copied ? 'Copied' : 'Copy error'}
            icon={copied ? 'check' : 'content-copy'}
            isTV={isTV}
            hasTVPreferredFocus={!hasNextServer}
            backgroundColor="rgba(255, 255, 255, 0.12)"
            borderColor="rgba(255, 255, 255, 0.2)"
            textColor="#F4F4F5"
            onPress={handleCopyError}
          />
          <ActionButton
            label="Retry"
            icon="refresh"
            isTV={isTV}
            backgroundColor="rgba(255, 255, 255, 0.08)"
            borderColor="rgba(255, 255, 255, 0.16)"
            textColor="#F4F4F5"
            onPress={onRetry}
          />
          <ActionButton
            label="Go back"
            icon="arrow-back"
            isTV={isTV}
            backgroundColor="rgba(255, 255, 255, 0.06)"
            borderColor="rgba(255, 255, 255, 0.12)"
            textColor="#D4D4D8"
            onPress={onGoBack}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(9, 9, 12, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 200,
    elevation: 24,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#18181B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    padding: 20,
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(248, 113, 113, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  codeLabel: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  summary: {
    color: '#D4D4D8',
    fontSize: 13.5,
    lineHeight: 19,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  button: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  buttonText: {
    fontSize: 13.5,
    fontWeight: '600',
  },
});
