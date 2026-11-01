import React, {useEffect, useState} from 'react';
import {Image, ScrollView, View} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {isTV} from '../lib/tv';
import {useM3Colors} from '../theme/M3PaletteContext';
import {useTVFocusBorderColor} from '../lib/tv/useTVFocusBorderColor';
import MaterialDialogSurface from './ui/MaterialDialogSurface';
import Text from './ui/Text';
import {TVFocusable} from './tv';
import {getValidImageUri} from './EpisodeRowContent';

export interface EpisodeDetailsDialogProps {
  visible: boolean;
  title: string;
  description: string;
  image?: string;
  onDismiss: () => void;
}

export const EpisodeDetailsDialog: React.FC<EpisodeDetailsDialogProps> = ({
  visible,
  title,
  description,
  image,
  onDismiss,
}) => {
  const colors = useM3Colors();
  const focusBorderColor = useTVFocusBorderColor();
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [image]);

  return (
    <MaterialDialogSurface
      visible={visible}
      onDismiss={onDismiss}
      style={{padding: 0}}>
      {getValidImageUri(image) && !imageFailed ? (
        <Image
          source={{uri: getValidImageUri(image)}}
          resizeMode="cover"
          resizeMethod="resize"
          onError={() => setImageFailed(true)}
          style={{aspectRatio: 16 / 9, width: '100%'}}
        />
      ) : (
        <View
          style={{
            alignItems: 'center',
            aspectRatio: 16 / 9,
            backgroundColor: colors.surfaceContainerHighest,
            justifyContent: 'center',
            width: '100%',
          }}>
          <MaterialCommunityIcons
            name="image-off-outline"
            size={44}
            color={colors.onSurfaceVariant}
          />
        </View>
      )}
      <View style={{padding: 20}}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}>
          <Text
            role="titleLarge"
            style={{
              color: colors.onSurface,
              fontWeight: '700',
              flex: 1,
              marginRight: 8,
            }}>
            {title}
          </Text>
          {isTV && (
            <TVFocusable
              hasTVPreferredFocus={true}
              accessibilityRole="button"
              accessibilityLabel="Close"
              borderRadius={18}
              focusScale={1}
              focusBorderColor={focusBorderColor}
              onPress={onDismiss}
              style={{padding: 4}}>
              <MaterialCommunityIcons
                name="close"
                size={24}
                color="#CCCCCC"
              />
            </TVFocusable>
          )}
        </View>
        <ScrollView style={{maxHeight: 230}} showsVerticalScrollIndicator={false}>
          <Text
            role="bodyMedium"
            style={{
              color: colors.onSurfaceVariant,
              lineHeight: 22,
              marginTop: 4,
            }}>
            {description}
          </Text>
        </ScrollView>
        {isTV && (
          <TVFocusable
            accessibilityRole="button"
            accessibilityLabel="Close episode details"
            borderRadius={14}
            focusScale={1}
            focusBorderColor={focusBorderColor}
            onPress={onDismiss}
            style={{
              marginTop: 16,
              paddingVertical: 12,
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              borderRadius: 14,
              alignItems: 'center',
            }}>
            <Text style={{color: '#FFFFFF', fontWeight: '600', fontSize: 15}}>
              Close
            </Text>
          </TVFocusable>
        )}
      </View>
    </MaterialDialogSurface>
  );
};

export default EpisodeDetailsDialog;
