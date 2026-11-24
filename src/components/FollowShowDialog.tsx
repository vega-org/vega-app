import React, {useEffect, useMemo, useState} from 'react';
import {Platform, ToastAndroid, View} from 'react-native';
import type {EpisodeLink, Link} from '../lib/providers/types';
import {createFollowedShowId} from '../lib/storage/FollowedShowsStorage';
import useFollowedShowsStore from '../lib/zustand/followedShowsStore';
import {
  buildEpisodeSnapshot,
  syncEpisodeCheckSchedule,
} from '../lib/services/episodeCheckService';
import {providerManager} from '../lib/services/ProviderManager';
import {extensionManager} from '../lib/services';
import notificationService from '../lib/services/Notification';
import {useM3Colors} from '../theme/M3PaletteContext';
import MaterialDialogSurface from './ui/MaterialDialogSurface';
import DropdownField from './ui/DropdownField';
import Button from './ui/Button';
import AppText from './ui/Text';

interface SeasonOption {
  index: number;
  title: string;
  season: Link;
}

interface FollowShowDialogProps {
  visible: boolean;
  onClose: () => void;
  link: string;
  provider: string;
  providerName: string;
  title: string;
  poster: string;
  seasons: Link[];
  activeSeasonIndex: number;
  activeSeasonEpisodes?: EpisodeLink[];
  onOpenSettings?: () => void;
}

export default function FollowShowDialog({
  visible,
  onClose,
  link,
  provider,
  providerName,
  title,
  poster,
  seasons,
  activeSeasonIndex,
  activeSeasonEpisodes,
  onOpenSettings,
}: FollowShowDialogProps) {
  const colors = useM3Colors();
  const showId = createFollowedShowId(provider, link);
  const existingShow = useFollowedShowsStore(state =>
    state.shows.find(item => item.id === showId),
  );
  const updateInterval = useFollowedShowsStore(state => state.updateInterval);
  const followShow = useFollowedShowsStore(state => state.followShow);
  const unfollowShow = useFollowedShowsStore(state => state.unfollowShow);

  const seasonOptions = useMemo<SeasonOption[]>(
    () =>
      seasons.map((season, index) => ({
        index,
        title: season.title || `Season ${index + 1}`,
        season,
      })),
    [seasons],
  );

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || seasonOptions.length === 0) {
      return;
    }
    if (existingShow) {
      const byTitle = seasonOptions.findIndex(
        option => option.title === existingShow.seasonTitle,
      );
      if (byTitle >= 0) {
        setSelectedIndex(byTitle);
        return;
      }
      if (
        existingShow.seasonIndex >= 0 &&
        existingShow.seasonIndex < seasonOptions.length
      ) {
        setSelectedIndex(existingShow.seasonIndex);
        return;
      }
    }
    const clamped = Math.max(
      0,
      Math.min(activeSeasonIndex, seasonOptions.length - 1),
    );
    setSelectedIndex(clamped);
  }, [activeSeasonIndex, existingShow, seasonOptions, visible]);

  const selectedOption =
    seasonOptions[selectedIndex] ?? seasonOptions[0] ?? undefined;

  const resolveBaselineEpisodes = async (
    option: SeasonOption,
  ): Promise<Array<{id?: string; link?: string; title?: string}>> => {
    if (
      option.index === activeSeasonIndex &&
      Array.isArray(activeSeasonEpisodes) &&
      activeSeasonEpisodes.length > 0
    ) {
      return activeSeasonEpisodes;
    }
    if (Array.isArray(option.season.directLinks) && option.season.directLinks.length > 0) {
      return option.season.directLinks;
    }
    if (
      option.season.episodesLink &&
      extensionManager.getProviderModules(provider)?.modules.episodes
    ) {
      try {
        const fetched = await providerManager.getEpisodes({
          url: option.season.episodesLink,
          providerValue: provider,
          silent: true,
        });
        if (Array.isArray(fetched)) {
          return fetched;
        }
      } catch {
        return [];
      }
    }
    return [];
  };

  const handleSave = async () => {
    if (!selectedOption || saving) {
      return;
    }
    setSaving(true);
    try {
      const episodes = await resolveBaselineEpisodes(selectedOption);
      const snapshot = buildEpisodeSnapshot(episodes);
      followShow({
        link,
        provider,
        providerName,
        title,
        poster,
        seasonTitle: selectedOption.title,
        seasonIndex: selectedOption.index,
        episodesLink: selectedOption.season.episodesLink,
        knownEpisodeKeys: snapshot.knownEpisodeKeys,
        knownEpisodeTitles: snapshot.knownEpisodeTitles,
        knownEpisodeCount: snapshot.knownEpisodeCount,
      });
      notificationService.requestPermission().catch(() => {});
      syncEpisodeCheckSchedule().catch(() => {});
      if (Platform.OS === 'android') {
        ToastAndroid.show(
          existingShow ? `Updated ${title}` : `Following ${title}`,
          ToastAndroid.SHORT,
        );
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleUnfollow = () => {
    unfollowShow(showId);
    syncEpisodeCheckSchedule().catch(() => {});
    if (Platform.OS === 'android') {
      ToastAndroid.show(`Unfollowed ${title}`, ToastAndroid.SHORT);
    }
    onClose();
  };

  return (
    <MaterialDialogSurface visible={visible} onDismiss={onClose}>
      <AppText
        role="titleLarge"
        style={{color: colors.onSurface, marginBottom: 8}}>
        {existingShow ? 'Following show' : 'Follow show'}
      </AppText>
      <AppText
        role="bodyMedium"
        style={{color: colors.onSurfaceVariant, marginBottom: 16}}>
        Vega checks {providerName} periodically for new episodes in the chosen
        season and notifies you when one drops.
      </AppText>

      {selectedOption && (
        <View style={{marginBottom: 16}}>
          <AppText
            role="labelMedium"
            style={{color: colors.onSurfaceVariant, marginBottom: 8}}>
            Season to follow
          </AppText>
          <DropdownField
            options={seasonOptions}
            value={selectedOption}
            getKey={option => `${option.index}:${option.title}`}
            getLabel={option => option.title}
            onChange={option => setSelectedIndex(option.index)}
          />
        </View>
      )}

      {updateInterval === 'off' && (
        <View
          style={{
            backgroundColor: colors.surfaceContainerHighest,
            borderRadius: 12,
            padding: 12,
            marginBottom: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}>
          <AppText
            role="bodySmall"
            style={{color: colors.onSurfaceVariant, flex: 1}}>
            Automatic updates are currently off. Turn them on in Settings →
            Followed shows.
          </AppText>
          {onOpenSettings && (
            <Button
              variant="text"
              onPress={() => {
                onClose();
                onOpenSettings();
              }}>
              Settings
            </Button>
          )}
        </View>
      )}

      <View
        style={{
          flexDirection: 'row',
          justifyContent: existingShow ? 'space-between' : 'flex-end',
          alignItems: 'center',
          gap: 8,
        }}>
        {existingShow && (
          <Button variant="text" onPress={handleUnfollow} disabled={saving}>
            Unfollow
          </Button>
        )}
        <View style={{flexDirection: 'row', gap: 8}}>
          <Button variant="text" onPress={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="filled"
            onPress={handleSave}
            disabled={!selectedOption || saving}>
            {saving ? 'Saving...' : existingShow ? 'Save' : 'Follow'}
          </Button>
        </View>
      </View>
    </MaterialDialogSurface>
  );
}
