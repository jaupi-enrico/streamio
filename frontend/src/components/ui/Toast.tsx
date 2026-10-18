import { useCallback, useEffect, useRef, useState, type JSX } from "react";

/**
 * The pages' `.toast` element (styled per page): `show(msg)` adds the `show`
 * class for `ms`, restarting the timer on every call.
 */
export function useToast(ms = 2500): { toast: JSX.Element; show: (msg: string) => void } {
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = useCallback(
    (msg: string) => {
      setMessage(msg);
      setVisible(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setVisible(false), ms);
    },
    [ms],
  );

  const toast = (
    <div className={`toast${visible ? " show" : ""}`} id="toast">
      {message}
    </div>
  );
  return { toast, show };
}

/**
 * The home/account/admin toast: `#toast` with a `success`/`error` class and a
 * coloured dot, as those pages' stylesheets expect.
 */
export function useStatusToast(ms = 3000): { toast: JSX.Element; show: (msg: string, type?: "success" | "error") => void } {
  const [state, setState] = useState<{ msg: string; type: "success" | "error"; visible: boolean }>({
    msg: "",
    type: "success",
    visible: false,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = useCallback(
    (msg: string, type: "success" | "error" = "success") => {
      setState({ msg, type, visible: true });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState((s) => ({ ...s, visible: false })), ms);
    },
    [ms],
  );

  const toast = (
    <div id="toast" className={state.visible ? `show ${state.type}` : ""}>
      <span className="toast-dot" style={{ background: state.type === "success" ? "#46d369" : "#e50914" }} />
      <span id="toastMsg">{state.msg}</span>
    </div>
  );
  return { toast, show };
}
