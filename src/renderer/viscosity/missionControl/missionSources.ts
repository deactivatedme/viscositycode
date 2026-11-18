/**
 * ViscosityCode Mission Control: where the board's data comes from (fork of
 * Poracode). Every input is state the window already holds and that changes
 * on status changes, never on streaming text: thread rows (host-derived
 * status and attention), saved Roundtable sessions (turn status lives there;
 * live turn text has its own store), bots and their API chats (replies land
 * once finished; the streaming text has its own channel).
 *
 * Roundtable sessions and API bot chats are read straight from their stores,
 * read-only: their public APIs expose summaries and single sessions, and the
 * board needs every session's turns and participant threads at once.
 */
import { useAppStore } from "@/renderer/state/appStore";
import { useMinuteClock } from "@/renderer/viscosity/accountPools/minuteClock";
import { useBots } from "@/renderer/viscosity/bots/api";
import { useBotChatsStore } from "@/renderer/viscosity/bots/botApiChat";
import { useRoundtableStore } from "@/renderer/viscosity/roundtable/roundtableStore";
import {
  buildMissionCards,
  countNeedsYou,
  type MissionCard,
  type MissionCountInputs,
  type MissionSession,
  sortMissionCards,
} from "./missionModel";

function useMissionSessions(): MissionSession[] {
  const sessions = useRoundtableStore((state) => state.sessions);
  return Object.values(sessions);
}

/** Every card on the board, attention first. Re-renders on status changes only. */
export function useMissionCards(): MissionCard[] {
  const threads = useAppStore((state) => state.threads);
  const sessions = useMissionSessions();
  const bots = useBots();
  const apiChats = useBotChatsStore((state) => state.chats);
  const runningApiChats = useBotChatsStore((state) => state.running);
  // Finished cards leave after the recent window; a minute is precise enough.
  const now = useMinuteClock();
  return sortMissionCards(
    buildMissionCards({ threads, sessions, bots, apiChats, runningApiChats, now }),
  );
}

type SessionsById = Readonly<Record<string, MissionSession>>;

let needsYouCache:
  | {
      threads: MissionCountInputs["threads"];
      sessions: SessionsById;
      bots: MissionCountInputs["bots"];
      count: number;
    }
  | undefined;

/** `countNeedsYou`, memoized on the identity of its three sources. */
export function getNeedsYouCount(
  threads: MissionCountInputs["threads"],
  sessions: SessionsById,
  bots: MissionCountInputs["bots"],
): number {
  const cached = needsYouCache;
  if (
    cached &&
    cached.threads === threads &&
    cached.sessions === sessions &&
    cached.bots === bots
  ) {
    return cached.count;
  }
  const count = countNeedsYou({ threads, sessions: Object.values(sessions), bots });
  needsYouCache = { threads, sessions, bots, count };
  return count;
}

/**
 * The "Needs you" count (status bar, activity bar badge). No clock involved;
 * the selector returns a number, so callers re-render only when it changes.
 */
export function useNeedsYouCount(): number {
  const sessions = useRoundtableStore((state) => state.sessions);
  const bots = useBots();
  return useAppStore((state) => getNeedsYouCount(state.threads, sessions, bots));
}
