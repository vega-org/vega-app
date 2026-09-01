import {Platform} from 'react-native';

const isIOS = Platform.OS === 'ios';

export const headers = {
  'sec-ch-ua': isIOS
    ? ''
    : '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': isIOS ? '"iOS"' : '"Android"',
  'User-Agent': isIOS
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    : 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};
