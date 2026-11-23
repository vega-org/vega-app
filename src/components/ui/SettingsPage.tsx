import React from 'react';
import {FlatList, View} from 'react-native';
import {isTV} from '../../lib/tv';
import {SettingsSearchScrollView, useSettingsSearchTarget} from './SettingsSearchTarget';
import SettingsSection from './SettingsSection';
import Surface from './Surface';
import AppText from './Text';
import {scheduleWhenIdle} from '../../lib/performance/idleWork';
import {useFloatingTabBarInset} from '../navigation/FloatingTabBarInsetContext';

// React.Children does not descend into fragments: flatten them explicitly so
// platform/conditional groups do not mount a whole section as one list row.
export const flattenSettingsChildren = (children: React.ReactNode): React.ReactNode[] =>
  React.Children.toArray(children).flatMap(child =>
    React.isValidElement<{children?: React.ReactNode}>(child) && child.type === React.Fragment
      ? flattenSettingsChildren(child.props.children)
      : [child],
  );

// Row and section windowing keeps native controls outside the initial viewport
// out of the cold mount. TV retains a continuous tree for directional focus.
const SettingsPage = ({children, searchFallback}: {
  children: React.ReactNode;
  searchFallback?: Readonly<Record<string, string>>;
}) => {
  const searchTarget = useSettingsSearchTarget();
  const floatingTabBarInset = useFloatingTabBarInset();
  const [ready, setReady] = React.useState(isTV);
  React.useEffect(() => {
    if (isTV || searchTarget) return;
    // Keep native control mounts out of the navigation animation.
    return scheduleWhenIdle(() => setReady(true), 0, true);
  }, [searchTarget]);
  const items = flattenSettingsChildren(children);
  if (isTV || searchTarget) {
    return (
      <SettingsSearchScrollView searchFallback={searchFallback} focusable={false} accessible={false}
        className="h-full w-full bg-m3-background"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingBottom: 40 + floatingTabBarInset, paddingTop: 20}}>
        <View style={{paddingHorizontal: 20}}>{items}</View>
      </SettingsSearchScrollView>
    );
  }
  const rows = items.flatMap<React.ReactNode>(item => {
    if (!React.isValidElement<{title: string; children: React.ReactNode}>(item) || item.type !== SettingsSection) return [item];
    const sectionRows = flattenSettingsChildren(item.props.children);
    return [
      <AppText key={String(item.key) + ':title'} role="labelLarge" className="mb-3 text-m3-on-surface-variant">{item.props.title}</AppText>,
      ...sectionRows.map((child, index) => (
        <Surface key={String(item.key) + ':row:' + index} level="low"
          style={{
            overflow: 'hidden',
            borderTopLeftRadius: index === 0 ? 28 : 0,
            borderTopRightRadius: index === 0 ? 28 : 0,
            borderBottomLeftRadius: index === sectionRows.length - 1 ? 28 : 0,
            borderBottomRightRadius: index === sectionRows.length - 1 ? 28 : 0,
            marginBottom: index === sectionRows.length - 1 ? 24 : 0,
          }}>{child}</Surface>
      )),
    ];
  });
  return (
    <FlatList
      className="flex-1 w-full bg-m3-background"
      data={ready ? rows : rows.slice(0, 4)}
      renderItem={({item}) => <>{item}</>}
      keyExtractor={(item, index) =>
        React.isValidElement(item) && item.key !== null ? String(item.key) : String(index)
      }
      initialNumToRender={4}
      maxToRenderPerBatch={1}
      updateCellsBatchingPeriod={50}
      windowSize={3}
      removeClippedSubviews={false}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 40 + floatingTabBarInset, paddingTop: 20}}
    />
  );
};
export default SettingsPage;
