import React from 'react';
import useAppDialogStore from '../lib/zustand/appDialogStore';
import AppDialog from './AppDialog';
import {useM3Colors} from '../theme/M3PaletteContext';

const AppDialogHost = () => {
  const dialog = useAppDialogStore(state => state.dialog);
  const dismissDialog = useAppDialogStore(state => state.dismissDialog);
  const colors = useM3Colors();

  if (!dialog) {
    return null;
  }

  return (
    <AppDialog
      visible
      title={dialog.title}
      message={dialog.message}
      messageFormat={dialog.messageFormat}
      primary={colors.primary}
      variant={dialog.variant}
      actions={dialog.actions}
      progress={dialog.progress}
      onDismiss={() => {
        dismissDialog();
        dialog.onDismiss?.();
      }}
    />
  );
};

export default AppDialogHost;
