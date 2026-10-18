import * as THREE from "three";
import { actorPosition, isHiding, ROOMS, routePosition, type GameState, type RoomId } from "../simulation.ts";
import { CELL_SIZE, MAP_SCALE, WALL_HEIGHT, createWorldLayout, distanceToNavigation, navigationRoutes, roomCenter, toWorld } from "./world.ts";

export interface Hospital3D {
  update(state: GameState, dt: number, look?: { yaw: number; pitch: number }, selected?: RoomId): void;
  recenter(): void;
  dispose(): void;
}

/** A read-only view of the simulation. The caller owns its clock and all rules. */
export function createHospital3D(container: HTMLElement): Hospital3D {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101d1e);
  scene.fog = new THREE.FogExp2(0x18292a, .035);
  const camera = new THREE.PerspectiveCamera(71, 1, .07, 65);
  camera.rotation.order = "YXZ";
  scene.add(camera);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.dataset.testid = "hospital-3d-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Sam の視点で見る廃病院の3D映像。ドラッグまたは矢印キーで周囲を見回せます。");
  canvas.tabIndex = 0;
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none;cursor:grab";
  container.appendChild(canvas);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  const geometry = <T extends THREE.BufferGeometry>(value: T): T => { geometries.add(value); return value; };
  const material = <T extends THREE.Material>(value: T): T => { materials.add(value); return value; };
  const cube = geometry(new THREE.BoxGeometry(1, 1, 1));
  function surface(color: number, roughness = .85, metalness = 0) {
    return material(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  }
  function box(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) {
    const mesh = new THREE.Mesh(cube, mat);
    mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  const plaster = surface(0xb0b7ac), trim = surface(0x3e7770), rust = surface(0x605a43), metal = surface(0x64746e, .58, .6);
  const dark = surface(0x18272a), bedFrame = surface(0x778781, .48, .6), mattress = surface(0xa6b5a8), fabric = surface(0x516d68);
  const whiteGlow = material(new THREE.MeshStandardMaterial({ color: 0xc9e8d5, emissive: 0x94d4b4, emissiveIntensity: 1.4 }));
  const amberGlow = material(new THREE.MeshBasicMaterial({ color: 0xf4bb63 }));

  function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
    const sheet = document.createElement("canvas"); sheet.width = width; sheet.height = height;
    const ctx = sheet.getContext("2d"); if (ctx) draw(ctx);
    const texture = new THREE.CanvasTexture(sheet); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture); return texture;
  }
  const wallTexture = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = "#bbc2b7"; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2000; i++) {
      const x = (i * 73) % 256, y = (i * 131) % 256;
      ctx.fillStyle = `rgba(30,50,45,${.015 + (i % 7) * .005})`; ctx.fillRect(x, y, 1 + i % 3, 2 + i % 5);
    }
    const stain = ctx.createLinearGradient(0, 130, 0, 256); stain.addColorStop(0, "transparent"); stain.addColorStop(1, "rgba(30,50,45,.18)");
    ctx.fillStyle = stain; ctx.fillRect(0, 0, 256, 256);
  });
  wallTexture.wrapS = wallTexture.wrapT = THREE.RepeatWrapping;
  plaster.map = wallTexture;

  const layout = createWorldLayout();
  const floorMaterials = [surface(0x687b71, .43, .08), surface(0x5e7269, .46, .08)];
  const tileSets = layout.cells.reduce<[typeof layout.cells, typeof layout.cells]>((sets, cell) => {
    sets[(cell.column + cell.row) % 2].push(cell); return sets;
  }, [[], []]);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  for (let index = 0; index < tileSets.length; index++) {
    const tiles = new THREE.InstancedMesh(cube, floorMaterials[index], tileSets[index].length);
    tileSets[index].forEach((cell, cellIndex) => {
      position.set(cell.x, -.065, cell.z); scale.set(CELL_SIZE - .006, .12, CELL_SIZE - .006);
      matrix.compose(position, new THREE.Quaternion(), scale); tiles.setMatrixAt(cellIndex, matrix);
    });
    tiles.receiveShadow = true; scene.add(tiles);
  }
  const ceiling = new THREE.InstancedMesh(cube, surface(0x616f66), layout.cells.length);
  layout.cells.forEach((cell, index) => {
    position.set(cell.x, WALL_HEIGHT + .04, cell.z); scale.set(CELL_SIZE - .005, .12, CELL_SIZE - .005);
    matrix.compose(position, new THREE.Quaternion(), scale); ceiling.setMatrixAt(index, matrix);
  });
  scene.add(ceiling);
  for (const wall of layout.walls) {
    const horizontal = wall.axis === "x", w = horizontal ? wall.length + .05 : .13, d = horizontal ? .13 : wall.length + .05;
    box(scene, plaster, wall.x, WALL_HEIGHT / 2, wall.z, w, WALL_HEIGHT, d);
    box(scene, trim, wall.x, .56, wall.z, w + .018, 1.12, d + .018);
    box(scene, rust, wall.x, 1.13, wall.z, w + .026, .055, d + .026);
    box(scene, dark, wall.x, .075, wall.z, w + .03, .15, d + .03);
    // Hospital handrails give the walls scale and a clear horizon line.
    box(scene, metal, wall.x, .92, wall.z, w + .11, .065, d + .11);
  }

  const hemisphere = new THREE.HemisphereLight(0xb7dacb, 0x28322c, .95); scene.add(hemisphere);
  const fill = new THREE.AmbientLight(0xaccabc, .25); scene.add(fill);
  const roomFixtures = new Map<RoomId, { light: THREE.PointLight; bulb: THREE.MeshStandardMaterial; panel: THREE.MeshStandardMaterial; ghost: THREE.Group; whisper: THREE.Group }>();
  const corridorFixtures: THREE.PointLight[] = [];

  function sign(parent: THREE.Object3D, title: string, subtitle: string, x: number, y: number, z: number, yaw = 0, warm = false, width = 2.5) {
    const texture = canvasTexture(768, 208, (ctx) => {
      ctx.fillStyle = warm ? "#8e5d24" : "#123932"; ctx.fillRect(0, 0, 768, 208);
      ctx.strokeStyle = warm ? "#f5c876" : "#91bcb0"; ctx.lineWidth = 5; ctx.strokeRect(7, 7, 754, 194);
      ctx.fillStyle = warm ? "#ffdc9b" : "#d1e8d8"; ctx.font = "bold 49px monospace"; ctx.textAlign = "center";
      ctx.fillText(title, 384, 90, 710); ctx.font = "25px monospace"; ctx.fillText(subtitle, 384, 147, 710);
    });
    const mat = material(new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide }));
    const panelGeometry = geometry(new THREE.PlaneGeometry(width, width * 208 / 768));
    const panel = new THREE.Mesh(panelGeometry, mat);
    panel.position.set(x, y, z); panel.rotation.y = yaw; parent.add(panel);
    // Each face has its own orientation, so walking behind a suspended sign
    // never exposes mirrored lettering. The separation prevents depth fighting.
    const reverse = new THREE.Mesh(panelGeometry, mat);
    reverse.position.set(x - Math.sin(yaw) * .008, y, z - Math.cos(yaw) * .008);
    reverse.rotation.y = yaw + Math.PI; parent.add(reverse);
    return panel;
  }

  function bed(x: number, z: number, yaw: number) {
    const group = new THREE.Group(); group.position.set(x, 0, z); group.rotation.y = yaw; scene.add(group);
    box(group, bedFrame, 0, .46, 0, 1.1, .13, 2.15);
    box(group, mattress, 0, .65, 0, 1.03, .26, 2.02);
    box(group, fabric, 0, .82, .28, 1.04, .08, 1.32);
    box(group, mattress, 0, .85, -.67, .77, .17, .42);
    for (const end of [-1, 1]) {
      box(group, bedFrame, 0, .88, end * 1.04, 1.13, .77, .07);
      box(group, dark, 0, .96, end * 1.05, .85, .29, .075);
      for (const side of [-1, 1]) {
        box(group, metal, side * .45, .23, end * .85, .07, .43, .07);
        box(group, dark, side * .45, .11, end * .85, .14, .18, .12);
      }
    }
    box(group, bedFrame, -.58, 1.02, .1, .035, .64, 1.3);
  }

  function figure(ghost = false) {
    const group = new THREE.Group();
    const robe = ghost ? material(new THREE.MeshStandardMaterial({ color: 0x8daca0, transparent: true, opacity: .38, emissive: 0x335a50, side: THREE.DoubleSide })) : surface(0x121c1d);
    const mask = ghost ? robe : surface(0xc1b99c, .74);
    const torso = new THREE.Mesh(geometry(new THREE.CylinderGeometry(.25, .46, 1.3, 9)), robe); torso.position.y = 1.23; group.add(torso);
    const head = new THREE.Mesh(geometry(new THREE.SphereGeometry(.29, 13, 10)), mask); head.position.set(0, 2.04, 0); head.scale.set(.94, 1.13, .8); group.add(head);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(geometry(new THREE.ConeGeometry(.14, .39, 3)), mask); ear.position.set(side * .21, 2.36, 0); ear.rotation.z = side * -.21; group.add(ear);
      box(group, robe, side * .18, .32, 0, .17, .64, .21);
      const arm = box(group, robe, side * .38, 1.17, 0, .14, 1.16, .17); arm.rotation.z = side * -.13;
      box(group, mask, side * .45, .58, .025, .11, .24, .1);
      box(group, dark, side * .115, 2.08, -.218, .13, .115, .035);
      box(group, amberGlow, side * .115, 2.08, -.242, .036, .04, .018);
    }
    box(group, dark, 0, 1.94, -.223, .13, .035, .026);
    group.visible = false; scene.add(group); return group;
  }
  const killer = figure();

  for (const room of ROOMS) {
    const center = toWorld(roomCenter(room.id)), left = room.x / MAP_SCALE, top = room.y / MAP_SCALE;
    const width = room.w / MAP_SCALE, depth = room.h / MAP_SCALE;
    const light = new THREE.PointLight(room.id === "generator" || room.id === "exit" ? 0xf6c48a : 0xb5e4d2, 24, 12, 1.4);
    light.position.set(center.x, 2.85, center.z); scene.add(light);
    const bulb = whiteGlow.clone(); materials.add(bulb);
    const fixture = box(scene, dark, center.x, 3.17, center.z, 1.72, .12, .42);
    box(scene, bulb, center.x, 3.095, center.z, 1.5, .035, .26);
    fixture.castShadow = false;
    sign(scene, `${room.label} / ${room.name}`, room.id === "exit" ? "EMERGENCY EXIT  ↑" : "BLACKSITE / HOSPITAL B-09", center.x, 2.65, top + .105, 0, room.id === "exit", Math.min(width - .4, 3.8));
    // Side wall signage stays visible when entering on the main east/west route.
    sign(scene, room.id === "reception" ? "RECEPTION" : room.name, `${room.label} / LEVEL 01`, left + .105, 2.45, center.z, Math.PI / 2, false, Math.min(depth - .5, 2.8));
    const panel = material(new THREE.MeshStandardMaterial({ color: 0x68ae95, emissive: 0x3a9d79, emissiveIntensity: .7 }));
    box(scene, metal, left + .2, 1.35, top + .8, .14, .5, .31);
    box(scene, panel, left + .285, 1.43, top + .8, .035, .18, .18);
    const ghost = figure(true); ghost.position.set(center.x + 1.25, 0, center.z - 1.7);
    const whisper = new THREE.Group(); scene.add(whisper); whisper.position.set(center.x, 1.7, center.z);
    const whisperMat = material(new THREE.MeshBasicMaterial({ color: 0xa8d6c0, transparent: true, opacity: .45 }));
    for (let index = 0; index < 12; index++) {
      const mark = box(whisper, whisperMat, Math.cos(index * Math.PI / 6) * 1.9, Math.sin(index * 2.2) * .4, Math.sin(index * Math.PI / 6) * 1.9, .015, .06 + index % 3 * .04, .015);
      mark.castShadow = false;
    }
    whisper.visible = false;
    roomFixtures.set(room.id, { light, bulb, panel, ghost, whisper });

    const candidates = [
      { x: left + 1.1, z: top + 1.5 }, { x: left + width - 1.1, z: top + 1.5 },
      { x: left + 1.1, z: top + depth - 1.5 }, { x: left + width - 1.1, z: top + depth - 1.5 },
    ].filter((point) => distanceToNavigation({ x: point.x * MAP_SCALE, y: point.z * MAP_SCALE }) > 31);
    for (const [index, point] of candidates.entries()) {
      if (room.id === "ward" || (room.id === "reception" && index === 1)) { bed(point.x, point.z, 0); continue; }
      if (room.id === "exit") continue;
      if (room.id === "generator") {
        box(scene, dark, point.x, .95, point.z, 1.2, 1.9, .9);
        for (let i = 0; i < 6; i++) box(scene, metal, point.x, .45 + i * .23, point.z + .465, .92, .055, .04);
        box(scene, amberGlow, point.x + .36, 1.65, point.z + .47, .12, .08, .035);
      } else if (room.id === "archive") {
        box(scene, metal, point.x, 1.15, point.z, 1.1, 2.3, .65);
        for (let i = 0; i < 4; i++) {
          box(scene, dark, point.x, .3 + i * .52, point.z + .34, .97, .43, .025);
          for (let j = 0; j < 5; j++) box(scene, j % 2 ? fabric : mattress, point.x - .38 + j * .19, .28 + i * .52, point.z + .37, .14, .37, .22);
        }
      } else {
        box(scene, dark, point.x, .87, point.z, 1.35, .13, .75);
        for (const side of [-1, 1]) box(scene, metal, point.x + side * .52, .43, point.z, .07, .85, .55);
        box(scene, metal, point.x, 1.18, point.z, .45, .5, .12);
        box(scene, panel, point.x, 1.2, point.z + .07, .37, .33, .015);
        box(scene, mattress, point.x + .43, .97, point.z + .15, .24, .045, .3);
      }
    }
    // Non-blocking door leaves and steel jambs along the north wall.
    const doorX = left + width - .72;
    if (distanceToNavigation({ x: doorX * MAP_SCALE, y: (top + .2) * MAP_SCALE }) > 30) {
      box(scene, dark, doorX, 1.14, top + .14, 1.08, 2.28, .09);
      box(scene, trim, doorX, 1.14, top + .2, .93, 2.13, .055);
      box(scene, metal, doorX + .32, 1.02, top + .255, .17, .045, .055);
      box(scene, dark, doorX, 1.73, top + .24, .29, .42, .025);
    }
  }

  // Fluorescent strips and pipes follow the same connected polyline network.
  const fixtureLocations = new Set<string>();
  for (const points of navigationRoutes()) {
    for (let index = 1; index < points.length; index++) {
      const a = toWorld(points[index - 1]), b = toWorld(points[index]);
      const length = Math.hypot(b.x - a.x, b.z - a.z), count = Math.max(1, Math.ceil(length / 4));
      for (let step = 0; step < count; step++) {
        const fraction = (step + .5) / count, x = a.x + (b.x - a.x) * fraction, z = a.z + (b.z - a.z) * fraction;
        if (ROOMS.some((room) => x > room.x / MAP_SCALE + .3 && x < (room.x + room.w) / MAP_SCALE - .3 && z > room.y / MAP_SCALE + .3 && z < (room.y + room.h) / MAP_SCALE - .3)) continue;
        const key = `${Math.round(x)},${Math.round(z)}`; if (fixtureLocations.has(key)) continue; fixtureLocations.add(key);
        const alongX = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
        box(scene, dark, x, 3.15, z, alongX ? 1.35 : .3, .11, alongX ? .3 : 1.35);
        box(scene, whiteGlow, x, 3.08, z, alongX ? 1.2 : .16, .025, alongX ? .16 : 1.2);
        const lamp = new THREE.PointLight(0x91cdb6, 11, 7, 1.5); lamp.position.set(x, 2.85, z); scene.add(lamp); corridorFixtures.push(lamp);
      }
    }
  }
  const exitCenter = toWorld(roomCenter("exit"));
  box(scene, dark, exitCenter.x, 1.3, 25.48, 2.5, 2.6, .15);
  const exitDoor = box(scene, metal, exitCenter.x, 1.22, 25.36, 2.25, 2.42, .12);
  box(scene, amberGlow, exitCenter.x, 1.0, 25.28, 1.8, .1, .12);
  sign(scene, "EXIT  ↑", "KEYCARD + EMERGENCY POWER", exitCenter.x, 2.9, 25.23, Math.PI, true, 2.7);

  const torch = new THREE.SpotLight(0xe4efcd, 62, 20, Math.PI / 6.5, .68, 1.3);
  torch.position.set(.18, -.15, -.08); torch.target.position.set(0, -.1, -8);
  torch.castShadow = true; torch.shadow.mapSize.set(512, 512); torch.shadow.bias = -.0007; torch.shadow.normalBias = .025;
  torch.shadow.camera.near = .1; torch.shadow.camera.far = 22;
  camera.add(torch); camera.add(torch.target);
  const torchBody = box(camera, dark, .29, -.35, -.6, .12, .12, .36); torchBody.castShadow = false;
  const torchRim = box(camera, metal, .29, -.35, -.8, .15, .15, .07); torchRim.castShadow = false;

  const fade = document.createElement("div"); fade.dataset.testid = "camera-transition";
  fade.style.cssText = "position:absolute;inset:0;pointer-events:none;background:#08100f;opacity:0;z-index:2";
  container.appendChild(fade);
  const resize = () => {
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  let yawOffset = 0, pitchOffset = 0, baseYaw = -Math.PI / 2, desiredYaw = baseYaw;
  let pointer: { id: number; x: number; y: number } | null = null;
  const clamp = THREE.MathUtils.clamp;
  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); canvas.style.cursor = "grabbing"; canvas.focus({ preventScroll: true });
  };
  const pointerMove = (event: PointerEvent) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    yawOffset = clamp(yawOffset - (event.clientX - pointer.x) * .004, -1.3, 1.3);
    pitchOffset = clamp(pitchOffset - (event.clientY - pointer.y) * .003, -.65, .5);
    pointer.x = event.clientX; pointer.y = event.clientY;
  };
  const pointerUp = () => { pointer = null; canvas.style.cursor = "grab"; };
  const keyboard = (event: KeyboardEvent) => {
    const amounts: Record<string, [number, number]> = { ArrowLeft: [.13, 0], ArrowRight: [-.13, 0], ArrowUp: [0, .1], ArrowDown: [0, -.1] };
    if (event.key === "Home") { yawOffset = 0; pitchOffset = 0; event.preventDefault(); }
    const amount = amounts[event.key]; if (!amount) return;
    event.preventDefault(); yawOffset = clamp(yawOffset + amount[0], -1.3, 1.3); pitchOffset = clamp(pitchOffset + amount[1], -.65, .5);
  };
  canvas.addEventListener("pointerdown", pointerDown); canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp); canvas.addEventListener("pointercancel", pointerUp); canvas.addEventListener("lostpointercapture", pointerUp); canvas.addEventListener("keydown", keyboard);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let previousPosition: { x: number; z: number } | null = null, previousElapsed = -1, previousStatus: GameState["status"] = "waiting", fadeAmount = 0, disposed = false;
  const selectedRing = new THREE.Mesh(geometry(new THREE.RingGeometry(.85, .89, 48)), material(new THREE.MeshBasicMaterial({ color: 0xe8bc75, transparent: true, opacity: .55, side: THREE.DoubleSide })));
  selectedRing.rotation.x = -Math.PI / 2; selectedRing.position.y = .015; scene.add(selectedRing);

  return {
    update(state, dt, look, selected) {
      if (disposed) return;
      const delta = clamp(Number.isFinite(dt) ? dt : 0, 0, .1);
      const point = toWorld(actorPosition(state, "sam"));
      const reset = state.elapsed < previousElapsed || (state.status === "waiting" && previousStatus !== "waiting");
      const distance = previousPosition ? Math.hypot(point.x - previousPosition.x, point.z - previousPosition.z) : 0;
      const discontinuity = reset || distance > Math.max(.85, delta * 13);
      if (discontinuity) fadeAmount = .94;
      if (state.targetRoomId && state.currentAction?.action === "move") {
        const future = toWorld(routePosition(state.roomId, state.targetRoomId, Math.min(1, state.progress + .012)));
        const dx = future.x - point.x, dz = future.z - point.z;
        if (Math.hypot(dx, dz) > .002) desiredYaw = Math.atan2(-dx, -dz);
      } else if (previousPosition && !discontinuity && distance > .001) {
        desiredYaw = Math.atan2(previousPosition.x - point.x, previousPosition.z - point.z);
      }
      if (reset) { yawOffset = 0; pitchOffset = 0; desiredYaw = -Math.PI / 2; baseYaw = desiredYaw; }
      const turn = Math.atan2(Math.sin(desiredYaw - baseYaw), Math.cos(desiredYaw - baseYaw));
      baseYaw += turn * (reducedMotion.matches ? 1 : 1 - Math.exp(-delta * 7));
      const moving = state.status === "running" && !state.paused && state.currentAction?.action === "move";
      const bob = moving && !reducedMotion.matches ? Math.sin(state.elapsed * 8) * .018 : 0;
      camera.position.set(point.x, (isHiding(state) ? 1.03 : 1.64) + bob, point.z);
      camera.rotation.set(clamp(pitchOffset + (look?.pitch || 0), -.72, .62), baseYaw + clamp(yawOffset + (look?.yaw || 0), -1.5, 1.5), 0, "YXZ");
      const currentBlackout = state.effects.some((effect) => effect.roomId === state.roomId && effect.type === "blackout" && effect.expiresAt > state.elapsed);
      hemisphere.intensity = currentBlackout ? .27 : .95; fill.intensity = currentBlackout ? .06 : .25;
      const shimmer = reducedMotion.matches ? 1 : .97 + Math.sin(state.elapsed * 6.2) * .025;
      for (const [id, fixture] of roomFixtures) {
        const active = state.effects.filter((effect) => effect.roomId === id && effect.expiresAt > state.elapsed);
        const blackout = active.some((effect) => effect.type === "blackout");
        fixture.light.intensity = blackout ? .4 : 24 * shimmer;
        fixture.bulb.emissiveIntensity = blackout ? .025 : 1.4;
        const locked = (state.locks[id] ?? 0) > state.elapsed;
        fixture.panel.color.setHex(locked ? 0xce4b36 : 0x68ae95); fixture.panel.emissive.setHex(locked ? 0x9d261a : 0x3a9d79);
        fixture.ghost.visible = active.some((effect) => effect.type === "apparition");
        fixture.ghost.rotation.y = Math.atan2(fixture.ghost.position.x - point.x, fixture.ghost.position.z - point.z);
        fixture.ghost.position.y = reducedMotion.matches ? 0 : Math.sin(state.elapsed * 2) * .06;
        fixture.whisper.visible = active.some((effect) => effect.type === "whisper");
        fixture.whisper.rotation.y = reducedMotion.matches ? 0 : state.elapsed * .13;
      }
      corridorFixtures.forEach((lamp) => { lamp.intensity = (currentBlackout ? 2 : 11) * shimmer; });
      killer.visible = state.killer.spawned;
      if (killer.visible) {
        const enemy = toWorld(actorPosition(state, "killer")); killer.position.set(enemy.x, 0, enemy.z);
        // The mask faces negative Z in local space.
        killer.rotation.y = Math.atan2(enemy.x - point.x, enemy.z - point.z);
        if (!reducedMotion.matches && state.killer.targetRoomId) killer.position.y = Math.sin(state.elapsed * 7) * .035;
      }
      if (selected) { const center = toWorld(roomCenter(selected)); selectedRing.position.set(center.x, .016, center.z); selectedRing.visible = true; }
      else selectedRing.visible = false;
      exitDoor.position.x = exitCenter.x + (state.status === "escaped" ? 2.1 : 0);
      torch.intensity = state.status === "contained" ? 28 : 62;
      fadeAmount = Math.max(0, fadeAmount - delta * 2.3); fade.style.opacity = String(fadeAmount);
      canvas.dataset.room = state.roomId; canvas.dataset.cameraX = point.x.toFixed(3); canvas.dataset.cameraZ = point.z.toFixed(3);
      canvas.dataset.killerVisible = String(killer.visible); canvas.dataset.scene = "perspective-3d";
      renderer.render(scene, camera);
      previousPosition = point; previousElapsed = state.elapsed; previousStatus = state.status;
    },
    recenter() { yawOffset = 0; pitchOffset = 0; },
    dispose() {
      if (disposed) return; disposed = true; observer.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown); canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp); canvas.removeEventListener("pointercancel", pointerUp); canvas.removeEventListener("lostpointercapture", pointerUp); canvas.removeEventListener("keydown", keyboard);
      scene.traverse((object) => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
      geometries.forEach((value) => value.dispose()); materials.forEach((value) => value.dispose()); textures.forEach((value) => value.dispose());
      torch.shadow.map?.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); fade.remove(); scene.clear();
    },
  };
}
