/**
 * Live state of the uploads and transcodes the library page is showing, kept
 * outside React.
 *
 * Progress arrives several times a second and belongs to one row of a list
 * that can hold hundreds of episodes, so each slot is subscribed to
 * individually (`useSlotState`): a byte counter repaints its own row and
 * nothing else. This is the React equivalent of the vanilla page's
 * `paintProgress`, which patched the DOM in place for the same reason.
 *
 * A slot key is `movie:<titleId>` or `episode:<episodeId>`.
 */

export interface UploadState {
  loaded: number;
  total: number;
  name: string;
  cancelled: boolean;
  xhr: XMLHttpRequest | null;
  uploadId: string | null;
}

/** What the encoder last reported for a slot, while it is still working. */
export interface TranscodeState {
  /** null draws the indeterminate bar (queued, or no position reported). */
  percent: number | null;
  queued: boolean;
}

type Listener = () => void;

const uploads = new Map<string, UploadState>();
const transcodes = new Map<string, TranscodeState>();
const listeners = new Map<string, Set<Listener>>();
const globalListeners = new Set<Listener>();

function emit(key: string): void {
  for (const l of listeners.get(key) ?? []) l();
  for (const l of globalListeners) l();
}

export function subscribeSlot(key: string, listener: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(key);
  };
}

/** For "is anything uploading at all" (the beforeunload warning, the sheet). */
export function subscribeUploads(listener: Listener): () => void {
  globalListeners.add(listener);
  return () => globalListeners.delete(listener);
}

export function getUpload(key: string): UploadState | undefined {
  return uploads.get(key);
}

export function getTranscode(key: string): TranscodeState | undefined {
  return transcodes.get(key);
}

export function uploadCount(): number {
  return uploads.size;
}

export function startUploadState(key: string, state: UploadState): void {
  uploads.set(key, state);
  transcodes.delete(key);
  emit(key);
}

export function updateUploadState(key: string, loaded: number): void {
  const up = uploads.get(key);
  if (!up) return;
  up.loaded = loaded;
  emit(key);
}

export function endUploadState(key: string): void {
  uploads.delete(key);
  emit(key);
}

export function setTranscodeState(key: string, state: TranscodeState | null): void {
  if (state) transcodes.set(key, state);
  else transcodes.delete(key);
  emit(key);
}
