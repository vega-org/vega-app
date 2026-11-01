import React, {useState} from 'react';
import {ScrollView, StatusBar, View} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import useLocalContentStore from '../../../lib/zustand/localContentStore';
import {useM3Colors} from '../../../theme/M3PaletteContext';
import {isTV} from '../../../lib/tv';
import {TVFocusable, TVFocusGuide} from '../../../components/tv';
import AppText from '../../../components/ui/Text';
import LocalSeasonList from '../../../components/local-content/LocalSeasonList';
import ScreenOverlayHost from '../../../components/ScreenOverlayHost';
import LocalMetadataDialog from '../../../components/metadata/LocalMetadataDialog';
import {useArtworkShape} from '../../../lib/hooks/useHomePageData';
import DetailsHero from './DetailsHero';

/** Imported files use the Downloads details screen, retaining its management actions. */
export default function ImportedFileDetails({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const colors = useM3Colors();
  const insets = useSafeAreaInsets();
  const title = useLocalContentStore(state =>
    state.titles.find(item => item.id === id),
  );
  const artworkUri = title?.metadata?.background || title?.metadata?.poster;
  const {ready: backdropReady, posterLike} = useArtworkShape(artworkUri);
  const hasArtwork = !!(title?.metadata?.background || title?.metadata?.poster);
  const [editingMetadata, setEditingMetadata] = useState(false);

  if (!title) {
    return (
      <TVFocusGuide
        autoFocus
        trapFocusRight
        style={{flex: 1, backgroundColor: '#000000'}}>
        <StatusBar translucent backgroundColor="transparent" />
        <ScreenOverlayHost>
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingTop: isTV ? 24 : insets.top + 12,
              paddingBottom: insets.bottom + 100,
            }}>
            <TVFocusable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hasTVPreferredFocus={isTV}
              onPress={onBack}
              borderRadius={18}
              style={{
                width: 48,
                height: 48,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}>
              <MaterialCommunityIcons
                name="arrow-left"
                size={26}
                color={colors.onSurface}
              />
            </TVFocusable>
            <AppText style={{color: colors.onSurfaceVariant}}>
              No imported files remain for this title.
            </AppText>
          </ScrollView>
        </ScreenOverlayHost>
      </TVFocusGuide>
    );
  }

  const backgroundImage =
    title.metadata?.background || title.metadata?.poster || '';
  const synopsis = title.metadata?.description;

  return (
    <TVFocusGuide
      autoFocus
      trapFocusRight
      style={{flex: 1, backgroundColor: '#000000'}}>
      <StatusBar translucent backgroundColor="transparent" />
      <ScreenOverlayHost>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingBottom: insets.bottom + 100,
          }}>
          <DetailsHero
            title={title.metadata?.title || title.name}
            backgroundImage={backgroundImage}
            posterLike={posterLike}
            backdropReady={backdropReady}
            hasArtwork={hasArtwork}
            synopsis={synopsis}
            subtitleRow={
              <AppText
                style={{color: colors.onSurfaceVariant, marginVertical: 12}}>
                {title.episodes.length} imported video
                {title.episodes.length === 1 ? '' : 's'}
              </AppText>
            }
            onBack={onBack}
          />
          <View className={`bg-black px-5 pb-6 ${synopsis ? '' : 'pt-3'}`}>
            <LocalSeasonList
              title={title}
              onEditMetadata={() => setEditingMetadata(true)}
            />
          </View>
        </ScrollView>
      </ScreenOverlayHost>
      <LocalMetadataDialog
        visible={editingMetadata}
        onClose={() => setEditingMetadata(false)}
        title={title}
      />
    </TVFocusGuide>
  );
}
