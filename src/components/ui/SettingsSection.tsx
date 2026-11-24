import React, {ReactNode} from 'react';
import {View} from 'react-native';
import Surface from './Surface';
import AppText from './Text';
import {isTV} from '../../lib/tv';

interface SettingsSectionProps {
  title: string;
  children: ReactNode;
  headerAction?: ReactNode;
}

const SettingsSection = ({title, children, headerAction}: SettingsSectionProps) => (
  <View className="mb-6">
    <View className="mb-3 flex-row items-center justify-between">
      <AppText role="labelLarge" className="text-m3-on-surface-variant">
        {title}
      </AppText>
      {headerAction}
    </View>
    <Surface level="low" className={isTV ? undefined : 'overflow-hidden'}>
      {children}
    </Surface>
  </View>
);

export default SettingsSection;
