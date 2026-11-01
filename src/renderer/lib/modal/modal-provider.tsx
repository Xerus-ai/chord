import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { type modalRegistry } from '@renderer/app/modal-registry';
import { useModalStore } from './modal-store';

export interface BaseModalProps<TResult = unknown> {
  onSuccess: (result: TResult) => void;
  onClose: () => void;
}

type UserArgs<MId extends ModalId> = Omit<ModalArgs<MId>, 'onSuccess' | 'onClose'> & {
  onSuccess?: (
    result: ModalArgs<MId> extends { onSuccess: (result: infer R) => void } ? R : unknown
  ) => void;
  onClose?: () => void;
};

export type ModalComponent<TProps = unknown, TResult = unknown> = (
  props: TProps & BaseModalProps<TResult>
) => ReactNode | Promise<ReactNode>;

type ModalId = keyof typeof modalRegistry;

type ModalArgs<TId extends ModalId> = Parameters<(typeof modalRegistry)[TId]['component']>[0];

type ModalContext = {
  closeModal: () => void;
  showModal: <TId extends ModalId>(modal: TId, args: UserArgs<TId>) => void;
  transitionModal: <TId extends ModalId>(modal: TId, args: UserArgs<TId>) => void;
  hasActiveCloseGuard: boolean;
  setCloseGuard: (active: boolean) => void;
};

const ModalContext = createContext<ModalContext | undefined>(undefined);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapArgs<TId extends ModalId>(args: UserArgs<TId>): Record<string, any> {
  return {
    ...args,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSuccess: (result: any) => {
      useModalStore.getState().closeModal('completed');
      args.onSuccess?.(result);
    },
    onClose: () => {
      useModalStore.getState().closeModal('dismissed');
      args.onClose?.();
    },
  };
}

export function ModalProvider({ children }: { children: ReactNode }) {
  const closeGuardActive = useModalStore((s) => s.closeGuardActive);

  const showModal = useCallback(<TId extends ModalId>(id: TId, args: UserArgs<TId>) => {
    useModalStore.getState().setModal(id, wrapArgs(args));
    window.dispatchEvent(new CustomEvent('chord:overlay:changed', { detail: { open: true } }));
  }, []);

  const transitionModal = useCallback(<TId extends ModalId>(id: TId, args: UserArgs<TId>) => {
    useModalStore.getState().setModal(id, wrapArgs(args));
  }, []);

  const closeModal = useCallback(() => {
    useModalStore.getState().closeModal('dismissed');
  }, []);

  const setCloseGuard = useCallback((active: boolean) => {
    useModalStore.getState().setCloseGuard(active);
  }, []);

  return (
    <ModalContext.Provider
      value={{
        closeModal,
        showModal,
        transitionModal,
        hasActiveCloseGuard: closeGuardActive,
        setCloseGuard,
      }}
    >
      {children}
    </ModalContext.Provider>
  );
}

export function useModalContext() {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useWorkspaceOverlayContext must be used within a WorkspaceOverlayProvider');
  }
  return context;
}

export function useShowModal<MId extends ModalId>(id: MId) {
  const { showModal } = useModalContext();
  return (args: UserArgs<MId>) => showModal(id, args);
}

export function useTransitionModal<MId extends ModalId>(id: MId) {
  const { transitionModal } = useModalContext();
  return (args: UserArgs<MId>) => transitionModal(id, args);
}
