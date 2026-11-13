import React from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {Control} from '../Control';

interface BackProps {
  onBack: () => void;
  resetControlTimeout?: () => void;
  showControls: boolean;
  scale?: number;
}

export const Back = ({onBack, showControls, scale = 1}: BackProps) => {
  return (
    <Control callback={onBack} disabled={!showControls}
      style={{width: 40 * scale, height: 40 * scale, padding: 8 * scale,
        alignItems: 'center', justifyContent: 'center'}}>
      <MaterialIcons
        name="arrow-back-ios-new"
        size={20 * scale}
        color="rgba(255,255,255,0.68)"
      />
    </Control>
  );
};
