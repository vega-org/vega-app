import {
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  TouchableNativeFeedback,
  ScrollView,
} from 'react-native';
import React from 'react';
import {startActivityAsync, ActivityAction} from 'expo-intent-launcher';
import {settingsStorage} from '../../lib/storage';
import useThemeStore from '../../lib/zustand/themeStore';
import {Feather, Entypo} from '@expo/vector-icons';

const SubtitlePreference = () => {
  const [fontSize, setFontSize] = React.useState(
    settingsStorage.getSubtitleFontSize(),
  );
  const [opacity, setOpacity] = React.useState(
    settingsStorage.getSubtitleOpacity(),
  );
  const [bottomElevation, setBottomElevation] = React.useState(
    settingsStorage.getSubtitleBottomPadding(),
  );
  const {primary} = useThemeStore();

  const handleSubtitleSize = (action: 'increase' | 'decrease') => {
    if (fontSize < 5 || fontSize > 30) return;
    if (action === 'increase') {
      const newSize = Math.min(fontSize + 1, 30);
      settingsStorage.setSubtitleFontSize(newSize);
      setFontSize(newSize);
    }
    if (action === 'decrease') {
      const newSize = Math.max(fontSize - 1, 10);
      settingsStorage.setSubtitleFontSize(newSize);
      setFontSize(newSize);
    }
  };

  const handleSubtitleOpacity = (action: 'increase' | 'decrease') => {
    if (action === 'increase') {
      const newOpacity = Math.min(opacity + 0.1, 1).toFixed(1);
      settingsStorage.setSubtitleOpacity(parseFloat(newOpacity));
      setOpacity(parseFloat(newOpacity));
    }
    if (action === 'decrease') {
      const newOpacity = Math.max(opacity - 0.1, 0).toFixed(1);
      settingsStorage.setSubtitleOpacity(parseFloat(newOpacity));
      setOpacity(parseFloat(newOpacity));
    }
  };

  const handleSubtitleBottomPadding = (action: 'increase' | 'decrease') => {
    if (bottomElevation < 0 || bottomElevation > 99) return;
    if (action === 'increase') {
      const newPadding = Math.min(bottomElevation + 1, 99);
      settingsStorage.setSubtitleBottomPadding(newPadding);
      setBottomElevation(newPadding);
    }
    if (action === 'decrease') {
      const newPadding = Math.max(bottomElevation - 1, 0);
      settingsStorage.setSubtitleBottomPadding(newPadding);
      setBottomElevation(newPadding);
    }
  };

  return (
    <ScrollView
      className="w-full h-full bg-black"
      contentContainerStyle={{
        paddingTop: StatusBar.currentHeight || 0,
      }}>
      <View className="p-5">
        <Text className="text-2xl font-bold text-white mb-6">
          Subtitle Preferences
        </Text>

        <View className="bg-[#1A1A1A] rounded-xl overflow-hidden">
          <View className="flex-row items-center justify-between p-4 border-b border-[#262626]">
            <Text className="text-white text-base">Font Size</Text>
            <View className="flex-row items-center gap-4">
              <TouchableOpacity onPress={() => handleSubtitleSize('decrease')}>
                <Entypo name="minus" size={23} color={primary} />
              </TouchableOpacity>
              <Text className="text-white text-base bg-[#262626] px-3 rounded-md w-12 text-center">
                {fontSize}
              </Text>
              <TouchableOpacity onPress={() => handleSubtitleSize('increase')}>
                <Entypo name="plus" size={23} color={primary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* opacity */}
          <View className="flex-row items-center justify-between p-4 border-b border-[#262626]">
            <Text className="text-white text-base">Opacity</Text>
            <View className="flex-row items-center gap-4">
              <TouchableOpacity
                onPress={() => handleSubtitleOpacity('decrease')}>
                <Entypo name="minus" size={23} color={primary} />
              </TouchableOpacity>
              <Text className="text-white text-base bg-[#262626] px-3 rounded-md w-12 text-center">
                {opacity}
              </Text>
              <TouchableOpacity
                onPress={() => handleSubtitleOpacity('increase')}>
                <Entypo name="plus" size={23} color={primary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* bottom padding */}
          <View className="flex-row items-center justify-between p-4 border-b border-[#262626]">
            <Text className="text-white text-base">Bottom Elevation</Text>
            <View className="flex-row items-center gap-4">
              <TouchableOpacity
                onPress={() => handleSubtitleBottomPadding('decrease')}>
                <Entypo name="minus" size={23} color={primary} />
              </TouchableOpacity>
              <Text className="text-white text-base bg-[#262626] px-3 rounded-md w-12 text-center">
                {bottomElevation}
              </Text>
              <TouchableOpacity
                onPress={() => handleSubtitleBottomPadding('increase')}>
                <Entypo name="plus" size={23} color={primary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* More Settings */}
          <TouchableNativeFeedback
            onPress={async () => {
              await startActivityAsync(ActivityAction.CAPTIONING_SETTINGS);
            }}
            background={TouchableNativeFeedback.Ripple('#333333', false)}>
            <View className="flex-row items-center justify-between p-4 border-b border-[#262626]">
              <View className="flex-row items-center">
                <Text className="text-white text-base">
                  More Subtitle Settings
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color="gray" />
            </View>
          </TouchableNativeFeedback>

          {/* reset */}
          <View className="flex-row items-center justify-between p-4 border-b border-[#262626]">
            <Text className="text-white text-base">Reset to Default</Text>
            <TouchableOpacity
              onPress={() => {
                settingsStorage.setSubtitleFontSize(16);
                settingsStorage.setSubtitleOpacity(1);
                settingsStorage.setSubtitleBottomPadding(10);
                setFontSize(16);
                setOpacity(1);
                setBottomElevation(10);
              }}>
              <View className="w-32 flex-row items-center justify-center">
                <Text className="text-white text-base bg-[#262626] px-3 py-1 rounded-md text-center">
                  Reset
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
        <View className="h-16" />
      </View>
    </ScrollView>
  );
};

export default SubtitlePreference;
