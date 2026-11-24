import {create} from 'zustand';
import type {ResolvedPostPreview} from '../providers/postPreview';

export interface ActiveTitlePreview {
  sessionId: number;
  preview: ResolvedPostPreview;
  dismissOnRelease: boolean;
  onOpenDetails?: () => void;
}

export type ShowTitlePreviewPayload = Omit<ActiveTitlePreview, 'sessionId'>;

interface TitlePreviewState {
  activePreview?: ActiveTitlePreview;
  showPreview: (payload: ShowTitlePreviewPayload) => number;
  dismissPreview: (sessionId?: number) => void;
}

let nextSessionId = 1;

const useTitlePreviewStore = create<TitlePreviewState>()((set, get) => ({
  activePreview: undefined,

  showPreview: payload => {
    const sessionId = nextSessionId++;
    set({
      activePreview: {
        ...payload,
        sessionId,
      },
    });
    return sessionId;
  },

  dismissPreview: sessionId => {
    const current = get().activePreview;
    if (!current) {
      return;
    }
    if (sessionId !== undefined && current.sessionId !== sessionId) {
      return;
    }
    set({activePreview: undefined});
  },
}));

export default useTitlePreviewStore;
