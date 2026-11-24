import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import React, {ReactNode, useEffect, useRef, useState} from 'react';
import {Image, Modal, Pressable, StyleSheet, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import AppText from '../ui/Text';
import {useM3Colors} from '../../theme/M3PaletteContext';

interface RemoteSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  headerRight?: ReactNode;
  expanded?: boolean;
  children: ReactNode;
  /** False for sheets with sliders, so dragging moves the slider, not the sheet. */
  enableContentPanningGesture?: boolean;
}

/** Same bottom sheet setup as DownloadBottomSheet. */
export const RemoteSheet: React.FC<RemoteSheetProps> = ({
  visible,
  title,
  onClose,
  headerRight,
  expanded = false,
  children,
  enableContentPanningGesture = true,
}) => {
  const colors = useM3Colors();
  const sheetRef = useRef<BottomSheet>(null);

  useEffect(() => {
    if (visible) sheetRef.current?.snapToIndex?.(expanded ? 1 : 0);
  }, [visible,expanded]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent>
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <BottomSheet
          ref={sheetRef}
          index={0}
          enablePanDownToClose
          enableContentPanningGesture={enableContentPanningGesture}
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
          backgroundStyle={{backgroundColor: colors.surfaceContainerLow}}
          handleIndicatorStyle={{backgroundColor: colors.outline}}
          onChange={index => {
            if (index === -1) onClose();
          }}
          onClose={onClose}>
          <View
            style={{
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'space-between',
              paddingHorizontal: 24,
              paddingBottom: 8,
              paddingTop: 4,
            }}>
            <AppText role="titleLarge" style={{color: colors.onSurface}}>
              {title}
            </AppText>
            {headerRight}
          </View>
          <BottomSheetScrollView
            contentContainerStyle={{paddingHorizontal: 12, paddingBottom: 32}}>
            {children}
          </BottomSheetScrollView>
        </BottomSheet>
      </GestureHandlerRootView>
    </Modal>
  );
};

interface RemoteSheetOptionProps {
  title: string;
  supportingText?: string;
  selected?: boolean;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  thumbnail?: string;
  thumbnailPlaceholder?: boolean;
  onPress: () => void;
}

export const RemoteSheetOption: React.FC<RemoteSheetOptionProps> = ({
  title,
  supportingText,
  selected = false,
  icon,
  thumbnail,
  thumbnailPlaceholder = false,
  onPress,
}) => {
  const colors = useM3Colors();
  const [failedThumbnail, setFailedThumbnail] = useState<string>();
  const hasThumbnail = Boolean(thumbnail?.trim() && thumbnail !== failedThumbnail);
  const contentColor = selected ? colors.onSecondaryContainer : colors.onSurface;
  const supportingColor = selected
    ? colors.onSecondaryContainer
    : colors.onSurfaceVariant;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected}}
      onPress={onPress}
      android_ripple={{color: colors.onSurfaceVariant}}
      style={{
        alignItems: 'center',
        backgroundColor: selected ? colors.secondaryContainer : 'transparent',
        borderRadius: 16,
        flexDirection: 'row',
        gap: 16,
        marginBottom: 2,
        minHeight: 56,
        overflow: 'hidden',
        paddingHorizontal: 16,
        paddingVertical: 10,
      }}>
      {hasThumbnail ? (
        <Image
          source={{uri: thumbnail}}
          onError={() => setFailedThumbnail(thumbnail)}
          resizeMode="cover"
          resizeMethod="resize"
          style={{
            backgroundColor: colors.surfaceContainerHighest,
            borderRadius: 8,
            height: 40,
            width: 64,
          }}
        />
      ) : thumbnailPlaceholder ? (
        <View style={{backgroundColor: colors.surfaceContainerHighest, borderRadius: 8, height: 40, width: 64, alignItems: 'center', justifyContent: 'center'}}>
          <MaterialCommunityIcons name={icon || 'play-circle'} size={28} color={supportingColor} />
        </View>
      ) : icon ? (
        <MaterialCommunityIcons name={icon} size={22} color={supportingColor} />
      ) : null}
      <View style={{flex: 1, minWidth: 0}}>
        <AppText role="bodyLarge" numberOfLines={1} style={{color: contentColor}}>
          {title}
        </AppText>
        {!!supportingText && (
          <AppText
            role="bodyMedium"
            numberOfLines={1}
            style={{color: supportingColor, opacity: selected ? 0.8 : 1}}>
            {supportingText}
          </AppText>
        )}
      </View>
      {selected && (
        <MaterialCommunityIcons name="check" size={22} color={contentColor} />
      )}
    </Pressable>
  );
};

export const RemoteSheetEmpty: React.FC<{text: string}> = ({text}) => {
  const colors = useM3Colors();
  return (
    <AppText
      role="bodyMedium"
      style={{color: colors.onSurfaceVariant, paddingHorizontal: 16, paddingVertical: 24}}>
      {text}
    </AppText>
  );
};

export const RemoteSheetSectionLabel: React.FC<{text: string}> = ({text}) => {
  const colors = useM3Colors();
  return (
    <AppText
      role="labelLarge"
      style={{color: colors.primary, paddingHorizontal: 16, paddingBottom: 8, paddingTop: 16}}>
      {text}
    </AppText>
  );
};
