import {
  View,
  Pressable,
  Modal,
  TextInput,
  ActivityIndicator,
  ToastAndroid,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, {useState} from 'react';
import {TextTrackType} from 'react-native-video';
import DropdownField from './ui/DropdownField';
import AppText from './ui/Text';
import {useM3Colors} from '../theme/M3PaletteContext';
import {useTVFocusBorderColor} from '../lib/tv/useTVFocusBorderColor';
import PlayerMenuRow from './PlayerMenuRow';

export interface FoundSubtitle {
  type: TextTrackType;
  language: string;
  title: string;
  uri: string;
}

const SearchSubtitles = ({
  searchQuery,
  setSearchQuery,
  onAddSubtitle,
  renderTrigger,
}: {
  searchQuery: string;
  setSearchQuery: (text: string) => void;
  onAddSubtitle: (track: FoundSubtitle) => void;
  /** Replaces the default menu row that opens the search. */
  renderTrigger?: (open: () => void) => React.ReactNode;
}) => {
  const colors = useM3Colors();
  const primary = colors.primary;
  const focusBorderColor = useTVFocusBorderColor(primary);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [season, setSeason] = useState('');
  const [episode, setEpisode] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [subId, setSubId] = useState('eng');
  const [focusedControl, setFocusedControl] = useState<string | null>(null);

  const subLanguageIds = [
    {name: 'English', id: 'eng'},
    {name: 'Spanish', id: 'spa'},
    {name: 'French', id: 'fre'},
    {name: 'German', id: 'ger'},
    {name: 'Italian', id: 'ita'},
    {name: 'Portuguese', id: 'por'},
    {name: 'Russian', id: 'rus'},
    {name: 'Chinese', id: 'chi'},
    {name: 'Japanese', id: 'jpn'},
    {name: 'Korean', id: 'kor'},
    {name: 'Arabic', id: 'ara'},
    {name: 'Hindi', id: 'hin'},
    {name: 'Dutch', id: 'dut'},
    {name: 'Swedish', id: 'swe'},
    {name: 'Polish', id: 'pol'},
    {name: 'Turkish', id: 'tur'},
    {name: 'Danish', id: 'dan'},
    {name: 'Norwegian', id: 'nor'},
    {name: 'Finnish', id: 'fin'},
    {name: 'Vietnamese', id: 'vie'},
    {name: 'Indonesian', id: 'ind'},
  ];

  const searchSubtitles = async () => {
    if (loading || !searchQuery.trim()) return;
    try {
      setError('');
      setLoading(true);
      console.log(
        'openSubtitles',
        `https://rest.opensubtitles.org/search${
          episode ? '/episode-' + episode : ''
        }${
          (searchQuery?.startsWith('tt') ? '/imdbid-' : '/query-') +
          encodeURIComponent(searchQuery.toLocaleLowerCase())
        }${season ? '/season-' + season : ''}${
          subId ? '/sublanguageid-' + subId : ''
        }`,
      );
      const response = await fetch(
        `https://rest.opensubtitles.org/search${
          episode ? '/episode-' + episode : ''
        }${
          (searchQuery?.startsWith('tt') ? '/imdbid-' : '/query-') +
          encodeURIComponent(searchQuery.toLocaleLowerCase())
        }${season ? '/season-' + season : ''}${
          subId ? '/sublanguageid-' + subId : ''
        }`,
        {
          method: 'GET',
          headers: {
            'x-user-agent': 'VLSub 0.10.2',
          },
        },
      );
      console.log('openSubtitles⭐', response);
      if (!response.ok) throw new Error(`Subtitle search failed (${response.status})`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('Unexpected subtitle search response');
      setLoading(false);
      if (data?.length === 0) {
        setError('No Results Found');
        setSearchResults([]);
        return;
      }
      setSearchResults(data);
    } catch (e: any) {
      console.log('openSubtitles err', e);
      setLoading(false);
      setError(e?.message);
      ToastAndroid.show('Error fetching subtitles', ToastAndroid.SHORT);
    }
  };
  return (
    <View>
      {renderTrigger ? (
        renderTrigger(() => setSearchModalVisible(true))
      ) : (
        <PlayerMenuRow
          title="Search subtitles online"
          detail="Find subtitles for this video"
          accentColor={primary}
          icon="travel-explore"
          onPress={() => setSearchModalVisible(true)}
        />
      )}
      <Modal
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent
        visible={searchModalVisible}
        onRequestClose={() => {
          setSearchModalVisible(false);
        }}>
        <SafeAreaView
          edges={['top', 'bottom', 'left', 'right']}
          style={{flex: 1, backgroundColor: '#0B0B0B'}}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{flex: 1}}>
          <View
            style={{flex: 1, alignSelf: 'center', width: '100%', maxWidth: 1120, paddingHorizontal: 16, minWidth: 0}}>
            <View className="flex-row items-center py-3">
              <Pressable
                accessibilityLabel="Close subtitle search"
                accessibilityRole="button"
                focusable={true}
                isTVSelectable={true}
                hasTVPreferredFocus={true}
                onFocus={() => setFocusedControl('close')}
                onBlur={() => setFocusedControl(null)}
                style={{
                  height: 44,
                  width: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 22,
                  backgroundColor: focusedControl === 'close'
                    ? 'rgba(255,255,255,0.22)'
                    : 'rgba(255,255,255,0.08)',
                  borderWidth: focusedControl === 'close' ? 2 : 0,
                  borderColor: focusBorderColor,

                }}
                onPress={() => setSearchModalVisible(false)}>
                <MaterialIcons name="arrow-back" size={25} color="white" />
              </Pressable>
              <View className="ml-3" style={{flex: 1, minWidth: 0}}>
                <AppText className="text-white text-xl font-bold">
                  Search subtitles
                </AppText>
                <AppText className="text-white/50 text-xs">
                  Search by title or IMDb ID
                </AppText>
              </View>
            </View>

            <ScrollView
              style={{flex: 1, minWidth: 0}}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{flexGrow: 1, paddingBottom: 24}}>
            <View
              className="rounded-3xl p-3"
              style={{
                backgroundColor: 'rgba(20,20,20,0.92)',
                borderColor: 'rgba(255,255,255,0.1)',
                borderWidth: 1,
              }}>
              <TextInput
                placeholder="Title or IMDb ID"
                placeholderTextColor="rgba(255,255,255,0.42)"
                returnKeyType="search"
                className="h-14 rounded-2xl px-4 text-base text-white"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.065)',
                  borderColor: 'rgba(255,255,255,0.1)',
                  borderWidth: 1,
                }}
                onChangeText={text => setSearchQuery(text)}
                onSubmitEditing={searchSubtitles}
                value={searchQuery}
              />

              <View style={{marginTop: 12, gap: 12}}>
                <DropdownField
                  options={subLanguageIds}
                  value={subLanguageIds.find(option => option.id === subId)}
                  getKey={option => option.id}
                  getLabel={option => option.name}
                  onChange={option => setSubId(option.id)}
                />
                <View style={{flexDirection: 'row', gap: 12}}>
                  <TextInput
                    accessibilityLabel="Season number (optional)"
                    placeholder="Season"
                    placeholderTextColor="#A9A9A9"
                    keyboardType="numeric"
                    style={{flex: 1, minWidth: 0, minHeight: 56, borderRadius: 16,
                      paddingHorizontal: 16, fontSize: 16, color: '#FFFFFF',
                      backgroundColor: '#222222', borderColor: '#3B3B3B', borderWidth: 1}}
                    onChangeText={setSeason}
                    value={season}
                  />
                  <TextInput
                    accessibilityLabel="Episode number (optional)"
                    placeholder="Episode"
                    placeholderTextColor="#A9A9A9"
                    keyboardType="numeric"
                    style={{flex: 1, minWidth: 0, minHeight: 56, borderRadius: 16,
                      paddingHorizontal: 16, fontSize: 16, color: '#FFFFFF',
                      backgroundColor: '#222222', borderColor: '#3B3B3B', borderWidth: 1}}
                    onChangeText={setEpisode}
                    value={episode}
                  />
                </View>
                <Pressable
                  accessibilityLabel="Search subtitles"
                  accessibilityRole="button"
                  accessibilityState={{disabled: loading || !searchQuery.trim(), busy: loading}}
                  focusable={true}
                  isTVSelectable={true}
                  disabled={loading || !searchQuery.trim()}
                  onFocus={() => setFocusedControl('search')}
                  onBlur={() => setFocusedControl(null)}
                  style={{
                    minHeight: 56, width: '100%', flexDirection: 'row', gap: 8,
                    alignItems: 'center', justifyContent: 'center', borderRadius: 16,
                    paddingHorizontal: 20, paddingVertical: 12,
                    backgroundColor: loading || !searchQuery.trim() ? '#454545' : '#F0EBE5',
                    borderWidth: 3, borderColor: focusedControl === 'search' ? focusBorderColor : 'transparent',
                  }}
                  onPress={searchSubtitles}>
                  {loading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <MaterialIcons name="search" size={24}
                      color={!searchQuery.trim() ? '#D0D0D0' : '#211F1E'} />
                  )}
                  <AppText role="labelLarge" style={{fontWeight: '700',
                    color: loading || !searchQuery.trim() ? '#D0D0D0' : '#211F1E'}}>
                    {loading ? 'Searching…' : 'Search'}
                  </AppText>
                </Pressable>
              </View>
            </View>

            <View style={{flex: 1, marginTop: 12, minHeight: 160}}>
              {loading ? (
                <View style={{flex: 1, minHeight: 160, alignItems: 'center', justifyContent: 'center'}}>
                  <ActivityIndicator size="large" color="#FFFFFF" />
                </View>
              ) : (
                searchResults.map((result: any) => (
                  <Pressable
                    key={result?.IDSubtitleFile}
                    focusable={true}
                    isTVSelectable={true}
                    onFocus={() => setFocusedControl(String(result?.IDSubtitleFile))}
                    onBlur={() => setFocusedControl(null)}
                    style={{
                      marginVertical: 6, flexDirection: 'row', alignItems: 'center',
                      borderRadius: 16, padding: 12,
                      backgroundColor: focusedControl === String(result?.IDSubtitleFile)
                        ? 'rgba(255, 255, 255, 0.16)'
                        : 'rgba(255,255,255,0.055)',
                      borderColor: focusedControl === String(result?.IDSubtitleFile)
                        ? focusBorderColor
                        : 'rgba(255,255,255,0.09)',
                      borderWidth: focusedControl === String(result?.IDSubtitleFile) ? 2.5 : 1,
                    }}
                    onPress={() => {
                      setSearchModalVisible(false);
                      onAddSubtitle({
                        type: TextTrackType.SUBRIP,
                        language: result?.ISO639,
                        title:
                          result?.InfoReleaseGroup +
                          ' ' +
                          result?.UserNickName,
                        uri: result?.SubDownloadLink?.replace('.gz', ''),
                      });
                    }}>
                    <View
                      className="mr-3 min-w-14 items-center rounded-xl px-2 py-2"
                      style={{backgroundColor: colors.primaryContainer}}>
                      <AppText
                        className="text-xs font-bold uppercase"
                        style={{color: colors.onPrimaryContainer}}>
                        {result?.ISO639 || result?.SubLanguageID || 'SUB'}
                      </AppText>
                    </View>
                    <View className="min-w-0 flex-1">
                      <AppText
                        className="text-white text-base font-semibold"
                        numberOfLines={1}>
                        {result?.MovieName?.trim() || 'Untitled subtitle'}
                      </AppText>
                      <AppText
                        className="mt-1 text-white/50 text-xs"
                        numberOfLines={1}>
                        {[result?.InfoReleaseGroup, result?.UserNickName]
                          .filter(Boolean)
                          .join(' · ')}
                      </AppText>
                    </View>
                    {(Number(result?.SeriesSeason) > 0 ||
                      Number(result?.SeriesEpisode) > 0) && (
                      <View className="mx-3 flex-row" style={{gap: 6}}>
                        {Number(result?.SeriesSeason) > 0 && (
                          <AppText className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/75">
                            S{result?.SeriesSeason}
                          </AppText>
                        )}
                        {Number(result?.SeriesEpisode) > 0 && (
                          <AppText className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/75">
                            E{result?.SeriesEpisode}
                          </AppText>
                        )}
                      </View>
                    )}
                    <MaterialIcons name="add" size={22} color={primary} />
                  </Pressable>
                ))
              )}
              {searchResults.length === 0 && !loading && (
                <View className="w-full h-full justify-center items-center">
                  <MaterialIcons
                    name={error ? 'error-outline' : 'subtitles'}
                    size={38}
                    color={error ? colors.error : colors.onSurfaceVariant}
                  />
                  <AppText
                    className="mt-3 text-base font-semibold"
                    style={{
                      color: error ? colors.error : colors.onSurfaceVariant,
                    }}>
                    {error || 'Search to find available subtitles'}
                  </AppText>
                </View>
              )}
            </View>
            </ScrollView>
          </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
};

export default SearchSubtitles;
