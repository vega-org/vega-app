import {create} from 'zustand';
import type {
  AppDialogAction,
  AppDialogVariant,
} from '../../components/AppDialog';

export interface GlobalAppDialog {
  title: string;
  message: string;
  progress?: number | null;
  onDismiss?: () => void;
  messageFormat?: 'plain' | 'markdown';
  variant?: AppDialogVariant;
  actions?: AppDialogAction[];
}

interface AppDialogState {
  dialog?: GlobalAppDialog;
  showDialog: (dialog: GlobalAppDialog) => void;
  dismissDialog: () => void;
}

const useAppDialogStore = create<AppDialogState>(set => ({
  dialog: undefined,
  showDialog: dialog => set({dialog}),
  dismissDialog: () => set({dialog: undefined}),
}));

export const showAppDialog = (dialog: GlobalAppDialog) => {
  useAppDialogStore.getState().showDialog(dialog);
};

export default useAppDialogStore;
