import { MAP_ROUTES, ROOMS, type RoomId, type WorldPoint } from "../simulation.ts";

/** The renderer and every actor use this one map-to-metres transform. */
export const MAP_SCALE = 25;
export const GRID_STEP = 10;
export const CELL_SIZE = GRID_STEP / MAP_SCALE;
export const CORRIDOR_HALF_WIDTH = 27.5;
export const WALL_HEIGHT = 3.3;
export interface FloorCell { x: number; z: number; column: number; row: number }
export interface WallEdge { x: number; z: number; length: number; axis: "x" | "z" }
export interface WorldLayout { cells: FloorCell[]; walls: WallEdge[]; occupied: Set<string> }

export function toWorld(point: WorldPoint): { x: number; z: number } {
  return { x: point.x / MAP_SCALE, z: point.y / MAP_SCALE };
}

export function roomCenter(id: RoomId): WorldPoint {
  const room = ROOMS.find((item) => item.id === id)!;
  return { x: room.x + room.w / 2, y: room.y + room.h / 2 };
}

/** Match simulation.pathPoints, including the exact (fractional) room centres. */
export function navigationRoutes(): WorldPoint[][] {
  return MAP_ROUTES.map((route) => route.points.map((point, index) => {
    if (index === 0) return roomCenter(route.from);
    if (index === route.points.length - 1) return roomCenter(route.to);
    return { x: point[0], y: point[1] };
  }));
}

export function distanceToSegment(point: WorldPoint, a: WorldPoint, b: WorldPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const fraction = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - a.x - dx * fraction, point.y - a.y - dy * fraction);
}

/** Props stay clear of all actual AI paths, including paths crossing another room. */
export function distanceToNavigation(point: WorldPoint): number {
  return Math.min(...navigationRoutes().flatMap((points) => points.slice(1).map((b, index) => distanceToSegment(point, points[index], b))));
}

export function createWorldLayout(): WorldLayout {
  const routes = navigationRoutes();
  const cells: FloorCell[] = [], occupied = new Set<string>();
  // Slightly conservative rasterisation expands navigable space. It cannot put a
  // wall on an actor route, and creates one continuous union at room entrances.
  for (let column = 8; column < 94; column++) {
    for (let row = 9; row < 67; row++) {
      const point = { x: (column + .5) * GRID_STEP, y: (row + .5) * GRID_STEP };
      const inRoom = ROOMS.some((room) => point.x >= room.x && point.x <= room.x + room.w && point.y >= room.y && point.y <= room.y + room.h);
      const inRoute = routes.some((points) => points.slice(1).some((b, index) => distanceToSegment(point, points[index], b) <= CORRIDOR_HALF_WIDTH));
      if (inRoom || inRoute) {
        occupied.add(`${column},${row}`);
        cells.push({ x: point.x / MAP_SCALE, z: point.y / MAP_SCALE, column, row });
      }
    }
  }
  // Merge exposed unit edges into long walls, keeping both draw calls and seams low.
  const edges = new Map<string, number[]>();
  const add = (axis: "x" | "z", fixed: number, varying: number) => {
    const key = `${axis}:${fixed}`;
    const values = edges.get(key) ?? [];
    values.push(varying); edges.set(key, values);
  };
  for (const { column: x, row: z } of cells) {
    if (!occupied.has(`${x},${z - 1}`)) add("x", z, x);
    if (!occupied.has(`${x},${z + 1}`)) add("x", z + 1, x);
    if (!occupied.has(`${x - 1},${z}`)) add("z", x, z);
    if (!occupied.has(`${x + 1},${z}`)) add("z", x + 1, z);
  }
  const walls: WallEdge[] = [];
  for (const [key, values] of edges) {
    const [axis, fixedString] = key.split(":"), fixed = Number(fixedString);
    values.sort((a, b) => a - b);
    let start = values[0], end = start + 1;
    const flush = () => walls.push({ axis: axis as "x" | "z", x: (axis === "x" ? (start + end) / 2 : fixed) * CELL_SIZE,
      z: (axis === "z" ? (start + end) / 2 : fixed) * CELL_SIZE, length: (end - start) * CELL_SIZE });
    for (let index = 1; index < values.length; index++) {
      if (values[index] === end) end++;
      else { flush(); start = values[index]; end = start + 1; }
    }
    flush();
  }
  return { cells, walls, occupied };
}

export function isWorldWalkable(layout: WorldLayout, x: number, z: number): boolean {
  return layout.occupied.has(`${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`);
}
