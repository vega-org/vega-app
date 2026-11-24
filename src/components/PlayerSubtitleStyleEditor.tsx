import React from 'react';
import {Text, View} from 'react-native';
import {settingsStorage} from '../lib/storage';
import {StyleSlider} from './PlayerControlStyleEditor';

export type SubtitleQuickStyle = {
  fontSize: number;
  textOpacity: number;
  opacity: number;
  paddingBottom: number;
};

export const readSubtitleQuickStyle = (): SubtitleQuickStyle => ({
  fontSize: settingsStorage.getSubtitleFontSize(),
  textOpacity: settingsStorage.getSubtitleTextOpacity(),
  opacity: settingsStorage.getSubtitleOpacity(),
  paddingBottom: settingsStorage.getSubtitleBottomPadding(),
});

export default function PlayerSubtitleStyleEditor({value, color, onChange}: {
  value: SubtitleQuickStyle;
  color: string;
  onChange: (value: SubtitleQuickStyle) => void;
}) {
  const percent = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <View>
      <Text style={{color: '#999', fontSize: 11}}>
        Changes apply automatically to this video and future playback.
      </Text>
      <View style={{height: 110, marginTop: 12, backgroundColor: '#202020', borderRadius: 16, justifyContent: 'flex-end', alignItems: 'center', overflow: 'hidden', paddingBottom: Math.min(value.paddingBottom + 8, 60)}}>
        <Text style={{fontSize: value.fontSize, color: `rgba(255,255,255,${value.textOpacity})`, backgroundColor: `rgba(0,0,0,${value.opacity})`, paddingHorizontal: 8, paddingVertical: 2}}>
          Subtitle preview
        </Text>
      </View>
      <StyleSlider label="Font size" value={value.fontSize} min={10} max={32} step={1} format={n => `${Math.round(n)} SP`} color={color} onChange={fontSize => onChange({...value, fontSize})} />
      <StyleSlider label="Text opacity" value={value.textOpacity} min={0.2} max={1} step={0.05} format={percent} color={color} onChange={textOpacity => onChange({...value, textOpacity})} />
      <StyleSlider label="Background opacity" value={value.opacity} min={0} max={1} step={0.05} format={percent} color={color} onChange={opacity => onChange({...value, opacity})} />
      <StyleSlider label="Bottom elevation" value={value.paddingBottom} min={0} max={80} step={1} format={n => `${Math.round(n)} dp`} color={color} onChange={paddingBottom => onChange({...value, paddingBottom})} />
    </View>
  );
}
