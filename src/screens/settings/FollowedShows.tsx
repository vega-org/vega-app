import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Platform,
  ToastAndroid,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type {SettingsStackParamList} from '../../App';
import {SettingsSearchScrollView} from '../../components/ui/SettingsSearchTarget';
import {useFloatingTabBarInset} from '../../components/navigation/FloatingTabBarInsetContext';
import SettingsChoiceDialog from '../../components/ui/SettingsChoiceDialog';
import Button from '../../components/ui/Button';
import {showAppDialog} from '../../lib/zustand/appDialogStore';
import SettingsRow from '../../components/ui/SettingsRow';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingsSwitchRow from '../../components/ui/SettingsSwitchRow';
import AppText from '../../components/ui/Text';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {isTV} from '../../lib/tv';
import {EPISODE_CHECK_DAYS, formatEpisodeCheckTime, type EpisodeCheckSchedule} from '../../lib/episodeCheckSchedule';
import {
  EPISODE_UPDATE_INTERVAL_OPTIONS,
  getEpisodeUpdateIntervalLabel,
  type EpisodeUpdateInterval,
  type FollowedShow,
} from '../../lib/storage/FollowedShowsStorage';
import useFollowedShowsStore from '../../lib/zustand/followedShowsStore';
import {
  checkFollowedShows,
  syncEpisodeCheckSchedule,
} from '../../lib/services/episodeCheckService';
import notificationService from '../../lib/services/Notification';
import {episodeCheckNative} from '../../lib/services/episodeCheckNative';
import EpisodeCheckScheduleDialog from './components/EpisodeCheckScheduleDialog';
import SwipeToUnfollow from './components/SwipeToUnfollow';

type Props = NativeStackScreenProps<SettingsStackParamList, 'FollowedShows'>;

const intervalChoices = EPISODE_UPDATE_INTERVAL_OPTIONS.filter(
  option => option.value !== 'custom' || episodeCheckNative.supportsCustomSchedule(),
);
const scheduleSearchFallback = {'Custom schedule': 'Automatic updates'};

const formatCheckDate = (timestamp: number): string => new Date(timestamp).toLocaleString(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

const formatSchedule = ({days, hour, minute}: EpisodeCheckSchedule): string => {
  const repeat = days.length === 7 ? 'Every day' : EPISODE_CHECK_DAYS
    .filter(day => days.includes(day.value)).map(day => day.short).join(', ');
  return `${repeat} at ${formatEpisodeCheckTime(hour, minute)}`;
};

const formatLastChecked = (timestamp?: number): string => {
  if (!timestamp) {
    return 'Never checked';
  }
  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

const FollowedShowRow = ({
  show,
  divider,
  onOpen,
  onUnfollow,
}: {
  show: FollowedShow;
  divider: boolean;
  onOpen: (show: FollowedShow) => void;
  onUnfollow: (show: FollowedShow) => void;
}) => {
  const colors = useM3Colors();
  const statusLine = show.lastError
    ? `Check failed: ${show.lastError}`
    : `${show.knownEpisodeCount} ${show.knownEpisodeCount === 1 ? 'episode' : 'episodes'} tracked`;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomColor: colors.outlineVariant,
        borderBottomWidth: divider ? 1 : 0,
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 12,
      }}>
      <TVFocusable
        registerScreenFocus={false}
        accessibilityRole="button"
        accessibilityLabel={`Open ${show.title}`}
        borderRadius={12}
        onPress={() => onOpen(show)}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minWidth: 0,
        }}>
        {show.poster ? (
          <Image
            source={{uri: show.poster}}
            resizeMode="cover"
            style={{
              width: 44,
              height: 64,
              borderRadius: 8,
              backgroundColor: colors.surfaceContainerHighest,
            }}
          />
        ) : (
          <View
            style={{
              width: 44,
              height: 64,
              borderRadius: 8,
              backgroundColor: colors.surfaceContainerHighest,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <MaterialCommunityIcons
              name="television-classic"
              size={22}
              color={colors.onSurfaceVariant}
            />
          </View>
        )}
        <View style={{flex: 1, minWidth: 0}}>
          <AppText
            role="titleSmall"
            numberOfLines={1}
            style={{color: colors.onSurface}}>
            {show.title}
          </AppText>
          <AppText
            role="bodySmall"
            numberOfLines={1}
            style={{color: colors.onSurfaceVariant, marginTop: 2}}>
            {show.seasonTitle} • {show.providerName}
          </AppText>
          <AppText
            role="labelSmall"
            numberOfLines={1}
            style={{
              color: show.lastError ? colors.error : colors.primary,
              marginTop: 4,
            }}>
            {statusLine}
          </AppText>
        </View>
      </TVFocusable>
      <TVFocusable
        registerScreenFocus={false}
        accessibilityRole="button"
        accessibilityLabel={`Unfollow ${show.title}`}
        borderRadius={20}
        onPress={() => onUnfollow(show)}
        style={{
          width: 40,
          height: 40,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 20,
          backgroundColor: colors.surfaceContainerHighest,
        }}>
        <MaterialCommunityIcons
          name="bell-off-outline"
          size={20}
          color={colors.onSurfaceVariant}
        />
      </TVFocusable>
    </View>
  );
};

export default function FollowedShows({navigation}: Props) {
  const colors = useM3Colors();
  const floatingTabBarInset = useFloatingTabBarInset();
  const shows = useFollowedShowsStore(state => state.shows);
  const updateInterval = useFollowedShowsStore(state => state.updateInterval);
  const customSchedule = useFollowedShowsStore(state => state.customSchedule);
  const wifiOnly = useFollowedShowsStore(state => state.wifiOnly);
  const unfollowOnLibraryRemoval = useFollowedShowsStore(
    state => state.unfollowOnLibraryRemoval,
  );
  const unfollowOnContinueWatchingRemoval = useFollowedShowsStore(
    state => state.unfollowOnContinueWatchingRemoval,
  );
  const lastCheckedAt = useFollowedShowsStore(state => state.lastCheckedAt);
  const lastBackgroundCheckAt = useFollowedShowsStore(state => state.lastBackgroundCheckAt);
  const isChecking = useFollowedShowsStore(state => state.isChecking);
  const setUpdateInterval = useFollowedShowsStore(
    state => state.setUpdateInterval,
  );
  const setWifiOnly = useFollowedShowsStore(state => state.setWifiOnly);
  const setCustomSchedule = useFollowedShowsStore(state => state.setCustomSchedule);
  const setUnfollowOnLibraryRemoval = useFollowedShowsStore(
    state => state.setUnfollowOnLibraryRemoval,
  );
  const setUnfollowOnContinueWatchingRemoval = useFollowedShowsStore(
    state => state.setUnfollowOnContinueWatchingRemoval,
  );
  const unfollowShow = useFollowedShowsStore(state => state.unfollowShow);
  const unfollowAllShows = useFollowedShowsStore(state => state.unfollowAllShows);
  const reloadFromStorage = useFollowedShowsStore(
    state => state.reloadFromStorage,
  );

  const [showIntervalDialog, setShowIntervalDialog] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const activeCustomSchedule = updateInterval === 'custom' ? customSchedule : undefined;

  useFocusEffect(
    useCallback(() => {
      reloadFromStorage();
      if (!isTV) {
        return;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        navigation.goBack();
        return true;
      });
      return () => sub.remove();
    }, [navigation, reloadFromStorage]),
  );

  const handleSelectInterval = useCallback(
    (value: EpisodeUpdateInterval) => {
      setShowIntervalDialog(false);
      if (value === 'custom') {
        setShowScheduleDialog(true);
        return;
      }
      setUpdateInterval(value);
      if (value !== 'off') {
        notificationService.requestPermission().catch(() => {});
      }
      syncEpisodeCheckSchedule().catch(() => {});
    },
    [setUpdateInterval],
  );

  const handleSaveSchedule = useCallback((schedule: EpisodeCheckSchedule) => {
    setCustomSchedule(schedule);
    setShowScheduleDialog(false);
    notificationService.requestPermission().catch(() => {});
    syncEpisodeCheckSchedule().catch(() => {});
  }, [setCustomSchedule]);

  const handleToggleWifiOnly = useCallback(
    (value: boolean) => {
      setWifiOnly(value);
      syncEpisodeCheckSchedule().catch(() => {});
    },
    [setWifiOnly],
  );

  const handleCheckNow = useCallback(async () => {
    if (isChecking) {
      return;
    }
    if (shows.length === 0) {
      if (Platform.OS === 'android') {
        ToastAndroid.show('Follow a show first', ToastAndroid.SHORT);
      }
      return;
    }
    const summary = await checkFollowedShows({trigger: 'manual'});
    if (Platform.OS === 'android') {
      const message =
        summary.newEpisodeCount > 0
          ? `Found ${summary.newEpisodeCount} new ${summary.newEpisodeCount === 1 ? 'episode' : 'episodes'}`
          : summary.errors > 0
            ? `Checked ${summary.checkedCount}, ${summary.errors} failed`
            : 'No new episodes found';
      ToastAndroid.show(message, ToastAndroid.SHORT);
    }
  }, [isChecking, shows.length]);

  const handleOpenShow = useCallback(
    (show: FollowedShow) => {
      navigation.navigate('Info', {
        link: show.link,
        provider: show.provider,
        poster: show.poster || undefined,
      });
    },
    [navigation],
  );

  const handleUnfollow = useCallback(
    (show: FollowedShow) => {
      unfollowShow(show.id);
      syncEpisodeCheckSchedule().catch(() => {});
      if (Platform.OS === 'android') {
        ToastAndroid.show(`Unfollowed ${show.title}`, ToastAndroid.SHORT);
      }
    },
    [unfollowShow],
  );

  const handleClearAll = () => {
    showAppDialog({
      title: 'Clear followed shows?',
      message: 'This will unfollow every show and stop its episode alerts.',
      variant: 'warning',
      actions: [
        {label: 'Cancel'},
        {
          label: 'Clear all',
          variant: 'destructive',
          onPress: () => {
            unfollowAllShows();
            void syncEpisodeCheckSchedule();
          },
        },
      ],
    });
  };

  return (
    <TVFocusGuide autoFocus={true} trapFocusRight={true} style={{flex: 1}}>
      <SettingsSearchScrollView
        focusable={false}
        accessible={false}
        searchFallback={activeCustomSchedule ? undefined : scheduleSearchFallback}
        style={{backgroundColor: colors.background}}
        contentContainerStyle={{
          padding: 20,
          paddingBottom: 40 + floatingTabBarInset,
        }}
        showsVerticalScrollIndicator={false}>
        <View
          style={{
            alignItems: 'center',
            flexDirection: 'row',
            marginBottom: 24,
          }}>
          <TVFocusable
            hasTVPreferredFocus={isTV}
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={navigation.goBack}
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
            style={{color: colors.onBackground}}>
            Followed shows
          </AppText>
        </View>

        <SettingsSection title="Updates">
          <SettingsRow
            title="Automatic updates"
            description={getEpisodeUpdateIntervalLabel(updateInterval)}
            icon="update"
            onPress={() => setShowIntervalDialog(true)}
          />
          {activeCustomSchedule && (
            <SettingsRow
              title="Custom schedule"
              description={shows.length > 0
                ? `${formatSchedule(activeCustomSchedule)}\nNext check ${formatCheckDate(activeCustomSchedule.nextAt)}`
                : `${formatSchedule(activeCustomSchedule)}\nFollow a show to start checking`}
              icon="calendar-clock"
              onPress={() => setShowScheduleDialog(true)}
            />
          )}
          <SettingsSwitchRow
            title="Check on Wi-Fi only"
            description="Only run background episode checks on unmetered networks"
            value={wifiOnly}
            onValueChange={handleToggleWifiOnly}
          />
          <SettingsRow
            title="Check now"
            description={
              isChecking
                ? 'Checking providers for new episodes...'
                : `Last checked: ${formatLastChecked(lastCheckedAt)}`
            }
            icon="refresh"
            trailing={
              isChecking ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : undefined
            }
            onPress={handleCheckNow}
          />
          <SettingsRow
            title="Last background check"
            description={lastBackgroundCheckAt ? formatCheckDate(lastBackgroundCheckAt) : 'No background check recorded'}
            icon="history"
            divider={false}
          />
        </SettingsSection>

        <SettingsSection title="Auto-unfollow">
          <SettingsSwitchRow
            title="Unfollow when removed from Library"
            description="Stop episode alerts when you remove a show from your Library"
            value={unfollowOnLibraryRemoval}
            onValueChange={setUnfollowOnLibraryRemoval}
          />
          <SettingsSwitchRow
            title="Unfollow when removed from Continue Watching"
            description="Stop episode alerts when you remove a show from Continue Watching"
            value={unfollowOnContinueWatchingRemoval}
            onValueChange={setUnfollowOnContinueWatchingRemoval}
            divider={false}
          />
        </SettingsSection>

        <SettingsSection
          title={`Followed (${shows.length})`}
          headerAction={shows.length > 0 ? (
            <Button variant="text" compact onPress={handleClearAll}>Clear all</Button>
          ) : undefined}>
          {shows.length === 0 ? (
            <View
              style={{
                paddingHorizontal: 18,
                paddingVertical: 24,
                alignItems: 'center',
              }}>
              <MaterialCommunityIcons
                name="bell-outline"
                size={32}
                color={colors.onSurfaceVariant}
              />
              <AppText
                role="titleSmall"
                style={{color: colors.onSurface, marginTop: 10}}>
                No followed shows yet
              </AppText>
              <AppText
                role="bodySmall"
                style={{
                  color: colors.onSurfaceVariant,
                  textAlign: 'center',
                  marginTop: 4,
                }}>
                Tap the bell button on any show details page to get notified
                when a new episode drops on your provider.
              </AppText>
            </View>
          ) : (
            shows.map((show, index) => {
              const row = (
                <FollowedShowRow
                  key={show.id}
                  show={show}
                  divider={index < shows.length - 1}
                  onOpen={handleOpenShow}
                  onUnfollow={handleUnfollow}
                />
              );
              return isTV ? row : (
                <SwipeToUnfollow key={show.id} onUnfollow={() => handleUnfollow(show)}>
                  {row}
                </SwipeToUnfollow>
              );
            })
          )}
        </SettingsSection>
      </SettingsSearchScrollView>

      {showIntervalDialog && (
        <SettingsChoiceDialog
          title="Automatic updates"
          scrollable
          choices={intervalChoices}
          selected={updateInterval}
          onSelect={handleSelectInterval}
          onDismiss={() => setShowIntervalDialog(false)}
        />
      )}
      {showScheduleDialog && (
        <EpisodeCheckScheduleDialog
          initialSchedule={customSchedule}
          onSave={handleSaveSchedule}
          onDismiss={() => setShowScheduleDialog(false)}
        />
      )}
    </TVFocusGuide>
  );
}
