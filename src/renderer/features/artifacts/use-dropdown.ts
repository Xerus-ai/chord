import { useEffect, useRef, useState } from 'react';

/**
 * Open/close state for a toolbar dropdown, closed by a click anywhere outside
 * the returned ref. Shared by the artifact toolbar and the selection toolbar so
 * both dismiss identically.
 */
export function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return { open, setOpen, ref };
}
