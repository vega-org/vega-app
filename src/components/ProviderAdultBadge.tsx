import React from 'react';
import {Text} from 'react-native';
import {useM3Colors} from '../theme/M3PaletteContext';

export default function ProviderAdultBadge() {
  const colors = useM3Colors();
  return (
    <Text
      accessibilityLabel="18 plus provider"
      style={{
        backgroundColor: colors.errorContainer,
        color: colors.onErrorContainer,
        borderRadius: 4,
        paddingHorizontal: 4,
        marginLeft: 4,
        fontSize: 10,
        fontWeight: '700',
      }}>
      18+
    </Text>
  );
}
