import React from 'react';
import {View} from 'react-native';
import AppText from '../../../components/ui/Text';
import {TVFocusable} from '../../../components/tv';
import {isTV} from '../../../lib/tv';
import {useM3Colors} from '../../../theme/M3PaletteContext';

export default function SynopsisText({synopsis, expanded, onToggle}: {
  synopsis: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const colors = useM3Colors();
  const expandable = synopsis.length > 240;
  const text = expandable && !expanded
    ? `${synopsis.slice(0, 240).trimEnd()}...`
    : synopsis;
  const content = (
    <AppText role="bodyLarge" style={{color: colors.onSurfaceVariant, lineHeight: 24}}>
      {text}
      {expandable && (
        <AppText
          role="bodyLarge"
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Show less synopsis' : 'Read more synopsis'}
          accessibilityState={{expanded}}
          onPress={isTV ? undefined : onToggle}
          style={{color: colors.primary, fontWeight: '700', lineHeight: 24}}>
          {expanded ? ' Show less' : ' Read more'}
        </AppText>
      )}
    </AppText>
  );

  // Native text lays out the link with the final line, including wrapping and
  // font scaling. Never hide it while waiting for measurement callbacks.
  return isTV && expandable ? (
    <TVFocusable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={expanded ? 'Show less synopsis' : 'Read more synopsis'}
      accessibilityState={{expanded}}
      style={{marginTop: 10}}>
      {content}
    </TVFocusable>
  ) : <View style={{marginTop: 10}}>{content}</View>;
}
