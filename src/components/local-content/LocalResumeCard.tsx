import React from 'react';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../../App';
import type {LocalTitle} from '../../lib/localContent/model';
import {getLocalPlayerParams, getLocalResume} from '../../lib/localContent/playback';
import {watchProgressStorage} from '../../lib/storage';
import {EpisodeResumeCard} from '../EpisodeResumeCard';

export default function LocalResumeCard({title}: {title: LocalTitle}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const target = getLocalResume(title, uri => {
    return watchProgressStorage.getProgress(uri) || undefined;
  });
  if (!target) return null;
  return <EpisodeResumeCard target={target} onPress={() => {
    const params = getLocalPlayerParams(title, target.episode.uri);
    if (params) navigation.navigate('Player', params);
  }} />;
}
