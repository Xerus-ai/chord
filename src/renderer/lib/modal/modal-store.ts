import { create } from 'zustand';

interface ModalState {
  activeModalId: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activeModalArgs: Record<string, any> | null;
  /**
   * Monotonic per-showModal instance id — the renderer keys the mounted
   * component on it so a modal reopened for a DIFFERENT entity remounts with
   * fresh state instead of reusing the previous instance's (modals stay
   * mounted through the close animation, so without this a reopen within
   * that window leaked the old entity's form state).
   */
  modalInstanceId: number;
  closeGuardActive: boolean;
  isOpen: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setModal: (id: string, args: Record<string, any>) => void;
  closeModal: (outcome?: 'completed' | 'dismissed') => void;
  setCloseGuard: (active: boolean) => void;
}

export const useModalStore = create<ModalState>()((set) => ({
  activeModalId: null,
  activeModalArgs: null,
  modalInstanceId: 0,
  closeGuardActive: false,
  isOpen: false,
  setModal: (id, args) =>
    set((state) => ({
      activeModalId: id,
      activeModalArgs: args,
      modalInstanceId: state.modalInstanceId + 1,
      isOpen: true,
    })),
  closeModal: () => {
    set({ closeGuardActive: false, activeModalId: null, activeModalArgs: null, isOpen: false });
    window.dispatchEvent(new CustomEvent('chord:overlay:changed', { detail: { open: false } }));
  },
  setCloseGuard: (active) => set({ closeGuardActive: active }),
}));
