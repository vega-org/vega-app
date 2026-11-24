import React, {useState} from 'react';
import {ScrollView, View, useWindowDimensions} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {useWafStore} from '../lib/zustand/wafStore';
import {useVerificationConsentStore} from '../lib/zustand/verificationConsentStore';
import {useM3Colors} from '../theme/M3PaletteContext';
import MaterialDialogSurface from './ui/MaterialDialogSurface';
import AppText from './ui/Text';
import {TVFocusable} from './tv';

type Request = ReturnType<typeof useVerificationConsentStore.getState>['requests'][number];

// Keyed by request so a queued site's checkbox never inherits the previous choice.
const ConsentContent = ({request}: {request: Request}) => {
  const [remember, setRemember] = useState(false);
  const colors = useM3Colors();
  const {height} = useWindowDimensions();
  return (
    <MaterialDialogSurface visible onDismiss={() => request.finish(false)}>
      <ScrollView style={{maxHeight: height * 0.5}}>
        <MaterialIcons name="open-in-new" size={26} color={colors.primary} />
        <AppText role="titleLarge" style={{color: colors.onSurface, marginTop: 12}}>
          Open provider website?
        </AppText>
        <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 12}}>
          {request.provider} wants to open a separate window to verify access to its website.
        </AppText>
        <AppText role="bodyMedium" style={{color: colors.onSurface, backgroundColor: colors.surfaceContainerHighest, padding: 12, borderRadius: 12, marginTop: 12}}>
          {new URL(request.url).origin}
        </AppText>
        <AppText role="bodyMedium" style={{color: colors.onSurface, marginVertical: 12}}>
          Only enter personal information in this window if you trust the provider and website.
        </AppText>
        <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
          Remembering applies to all providers. Change it in Settings → Preferences → Provider verification windows.
        </AppText>
      </ScrollView>
      <TVFocusable accessibilityRole="checkbox" accessibilityLabel="Remember my choice" accessibilityState={{checked: remember}}
        registerScreenFocus={false} borderRadius={12} onPress={() => setRemember(value => !value)}
        style={{flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10, marginVertical: 8}}>
        <MaterialIcons name={remember ? 'check-box' : 'check-box-outline-blank'} size={24} color={colors.primary} />
        <AppText role="bodyMedium" style={{color: colors.onSurface}}>Remember my choice</AppText>
      </TVFocusable>
      <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 12}}>
        <TVFocusable hasTVPreferredFocus registerScreenFocus={false} accessibilityRole="button" accessibilityLabel="Cancel"
          borderRadius={20} onPress={() => request.finish(false, remember)}
          style={{paddingHorizontal: 20, paddingVertical: 12, borderRadius: 20, backgroundColor: colors.surfaceContainerHighest}}>
          <AppText role="labelLarge" style={{color: colors.onSurface}}>Cancel</AppText>
        </TVFocusable>
        <TVFocusable registerScreenFocus={false} accessibilityRole="button" accessibilityLabel="Allow"
          borderRadius={20} onPress={() => request.finish(true, remember)}
          style={{paddingHorizontal: 20, paddingVertical: 12, borderRadius: 20, backgroundColor: colors.primary}}>
          <AppText role="labelLarge" style={{color: colors.onPrimary}}>Allow</AppText>
        </TVFocusable>
      </View>
    </MaterialDialogSurface>
  );
};

export default function VerificationConsentDialog() {
  const request = useVerificationConsentStore(state => state.requests[0]);
  const verificationOpen = useWafStore(state => state.requests.length > 0);
  return request && !verificationOpen ? <ConsentContent key={request.id} request={request} /> : null;
}
