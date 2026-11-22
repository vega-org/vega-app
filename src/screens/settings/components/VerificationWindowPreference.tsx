import React, {useCallback, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {settingsStorage, type VerificationWindowPolicy} from '../../../lib/storage/SettingsStorage';
import SettingsChoiceDialog from '../../../components/ui/SettingsChoiceDialog';
import SettingsRow from '../../../components/ui/SettingsRow';

const choices: {value: VerificationWindowPolicy; label: string; description: string}[] = [
  {value: 'ask', label: 'Ask each time', description: 'Ask before a provider opens its website. Recommended.'},
  {value: 'allow', label: 'Always allow', description: 'Allow websites to open without asking.'},
  {value: 'block', label: 'Block', description: 'Prevent provider websites from opening. Some providers may not work.'},
];

export default function VerificationWindowPreference() {
  const [policy, setPolicy] = useState(() => settingsStorage.getVerificationWindowPolicy());
  const [open, setOpen] = useState(false);
  useFocusEffect(useCallback(() => {setPolicy(settingsStorage.getVerificationWindowPolicy());}, []));
  return <>
    <SettingsRow title="Provider verification windows" icon="open-in-new" divider={false}
      description={`${choices.find(choice => choice.value === policy)?.label}. Controls website windows for all providers.`}
      onPress={() => {setPolicy(settingsStorage.getVerificationWindowPolicy()); setOpen(true);}} />
    {open && (
      <SettingsChoiceDialog
        title="Provider verification windows"
        choices={choices}
        selected={policy}
        onDismiss={() => setOpen(false)}
        onSelect={value => {
          settingsStorage.setVerificationWindowPolicy(value);
          setPolicy(value);
          setOpen(false);
        }}
      />
    )}
  </>;
}
