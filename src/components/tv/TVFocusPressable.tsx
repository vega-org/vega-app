import React, {forwardRef} from 'react';
import {Pressable, View} from 'react-native';
import {useTVFocusBorderColor} from '../../lib/tv/useTVFocusBorderColor';

type Props = React.ComponentProps<typeof Pressable> & {
  focusRadius?: number;
  focusWidth?: number;
};

// Keep layout styles static: NativeWind does not preserve the player's layout
// when a focus-dependent style function is passed through its Pressable wrapper.
const TVFocusPressable = forwardRef<View, Props>(function TVFocusPressableView(
  {children, focusRadius = 12, focusWidth = 2.5, ...props},
  ref,
) {
  const color = useTVFocusBorderColor();
  return (
    <Pressable {...props} ref={ref}>
      {state => (
        <>
          {typeof children === 'function' ? children(state) : children}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              borderRadius: focusRadius,
              borderWidth: focusWidth,
              borderColor: state.focused ? color : 'transparent',
            }}
          />
        </>
      )}
    </Pressable>
  );
});

export default TVFocusPressable;
