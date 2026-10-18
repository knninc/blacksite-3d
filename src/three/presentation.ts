import type { GameState, RoomId, SabotageType } from "../simulation.ts";

export type MovieCue = { src: string; label: string; notice: string };
export function presentationSnapshot(state: GameState) {
  return { status: state.status, spawned: state.killer.spawned, encounters: state.killer.encounterCount, fear: state.fear };
}

/** Edge-triggered: a terminal contact must play before the ending, exactly once. */
export function presentationEvents(before: ReturnType<typeof presentationSnapshot>, state: GameState): MovieCue[] {
  const movies: MovieCue[] = [];
  if (!before.spawned && state.killer.spawned) movies.push({ src: "/video/spawn.mp4", label: "ぬこぬこさんの出現", notice: "キーカード取得。何かが、こちらに気づいた。 / 時間停止中" });
  if (state.killer.encounterCount > before.encounters) movies.push({ src: "/video/contact.mp4", label: "ぬこぬこさんとの接触", notice: `接触！ 恐怖 +${Math.round(Math.max(0, state.fear - before.fear))} / 現在 ${Math.round(state.fear)}。 / 時間停止中` });
  if (before.status === "running" && (state.status === "escaped" || state.status === "contained")) movies.push(state.status === "escaped"
    ? { src: "/video/escaped.mp4", label: "脱出エンディング", notice: "SUBJECT ESCAPED / サムは、生還した。" }
    : { src: "/video/contained.mp4", label: "封じ込めエンディング", notice: "CONTAINMENT SUCCESS / 病院が、勝った。" });
  return movies;
}

/** Short-lived sensory effects must reach Sam now; a door acts on his route. */
export function interferenceRoom(state: GameState, following: boolean, selected: RoomId, type?: SabotageType): RoomId {
  if (!following) return selected;
  return type === "lock" ? state.targetRoomId ?? state.roomId : state.roomId;
}
