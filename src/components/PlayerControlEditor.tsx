import React, {memo, useEffect, useRef, useState} from 'react';
import {Modal, ScrollView, Text, View, findNodeHandle, useWindowDimensions} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {settingsStorage} from '../lib/storage';
import {TVFocusable, TVFocusGuide} from './tv';
import PlayerControlArrangement from './PlayerControlArrangement';
import PlayerControlStyleEditor from './PlayerControlStyleEditor';
import PlayerSubtitleStyleEditor, {readSubtitleQuickStyle, SubtitleQuickStyle} from './PlayerSubtitleStyleEditor';
import {defaultPlayerControlStyle, PlayerControlStyle} from '../lib/player/controlStyle';
import {DEFAULT_HIDDEN_PLAYER_CONTROLS, defaultPlayerControlLayout, getTopControlLimit, PlayerControlId, PlayerControlLayout} from '../lib/player/controlLayout';
import type {PlayerControl} from './PlayerControlBar';

type Ambient = {enabled: boolean; intensity: number; spread: number; responseMs: number};
type Props = {
  layout: PlayerControlLayout;
  controls: PlayerControl[];
  color: string;
  hiddenControls?: PlayerControlId[];
  appearance?: PlayerControlStyle;
  onClose: () => void;
  onHaptic?: () => void;
  onSave: (layout: PlayerControlLayout, hidden: PlayerControlId[], style: PlayerControlStyle,
    ambient?: Ambient, subtitle?: SubtitleQuickStyle) => void;
};
function PlayerControlEditor({layout, controls, color, hiddenControls, appearance,
  onClose, onSave, onHaptic}: Props) {
  const {width, height} = useWindowDimensions();
  const arrangeTabRef = useRef<View>(null);
  const [arrangeTabHandle, setArrangeTabHandle] = useState<number>();
  const [entryHandle, setEntryHandle] = useState<number>();
  const [tab, setTab] = useState<'arrange' | 'style' | 'subtitles'>('arrange');
  const [draft, setDraft] = useState(layout);
  const [hidden, setHidden] = useState(() => hiddenControls ?? [...DEFAULT_HIDDEN_PLAYER_CONTROLS]);
  const [style, setStyle] = useState(appearance || defaultPlayerControlStyle());
  const [subtitle, setSubtitle] = useState(readSubtitleQuickStyle);
  const [ambient, setAmbient] = useState<Ambient>(() => ({
    enabled: settingsStorage.isAmbientVideoEnabled(), intensity: settingsStorage.getAmbientIntensity(),
    spread: settingsStorage.getAmbientSpread(), responseMs: settingsStorage.getAmbientResponseMs(),
  }));
  const snapshot = JSON.stringify([draft, hidden, style, ambient, subtitle]);
  const saved = useRef(snapshot);
  const save = useRef(onSave);
  save.current = onSave;
  useEffect(() => {
    if (saved.current === snapshot) return;
    saved.current = snapshot;
    save.current(draft, hidden, style, ambient, subtitle);
  }, [snapshot, draft, hidden, style, ambient, subtitle]);
  return (
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent
      onRequestClose={onClose} animationType="fade">
      <GestureHandlerRootView style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.62)',
        alignItems: 'center', justifyContent: 'center', paddingVertical: 8}}>
        <TVFocusGuide trapFocusLeft trapFocusRight trapFocusUp trapFocusDown
          style={{width: '92%', maxWidth: 600, maxHeight: height - 24, padding: 14,
            borderRadius: 22, backgroundColor: '#151515', borderWidth: 1, borderColor: '#333'}}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10}}>
            <Text style={{flex: 1, color: '#eee', fontSize: 16}}>Player controls</Text>
            <TVFocusable accessibilityLabel="Reset" onPress={() => {
              if (tab === 'arrange') {setDraft(defaultPlayerControlLayout()); setHidden([...DEFAULT_HIDDEN_PLAYER_CONTROLS]);}
              else if (tab === 'style') {
                setStyle(defaultPlayerControlStyle());
                setAmbient({enabled: false, intensity: 0.35, spread: 1, responseMs: 220});
              } else setSubtitle({fontSize: 16, textOpacity: 1, opacity: 1, paddingBottom: 10});
            }} style={{padding: 8}}><Text style={{color: '#bbb'}}>Reset</Text></TVFocusable>
            <TVFocusable hasTVPreferredFocus accessibilityLabel="Close" onPress={onClose}
              style={{padding: 8}}><Text style={{color}}>Close</Text></TVFocusable>
          </View>
          <View style={{flexDirection: 'row', gap: 8, marginBottom: 10}}>
            {(['arrange', 'style', 'subtitles'] as const).map(item => (
              <TVFocusable key={item} ref={item === 'arrange' ? arrangeTabRef : undefined}
                onLayout={item === 'arrange' ? () => { const handle = findNodeHandle(arrangeTabRef.current); if (handle) setArrangeTabHandle(handle); } : undefined}
                nextFocusDown={tab === 'arrange' ? entryHandle : undefined}
                registerScreenFocus={false} accessibilityRole="tab"
                accessibilityLabel={item === 'arrange' ? 'Arrange' : item === 'style' ? 'Style' : 'Subtitles'}
                accessibilityState={{selected: tab === item}} onPress={() => setTab(item)}
                style={{paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16,
                  backgroundColor: tab === item ? '#353535' : '#202020'}}>
                <Text style={{color: tab === item ? 'white' : '#999'}}>
                  {item === 'arrange' ? 'Arrange' : item === 'style' ? 'Style' : 'Subtitles'}
                </Text>
              </TVFocusable>
            ))}
          </View>
          {tab === 'arrange' ? (
            <PlayerControlArrangement exitUpHandle={arrangeTabHandle} onEntryHandle={setEntryHandle} layout={draft} hiddenControls={hidden} controls={controls}
              color={color} limit={getTopControlLimit(width / style.scale)} onHaptic={onHaptic}
              onChange={(next, nextHidden) => {setDraft(next); setHidden(nextHidden);}} />
          ) : (
            <ScrollView style={{flexShrink: 1}} showsVerticalScrollIndicator={false}>
              {tab === 'style' ? <PlayerControlStyleEditor value={style} color={color}
                ambient={ambient} onAmbientChange={setAmbient} onChange={setStyle} />
                : <PlayerSubtitleStyleEditor value={subtitle} color={color} onChange={setSubtitle} />}
            </ScrollView>
          )}
        </TVFocusGuide>
      </GestureHandlerRootView>
    </Modal>
  );
}
export default memo(PlayerControlEditor);
