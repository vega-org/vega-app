import {View, Text, ScrollView, TouchableOpacity} from 'react-native';
import React from 'react';
import useContentStore from '../lib/zustand/contentStore';
import useThemeStore from '../lib/zustand/themeStore';
import {BlurView} from 'expo-blur';
import {MaterialIcons} from '@expo/vector-icons';

const ProviderDrawer = ({onClose}: {onClose: () => void}) => {
  const {provider, setProvider, installedProviders} = useContentStore(
    state => state,
  );
  const {primary} = useThemeStore(state => state);

  return (
    <BlurView
      intensity={90}
      experimentalBlurMethod="dimezisBlurView"
      blurReductionFactor={5}
      tint="dark"
      className="flex-1">
      <View className="mt-8 px-4 pb-4 border-b border-white/10">
        <Text className="text-white text-2xl font-bold">Select Provider</Text>
        <Text className="text-gray-400 mt-1 text-sm">Content source</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} className="flex-1 px-2">
        {installedProviders.map(item => (
          <TouchableOpacity
            key={item.value}
            onPress={() => {
              setProvider(item);
              onClose();
            }}
            className={`flex-row items-center justify-between p-4 my-1 rounded-lg ${
              provider.value === item.value ? 'bg-white/10' : 'bg-transparent'
            }`}>
            <View className="flex-row items-center">
              <MaterialIcons
                name="movie"
                size={20}
                color={provider.value === item.value ? primary : '#888'}
              />
              <Text
                className={`ml-3 text-base ${
                  provider.value === item.value
                    ? 'text-white font-medium'
                    : 'text-gray-400'
                }`}>
                {item.display_name}
              </Text>
            </View>
            {provider.value === item.value && (
              <MaterialIcons name="check" size={20} color={primary} />
            )}
          </TouchableOpacity>
        ))}
        <View className="h-16" />
      </ScrollView>
    </BlurView>
  );
};

export default ProviderDrawer;
