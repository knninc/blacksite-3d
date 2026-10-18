import assert from "node:assert/strict";
import test from "node:test";
import { CONNECTIONS, ROOMS, routePosition } from "../simulation.ts";
import { CELL_SIZE, createWorldLayout, isWorldWalkable, toWorld } from "./world.ts";

test("every sampled AI route in both directions has continuous hospital floor and camera clearance", () => {
  const world = createWorldLayout();
  for (const [from, to] of CONNECTIONS.flatMap(([a, b]) => [[a, b], [b, a]] as const)) {
    for (let step = 0; step <= 300; step++) {
      const point = toWorld(routePosition(from, to, step / 300));
      for (const [dx, dz] of [[0, 0], [.28, 0], [-.28, 0], [0, .28], [0, -.28]]) {
        assert.ok(isWorldWalkable(world, point.x + dx, point.z + dz), `${from} -> ${to} at ${step}: ${point.x}, ${point.z}`);
      }
      for (const wall of world.walls) {
        const distance = wall.axis === "x"
          ? Math.hypot(Math.max(0, Math.abs(point.x - wall.x) - wall.length / 2), point.z - wall.z)
          : Math.hypot(point.x - wall.x, Math.max(0, Math.abs(point.z - wall.z) - wall.length / 2));
        assert.ok(distance > .7, `wall intersects AI route ${from} -> ${to} at ${step}`);
      }
    }
  }
});

test("all seven rooms exist in the same bounded, connected occupancy union", () => {
  const world = createWorldLayout();
  for (const room of ROOMS) {
    assert.ok(isWorldWalkable(world, (room.x + room.w / 2) / 25, (room.y + room.h / 2) / 25));
  }
  const visited = new Set<string>(), pending = [world.cells[0]];
  while (pending.length) {
    const cell = pending.pop()!;
    const key = `${cell.column},${cell.row}`;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const column = cell.column + dx, row = cell.row + dz;
      if (world.occupied.has(`${column},${row}`) && !visited.has(`${column},${row}`)) pending.push({ column, row, x: (column + .5) * CELL_SIZE, z: (row + .5) * CELL_SIZE });
    }
  }
  assert.equal(visited.size, world.cells.length);
  assert.ok(world.walls.length < 200, "boundary walls should be merged into long surfaces");
});
