import { useRef, type JSX, type ReactNode } from "react";

/**
 * One of the page's `.modal-backdrop` dialogs, closed by a click on the
 * backdrop itself.
 *
 * Always mounted and toggled through `.open`, as the vanilla page does: the
 * stylesheet fades the backdrop and scales the dialog in on that class, so a
 * dialog mounted already open skips the fade-in and one unmounted on close
 * skips the fade-out. The content a caller renders while open is kept through
 * the fade-out — callers render nothing once their draft state is cleared.
 */
export function Modal({
  id,
  open,
  onClose,
  children,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  const last = useRef<ReactNode>(null);
  if (open) last.current = children;
  return (
    <div
      id={id}
      className={`modal-backdrop${open ? " open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">{open ? children : last.current}</div>
    </div>
  );
}
