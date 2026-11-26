import React from 'react';
import {RESTRICTED_DOWNLOAD_LOCATION_MESSAGE} from '../lib/downloadLocation';
import AppDialog from './AppDialog';

interface DownloadLocationDialogProps {
  visible: boolean;
  primary: string;
  selecting: boolean;
  onCancel: () => void;
  onSelectFolder: () => void;
}

const DownloadLocationDialog = ({
  visible,
  selecting,
  onCancel,
  onSelectFolder,
}: DownloadLocationDialogProps) => {
  return (
    <AppDialog
      visible={visible}
      title="Select download location"
      message={`Choose the folder where Vega should save downloaded movies and episodes. ${RESTRICTED_DOWNLOAD_LOCATION_MESSAGE}. Android will open its folder picker after you continue.`}
      primary=""
      actions={[
        {label: 'Cancel'},
        {
          label: selecting ? 'Opening...' : 'Choose folder',
          variant: 'primary',
          disabled: selecting,
          dismissOnPress: false,
          onPress: onSelectFolder,
        },
      ]}
      onDismiss={onCancel}
    />
  );
};

export default DownloadLocationDialog;
