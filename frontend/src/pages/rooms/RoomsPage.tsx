/**
 * Watch parties: join by code, list mine — a port of public/rooms.html +
 * scripts/rooms.js. Rooms are opened on the watch page.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type JSX, type KeyboardEvent } from "react";
import { IconCrown } from "../../components/icons/icons";
import { TopNav } from "../../components/layout/TopNav";
import { useLoadPreferences } from "../../hooks/usePreferences";
import { usePageScope } from "../../hooks/usePageScope";
import { useQuietSession } from "../../hooks/useQuietSession";
import { api, getAccessToken, getSelfId } from "../../lib/auth";
import { apiUrl } from "../../lib/base";
import { pageHref } from "../../lib/pages";
import "./rooms.css";

interface RoomState {
  provider: string;
  showId: string;
  episodeLabel: string | null;
  contentType: "episode" | "movie";
}

export interface Room {
  code: string;
  ownerId: string;
  state: RoomState;
  members: { id: string }[];
}

/**
 * The room's watch page. The watch page isn't ported yet, so this is the
 * vanilla one — which is also where anyone already in the room is.
 */
export function watchUrl(room: Pick<Room, "code" | "state">): string {
  const params = new URLSearchParams({ id: room.state.showId, room: room.code });
  if (room.state.provider) params.set("provider", room.state.provider);
  return pageHref(`/watch?${params.toString()}`);
}

/**
 * Display title for a room. Deliberately an anonymous fetch, as in the
 * vanilla page: a title the server won't describe (gated, gone) falls back to
 * its id.
 */
async function titleFor(room: Room): Promise<string> {
  try {
    const res = await fetch(
      apiUrl(
        `/api/shows/${encodeURIComponent(room.state.showId)}?provider=${encodeURIComponent(room.state.provider)}`,
      ),
    );
    const data = (await res.json()) as { data?: { title?: string } };
    return data?.data?.title || room.state.showId;
  } catch {
    return room.state.showId;
  }
}

interface MyRooms {
  rooms: Room[];
  titles: string[];
  selfId: string | null;
}

async function loadMyRooms(): Promise<MyRooms> {
  const rooms = await api<Room[]>("/api/rooms/mine");
  if (!rooms.length) return { rooms, titles: [], selfId: null };
  const [titles, selfId] = await Promise.all([Promise.all(rooms.map(titleFor)), getSelfId()]);
  return { rooms, titles, selfId };
}

function MyRoomsList(): JSX.Element {
  const sessionReady = useQuietSession();
  const signedIn = sessionReady && Boolean(getAccessToken());
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["rooms", "mine"], queryFn: loadMyRooms, enabled: signedIn });

  async function closeRoom(code: string) {
    if (!window.confirm("Close this watch party for everyone?")) return;
    try {
      await api(`/api/rooms/${encodeURIComponent(code)}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["rooms", "mine"] });
    } catch (err) {
      alert(`Could not close watch party: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!sessionReady) return <div className="empty">Loading…</div>;
  if (!signedIn) return <div className="empty">Log in to see your watch parties.</div>;
  if (query.isPending) return <div className="empty">Loading…</div>;
  if (query.isError) return <div className="empty">Could not load watch parties: {query.error.message}</div>;

  const { rooms, titles, selfId } = query.data;
  if (!rooms.length) return <div className="empty">No active watch parties yet.</div>;

  return (
    <>
      {rooms.map((room, i) => {
        const watching = `${room.members.length} watching`;
        const sub =
          room.state.contentType === "episode" && room.state.episodeLabel
            ? `${room.state.episodeLabel} · ${watching}`
            : watching;
        const isOwner = Boolean(selfId) && room.ownerId === selfId;
        return (
          <div className="room-item" key={room.code}>
            <a className="room-item-link" href={watchUrl(room)}>
              <span className="room-item-code">{room.code}</span>
              <span className="room-item-info">
                <div className="room-item-title">
                  {titles[i]}
                  {isOwner && (
                    <>
                      {" "}
                      <span className="room-item-crown" title="Host">
                        <IconCrown />
                      </span>
                    </>
                  )}
                </div>
                <div className="room-item-sub">{sub}</div>
              </span>
            </a>
            {isOwner && (
              <button className="room-item-close" title="Close watch party" onClick={() => void closeRoom(room.code)}>
                ✕
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

export default function RoomsPage(): JSX.Element {
  usePageScope("rooms", "Watch Parties - Streamio");
  useLoadPreferences();

  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);

  async function join() {
    const wanted = code.trim().toUpperCase();
    setError("");
    if (!wanted) return;
    if (!getAccessToken()) {
      setError("Log in first to join a watch party.");
      return;
    }
    setJoining(true);
    try {
      const room = await api<Room>(`/api/rooms/${encodeURIComponent(wanted)}/join`, { method: "POST" });
      window.location.href = watchUrl(room);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message === "Room not found." ? "No watch party with that code." : message);
    } finally {
      setJoining(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") void join();
  }

  return (
    <>
      <TopNav active="rooms" activeStyle="red" badge={false} />

      <div className="page-body">
        <div className="page-head">
          <div className="page-title">Watch Parties</div>
          <div className="page-sub">
            Join a friend's room with their code, or open a title and hit "Watch Party" to start one.
          </div>
        </div>

        <div className="card">
          <div className="card-title">Join with a code</div>
          <div className="join-row">
            <input
              className="field-input"
              id="codeInput"
              type="text"
              maxLength={6}
              placeholder="ABC123"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={onKeyDown}
            />
            <button className="btn btn-primary" id="joinBtn" disabled={joining} onClick={() => void join()}>
              Join
            </button>
          </div>
          <div className="error-text" id="joinError">
            {error}
          </div>
        </div>

        <div className="card">
          <div className="card-title">My Watch Parties</div>
          <div id="myRoomsList" className="room-list">
            <MyRoomsList />
          </div>
        </div>
      </div>
    </>
  );
}
