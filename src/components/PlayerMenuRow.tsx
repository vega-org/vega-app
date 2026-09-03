import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';

type PlayerMenuRowProps = {
  title: string;
  detail?: string;
  quality?: string;
  tags?: string[];
  selected?: boolean;
  accentColor: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
};

const PlayerMenuRow = ({
  title,
  detail,
  quality,
  tags,
  selected = false,
  accentColor,
  icon,
  onPress,
}: PlayerMenuRowProps) => {
  const allTags = [
    ...(quality && quality.trim() ? [quality.trim()] : []),
    ...(tags || []),
  ];

  return (
    <TouchableOpacity
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityState={{selected}}
      className="mx-1 my-1 min-h-12 flex-row items-center rounded-xl px-3 py-2.5"
      style={{
        backgroundColor: selected
          ? 'rgba(255,255,255,0.11)'
          : 'rgba(255,255,255,0.045)',
        borderWidth: 1,
        borderColor: selected ? accentColor : 'rgba(255,255,255,0.07)',
      }}
      onPress={onPress}>
      {icon && (
        <MaterialIcons
          name={icon}
          size={21}
          color={selected ? accentColor : 'rgba(255,255,255,0.78)'}
          style={{marginRight: 12}}
        />
      )}
      <View className="min-w-0 flex-1">
        <Text
          className="text-base font-semibold text-white"
          numberOfLines={1}>
          {title}
        </Text>
        {allTags.length > 0 && (
          <View className="flex-row items-center gap-1.5 flex-wrap mt-1">
            {allTags.map((t, idx) => (
              <View
                key={idx}
                className="rounded-md px-2 py-0.5"
                style={{backgroundColor: 'rgba(255,255,255,0.12)'}}>
                <Text className="text-[10px] font-bold text-white uppercase tracking-wider">
                  {t}
                </Text>
              </View>
            ))}
          </View>
        )}
        {!!detail && (
          <Text
            className="mt-0.5 text-xs text-white/55"
            numberOfLines={1}>
            {detail}
          </Text>
        )}
      </View>
      {selected && (
        <MaterialIcons
          name="check-circle"
          size={22}
          color={accentColor}
          style={{marginLeft: 12}}
        />
      )}
    </TouchableOpacity>
  );
};

export default PlayerMenuRow;

