import React from 'react';
import {Text, View} from 'react-native';
import {styles} from './styles';

interface TitleProps {
  primary: string;
  secondary?: string;
  status?: string;
  scale?: number;
}

export const Title = (title: TitleProps) => {
  if (title) {
    return (
      <View style={[styles.control, _styles.title, {
        paddingTop: 0, paddingBottom: 0,
      }]}>
        <View style={{height: 40 * (title.scale ?? 1), justifyContent: 'center'}}>
        <Text style={[styles.text, _styles.titleText, {fontSize: 18 * (title.scale ?? 1), lineHeight: 24 * (title.scale ?? 1), includeFontPadding: false}]} numberOfLines={1}>
          {title.primary}
        </Text>
        </View>
        {title.secondary && (
          <Text
            style={[_styles.secondaryText, {color: 'hsl(0, 0%, 70%)', fontSize: 12 * (title.scale ?? 1), lineHeight: 16 * (title.scale ?? 1), includeFontPadding: false}]}
            numberOfLines={1}>
            {title.secondary}
          </Text>
        )}
        {title.status ? (
          <Text style={[_styles.statusText, {fontSize: 10 * (title.scale ?? 1)}]} numberOfLines={1}>
            {title.status}
          </Text>
        ) : null}
      </View>
    );
  }

  return null;
};

import {StyleSheet} from 'react-native';

const _styles = StyleSheet.create({
  title: {
    alignItems: 'flex-start',
    flexShrink: 1,
    flexDirection: 'column',
    padding: 0,
    marginRight: 0,
    marginTop: 0,
    minHeight: 37,
  },
  titleText: {
    textAlign: 'left',
  },
  statusText: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 2,
  },
  secondaryText: {
    fontSize: 12,
  },
});
