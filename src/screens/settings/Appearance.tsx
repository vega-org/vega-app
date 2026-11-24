import {SettingsSearchScrollView} from '../../components/ui/SettingsSearchTarget';
import {useFocusEffect} from '@react-navigation/native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import React, {useEffect, useCallback} from 'react';
import {BackHandler, View} from 'react-native';
import type {SettingsStackParamList} from '../../App';
import AppearancePreference from './components/AppearancePreference';
import AppText from '../../components/ui/Text';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import {isTV} from '../../lib/tv';

type Props = NativeStackScreenProps<SettingsStackParamList, 'Appearance'>;

const Appearance = ({navigation}: Props) => {
  const colors = useM3Colors();

  // Register only while this screen is focused. A hidden screen in a
  // mounted tab or stack must not swallow back presses.
  useFocusEffect(
    useCallback(() => {
      if (!isTV) {
        return;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        navigation.goBack();
        return true;
      });
      return () => sub.remove();
    }, [navigation]),
  );

  return (
    <TVFocusGuide autoFocus={true} trapFocusRight={true} style={{flex: 1}}>
      <SettingsSearchScrollView
        focusable={false}
        accessible={false}
        style={{backgroundColor: colors.background}}
        contentContainerStyle={{padding: 20, paddingBottom: 40}}
        showsVerticalScrollIndicator={false}>
        <View
          style={{alignItems: 'center', flexDirection: 'row', marginBottom: 24}}>
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
            Appearance
          </AppText>
        </View>
        <AppearancePreference />
      </SettingsSearchScrollView>
    </TVFocusGuide>
  );
};

export default Appearance;
