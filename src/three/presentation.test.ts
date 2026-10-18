import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createState, tick, sabotage } from "../simulation.ts";
import { interferenceRoom, presentationEvents, presentationSnapshot } from "./presentation.ts";

test("normal local play reveals the actual spawn and escape films once, not on every frame", () => {
  const state = createState(); state.status = "running";
  const shown: string[] = [];
  for (let step = 0; step < 2000 && state.status === "running"; step++) {
    const before = presentationSnapshot(state);
    tick(state, .1);
    shown.push(...presentationEvents(before, state).map(cue => cue.src));
  }
  assert.equal(state.status, "escaped");
  assert.equal(shown.filter(src => src === "/video/spawn.mp4").length, 1);
  assert.equal(shown.filter(src => src === "/video/escaped.mp4").length, 1);
  assert.ok(shown.indexOf("/video/spawn.mp4") < shown.indexOf("/video/escaped.mp4"));
  assert.deepEqual(presentationEvents(presentationSnapshot(state), state), []);
});

test("a lethal contact keeps its contact film ahead of the containment ending", () => {
  const state = createState(); state.status = "running"; state.killer.spawned = true; state.fear = 95;
  const before = presentationSnapshot(state);
  state.killer.encounterCount++; state.fear = 100; state.status = "contained";
  const cues = presentationEvents(before, state);
  assert.deepEqual(cues.map(cue => cue.src), ["/video/contact.mp4", "/video/contained.mp4"]);
  assert.match(cues[0].notice, /恐怖 \+5/);
  for (const cue of cues) assert.ok(existsSync(new URL(`../../public${cue.src}`, import.meta.url)));
});

test("while Sam is moving, short effects reach his current room and the lock reaches his destination", () => {
  const state = createState(); state.status = "running"; tick(state, .1);
  assert.ok(state.targetRoomId && state.targetRoomId !== state.roomId);
  const room = interferenceRoom(state, true, "exit", "apparition");
  assert.equal(room, state.roomId);
  assert.equal(interferenceRoom(state, true, "exit", "lock"), state.targetRoomId);
  assert.ok(sabotage(state, "apparition", room));
  assert.ok(state.effects.some(effect => effect.type === "apparition" && effect.roomId === state.roomId && effect.expiresAt > state.elapsed));
  for (const type of ["apparition", "whisper", "blackout", "lock"] as const) assert.equal(interferenceRoom(state, false, "exit", type), "exit");
});

test("all original cinematic assets remain available", () => {
  for (const name of ["op", "spawn", "contact", "escaped", "contained"]) assert.ok(existsSync(new URL(`../../public/video/${name}.mp4`, import.meta.url)), name);
});
