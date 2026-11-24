import type {SettingsStackParamList} from '../../App';

type SearchEntry = {
  label: string;
  page: string;
  route: Exclude<keyof SettingsStackParamList, 'DisableProviders'>;
  target?: string;
  keywords?: string;
  standalone?: boolean;
  phoneOnly?: boolean;
};

const entries: SearchEntry[] = [
  {label: 'DNS', page: 'Network', route: 'Settings', keywords: 'dns over https doh network'},
  {label: 'Provider Manager', page: 'Provider tools', route: 'Extensions', keywords: 'extensions install sources repositories'},
  {label: 'Downloads', page: 'Downloads', route: 'DownloadsStack', keywords: 'offline saved videos'},
  ...['Appearance', 'Accent color', 'Dynamic info accent', 'Launcher icon'].map(
    (label): SearchEntry => ({label, page: 'Appearance', route: 'Appearance', keywords: 'theme wallpaper color icon'}),
  ),
  {label: 'Bottom bar style', page: 'Preferences', route: 'Preferences', keywords: 'ios glass material navigation style', phoneOnly: true},
  {label: 'Hide glass bar on subpages', page: 'Preferences', route: 'Preferences', keywords: 'glass bottom bar navigation hide subpages detail pages', phoneOnly: true},
  ...['Preferences', 'Auto update providers', 'Provider verification windows', 'Haptic feedback',
    'Tab bar labels', 'Hide downloads tab', 'Hamburger menu', 'Continue watching',
    'Disable drawer', 'External downloader', 'Skip in-app webview', 'Excluded qualities',
    'TMDB API key', 'Download location', 'Reset download location', 'Connections per download',
    'Automatically try next server'].map(
    (label): SearchEntry => ({label, page: 'Preferences', route: 'Preferences', target: label === 'TMDB API key' ? 'Custom TMDB API key' : undefined}),
  ),
  ...['Player settings', 'Open videos from other apps', 'Playback speed', 'Ambient lighting',
    'Ambient intensity', 'Ambient spread', 'Ambient responsiveness', 'External player',
    'Notification media controls', 'Hide seek buttons', 'Seek interval', 'Auto play next episode',
    'Show remaining time', 'Swipe gestures', 'Volume boost', 'Download full torrent',
    'Forward buffer', 'Back buffer', 'Faster playback on slow servers'].map(
    (label): SearchEntry => ({label, page: 'Player settings', route: 'PlayerSettings'}),
  ),
  {label: 'Auto-rotate', page: 'Player settings', route: 'PlayerSettings', keywords: 'auto rotate orientation portrait landscape', phoneOnly: true},
  ...['Ask for local file first', 'Always cast mode'].map(
    (label): SearchEntry => ({label, page: 'Player settings', route: 'PlayerSettings', phoneOnly: true}),
  ),
  {label: 'Control layout', page: 'Player settings', route: 'PlayerControlSettings', keywords: 'rearrange buttons player controls'},
  ...['Subtitle style', 'Font size', 'Font style', 'Text color', 'Edge & shadow effect',
    'Outline & shadow color', 'Outline & shadow size', 'Text opacity', 'Background opacity',
    'Bottom elevation', 'Reset to defaults'].map(
    (label): SearchEntry => ({label, page: 'Subtitle style', route: 'SubTitlesPreferences', keywords: 'captions'}),
  ),
  ...['Data management', 'Sync', 'Clear watch progress', 'Clear cache', 'Clear WebView data',
    'Export backup', 'Import backup', 'Erase all local data'].map(
    (label): SearchEntry => ({label, page: 'Data management', route: 'DataManagement'}),
  ),
  {label: 'About & updates', page: 'Vega', route: 'About', keywords: 'app information version'},
  ...['Version', 'Download updates in Vega', 'Check on startup', 'Update channel', 'Check for updates',
    'Detailed logging', 'Export logs', 'Clear logs'].map(
    (label): SearchEntry => ({
      label,
      page: 'About & updates',
      route: 'About',
      standalone: ['Download updates in Vega', 'Check on startup', 'Update channel', 'Check for updates'].includes(label),
      phoneOnly: ['Detailed logging', 'Export logs', 'Clear logs'].includes(label),
      keywords: label === 'Update channel' ? 'stable beta prerelease nightly' : undefined,
    }),
  ),
];

export function searchSettings(query: string, platform: {isTV: boolean; isPlayStore: boolean}) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  return entries
    .filter(entry => !(entry.phoneOnly && platform.isTV) && !(entry.standalone && platform.isPlayStore))
    .map(entry => {
      if (!platform.isPlayStore || entry.route !== 'About') return entry;
      return {
        ...entry,
        label: entry.label === 'About & updates' ? 'About Vega' : entry.label,
        page: entry.page === 'About & updates' ? 'About Vega' : entry.page,
      };
    })
    .filter(entry => {

      const searchable = `${entry.label} ${entry.keywords ?? ''}`.toLowerCase();
      return terms.every(term => searchable.includes(term));
    });
}
