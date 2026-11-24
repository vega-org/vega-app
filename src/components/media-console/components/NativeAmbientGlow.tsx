import {requireNativeComponent, ViewProps} from 'react-native';
import {AmbientBars, AmbientColors} from '../../../lib/player/ambient';

export default requireNativeComponent<ViewProps & {
  palette: AmbientColors;
  bars: AmbientBars;
  intensity: number;
  spread: number;
  responseMs: number;
}>('VegaAmbientGlow');
