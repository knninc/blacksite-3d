import * as THREE from "three";
import { actorPosition, isHiding, ROOMS, routePosition, type GameState, type RoomId } from "../simulation.ts";
import { CELL_SIZE, MAP_SCALE, WALL_HEIGHT, createWorldLayout, distanceToNavigation, isWorldWalkable, navigationRoutes, roomCenter, toWorld } from "./world.ts";

export interface Hospital3D {
  update(state: GameState, dt: number, look?: { yaw: number; pitch: number }, selected?: RoomId): void;
  recenter(): void;
  dispose(): void;
}

/** A read-only view of the simulation. The caller owns its clock and all rules. */
export function createHospital3D(container: HTMLElement): Hospital3D {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050809);
  scene.fog = new THREE.FogExp2(0x0b1113, .065);
  const camera = new THREE.PerspectiveCamera(71, 1, .07, 65);
  camera.rotation.order = "YXZ";
  scene.add(camera);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
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
  const plaster = surface(0xa6aaa0), trim = surface(0x344e49), rust = surface(0x4c392b), metal = surface(0x64746e, .58, .6);
  const dark = surface(0x18272a), bedFrame = surface(0x778781, .48, .6), mattress = surface(0xa6b5a8), fabric = surface(0x516d68);
  const whiteGlow = material(new THREE.MeshStandardMaterial({ color: 0x91a79d, emissive: 0x728b78, emissiveIntensity: .75 }));
  const amberGlow = material(new THREE.MeshBasicMaterial({ color: 0xf4bb63 }));

  function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
    const sheet = document.createElement("canvas"); sheet.width = width; sheet.height = height;
    const ctx = sheet.getContext("2d"); if (ctx) draw(ctx);
    const texture = new THREE.CanvasTexture(sheet); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture); return texture;
  }
  // Deterministic stains and cracks keep every visit consistent without assets.
  const wallTexture = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = "#a9afa2"; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1700; i++) {
      const x = (i * 73) % 256, y = (i * 131) % 256;
      ctx.fillStyle = `rgba(24,32,24,${.025 + (i % 7) * .009})`; ctx.fillRect(x, y, 1 + i % 3, 2 + i % 5);
    }
    for (let i = 0; i < 27; i++) {
      const x = i * 67 % 256, y = i * 43 % 236;
      const stain = ctx.createLinearGradient(x, y, x, y + 65);
      stain.addColorStop(0, "rgba(45,36,22,.28)"); stain.addColorStop(1, "rgba(45,36,22,0)");
      ctx.fillStyle = stain; ctx.fillRect(x, y, 3 + i % 9, 65);
    }
    ctx.strokeStyle = "rgba(26,31,25,.36)"; ctx.lineWidth = .7;
    for (let i = 0; i < 8; i++) {
      const x = i * 43 % 256; ctx.beginPath(); ctx.moveTo(x, 0);
      ctx.lineTo(x + 6, 34 + i * 3); ctx.lineTo(x - 2, 47 + i * 3); ctx.lineTo(x + 9, 81 + i * 4); ctx.stroke();
    }
    const damp = ctx.createLinearGradient(0, 165, 0, 256); damp.addColorStop(0, "transparent"); damp.addColorStop(1, "rgba(16,29,22,.65)");
    ctx.fillStyle = damp; ctx.fillRect(0, 0, 256, 256);
  });
  wallTexture.wrapS = wallTexture.wrapT = THREE.RepeatWrapping;
  plaster.map = wallTexture; trim.map = wallTexture;
  const floorTexture = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = "#8b9384"; ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "#303a34"; ctx.lineWidth = 3; ctx.strokeRect(0, 0, 128, 128);
    for (let i = 0; i < 550; i++) {
      ctx.fillStyle = `rgba(10,18,16,${.04 + i % 5 * .02})`;
      ctx.fillRect(i * 31 % 128, i * 67 % 128, 1 + i % 5, 1 + i % 3);
    }
    ctx.strokeStyle = "rgba(22,27,21,.45)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 78); ctx.lineTo(37, 69); ctx.lineTo(49, 79); ctx.lineTo(90, 67); ctx.stroke();
  });

  const layout = createWorldLayout();
  const floorMaterials = [surface(0x617065, .7, .05), surface(0x4f5d54, .78, .04)];
  floorMaterials.forEach((mat) => { mat.map = floorTexture; });
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

  const hemisphere = new THREE.HemisphereLight(0x788c91, 0x111310, .22); scene.add(hemisphere);
  const fill = new THREE.AmbientLight(0x81928a, .055); scene.add(fill);
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

  const clothTexture = canvasTexture(128, 256, (ctx) => {
    ctx.fillStyle = "#535348"; ctx.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 58; i++) {
      const x = i * 37 % 128;
      ctx.fillStyle = `rgba(5,8,7,${.13 + i % 5 * .07})`; ctx.fillRect(x, 0, 1 + i % 4, 256);
    }
    const hem = ctx.createLinearGradient(0, 120, 0, 256); hem.addColorStop(0, "transparent"); hem.addColorStop(1, "#090b09");
    ctx.fillStyle = hem; ctx.fillRect(0, 0, 128, 256);
  });
  const dissolveTexture = canvasTexture(128, 128, (ctx) => {
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const n = ((x * 73 + y * 151 + x * y * 31) % 233) / 233;
      const value = Math.floor(45 + n * 210); ctx.fillStyle = `rgb(${value},${value},${value})`; ctx.fillRect(x, y, 1, 1);
    }
  });
  dissolveTexture.colorSpace = THREE.NoColorSpace;
  const limbGeometry = geometry(new THREE.CylinderGeometry(.075, .1, 1, 7));
  const jointGeometry = geometry(new THREE.SphereGeometry(1, 12, 10));
  const robeGeometry = geometry(new THREE.CylinderGeometry(.24, .47, 1.65, 13, 6, true));
  // Uneven hem, collapsed shoulder and an off-axis neck avoid a toy-like symmetry.
  const robeVertices = robeGeometry.attributes.position;
  for (let i = 0; i < robeVertices.count; i++) {
    const y = robeVertices.getY(i), x = robeVertices.getX(i), z = robeVertices.getZ(i);
    robeVertices.setXYZ(i, x * (1 + Math.sin(i * 2.1) * .065), y < -.8 ? y + .07 + Math.sin(i * 3.7) * .095 : y, z);
  }
  robeGeometry.computeVertexNormals();
  const maskFaceGeometry = geometry(new THREE.PlaneGeometry(.56, .84, 20, 24));
  maskFaceGeometry.rotateY(Math.PI);
  const faceVertices = maskFaceGeometry.attributes.position;
  for (let i = 0; i < faceVertices.count; i++) {
    const x = faceVertices.getX(i);
    faceVertices.setXYZ(i, x, faceVertices.getY(i) + .055, -.145 - .12 * Math.sqrt(Math.max(0, 1 - (x / .28) ** 2)));
  }
  maskFaceGeometry.computeVertexNormals();
  const texturedFaces: { material: THREE.MeshStandardMaterial; face: THREE.Mesh; fallback: THREE.Object3D[] }[] = [];
  interface FigureRig { head: THREE.Group; arms: THREE.Group[]; ghostMaterials: THREE.MeshStandardMaterial[] }
  const figures = new Map<THREE.Group, FigureRig>();
  function figure(ghost = false) {
    const group = new THREE.Group();
    const ghostMaterials: THREE.MeshStandardMaterial[] = [];
    const figureSurface = (color: number, cloth = false) => {
      const mat = material(new THREE.MeshStandardMaterial({ color, roughness: .96, map: cloth ? clothTexture : null,
        side: THREE.DoubleSide, transparent: ghost, opacity: ghost ? .92 : 1,
        alphaMap: ghost ? dissolveTexture : null, alphaTest: ghost ? .025 : 0,
        emissive: ghost ? color : 0x000000, emissiveIntensity: ghost ? .08 : 0 }));
      if (ghost) ghostMaterials.push(mat); return mat;
    };
    const robe = figureSurface(ghost ? 0x7e8c7d : 0x414139, true);
    const skin = figureSurface(ghost ? 0xa6b4a2 : 0x8b8d78);
    const mask = figureSurface(ghost ? 0xc6cbbb : 0xb6b3a0);
    const voidMat = figureSurface(0x030505);
    const ellipsoid = (parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) => {
      const mesh = new THREE.Mesh(jointGeometry, mat); mesh.position.set(x, y, z); mesh.scale.set(w, h, d);
      mesh.castShadow = !ghost; mesh.receiveShadow = true; parent.add(mesh); return mesh;
    };
    const torso = new THREE.Mesh(robeGeometry, robe); torso.position.set(.04, 1.19, .03); torso.rotation.z = -.055;
    torso.castShadow = !ghost; torso.receiveShadow = true; group.add(torso);
    ellipsoid(group, robe, 0, 1.97, .025, .37, .18, .19);
    // Long bare shins below a filthy ward gown.
    for (const side of [-1, 1]) {
      const leg = box(group, skin, side * .17, .29, .03, .105, .63, .12); leg.rotation.z = side * .06;
      box(group, voidMat, side * .17, .055, -.1, .15, .1, .34);
    }
    const head = new THREE.Group(); head.position.set(.08, 2.35, -.025); head.rotation.z = -.24; head.rotation.x = .13; group.add(head);
    ellipsoid(head, skin, -.015, -.12, .03, .1, .28, .1);
    ellipsoid(head, voidMat, 0, .055, .06, .255, .38, .22);
    const fallback: THREE.Object3D[] = [ellipsoid(head, mask, 0, .01, -.095, .225, .305, .145)];
    // A broken, narrow feline votive mask; the motif survives without cute ears or glowing pupils.
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(geometry(new THREE.ConeGeometry(.095, side < 0 ? .25 : .16, 3)), mask);
      ear.position.set(side * .17, .285, -.025); ear.rotation.z = side * -.34; ear.castShadow = !ghost; head.add(ear); fallback.push(ear);
      const socket = ellipsoid(head, voidMat, side * .099, .074 + side * .014, -.225, .071, .095, .027); socket.rotation.z = side * -.22;
      const tear = box(head, voidMat, side * .092, -.04, -.231, .018, .17, .012); tear.rotation.z = side * .12;
      fallback.push(socket, tear);
      // Stringy hair hangs past one cheek, hiding the edge of the mask.
      for (let i = 0; i < 4; i++) {
        const hair = box(head, voidMat, side * (.183 + i * .012), -.02 - i * .025, -.01 - i * .018, .028, .57 + i * .06, .034);
        hair.rotation.z = side * (.04 + i * .025);
      }
    }
    fallback.push(ellipsoid(head, voidMat, .025, -.16, -.225, .044, .092, .025));
    const crack = box(head, voidMat, -.028, .22, -.231, .009, .18, .011); crack.rotation.z = .32; fallback.push(crack);
    const faceMaterial = material(new THREE.MeshStandardMaterial({ color: 0xd7d4c3, roughness: .95, transparent: true, alphaTest: .035, side: THREE.FrontSide }));
    if (ghost) ghostMaterials.push(faceMaterial);
    const face = new THREE.Mesh(maskFaceGeometry, faceMaterial); face.visible = false; face.receiveShadow = true; head.add(face);
    texturedFaces.push({ material: faceMaterial, face, fallback });
    const arms: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group(); arm.position.set(side * .36, 1.94 + side * .045, .005); arm.rotation.z = side * .09; group.add(arm); arms.push(arm);
      const upper = new THREE.Mesh(limbGeometry, robe); upper.position.y = -.36; upper.scale.y = .79; upper.castShadow = !ghost; arm.add(upper);
      const lower = new THREE.Group(); lower.position.set(side * .035, -.73, -.02); lower.rotation.x = side < 0 ? -.16 : .12; arm.add(lower);
      const forearm = new THREE.Mesh(limbGeometry, skin); forearm.position.y = -.36; forearm.scale.set(.6, .82 + side * .08, .65); forearm.castShadow = !ghost; lower.add(forearm);
      ellipsoid(lower, skin, 0, -.8, -.018, .065, .14, .045);
      for (let finger = 0; finger < 4; finger++) {
        const digit = box(lower, skin, (finger - 1.5) * .027, -.95 - finger % 2 * .035, -.035, .018, .25, .022);
        digit.rotation.z = (finger - 1.5) * .08;
      }
    }
    // Every surface retains depth testing: figures disappear behind real walls.
    group.traverse((part) => { if (part instanceof THREE.Mesh) part.castShadow = !ghost; });
    group.visible = false; scene.add(group); figures.set(group, { head, arms, ghostMaterials }); return group;
  }
  const killer = figure();
  function animateFigure(group: THREE.Group, time: number, moving: boolean, still: boolean) {
    const rig = figures.get(group)!;
    const sway = still ? 0 : Math.sin(time * (moving ? 2.6 : .85));
    rig.head.rotation.z = -.24 + sway * .035;
    rig.arms.forEach((arm, index) => { arm.rotation.x = still ? 0 : Math.sin(time * 1.7 + index * 1.9) * (moving ? .18 : .035); });
    group.rotation.z = still ? 0 : sway * .012;
  }

  for (const room of ROOMS) {
    const center = toWorld(roomCenter(room.id)), left = room.x / MAP_SCALE, top = room.y / MAP_SCALE;
    const width = room.w / MAP_SCALE, depth = room.h / MAP_SCALE;
    const light = new THREE.PointLight(room.id === "generator" || room.id === "exit" ? 0xf6c48a : 0x9cb9ac, 6.5, 9, 1.65);
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
        const lamp = new THREE.PointLight(0x7f9a8c, 3.5, 6, 1.7); lamp.position.set(x, 2.85, z); scene.add(lamp); corridorFixtures.push(lamp);
      }
    }
  }
  const exitCenter = toWorld(roomCenter("exit"));
  box(scene, dark, exitCenter.x, 1.3, 25.48, 2.5, 2.6, .15);
  const exitDoor = box(scene, metal, exitCenter.x, 1.22, 25.36, 2.25, 2.42, .12);
  box(scene, amberGlow, exitCenter.x, 1.0, 25.28, 1.8, .1, .12);
  sign(scene, "EXIT  ↑", "KEYCARD + EMERGENCY POWER", exitCenter.x, 2.9, 25.23, Math.PI, true, 2.7);

  const torch = new THREE.SpotLight(0xe3e6ce, 86, 19, Math.PI / 6.2, .82, 1.35);
  torch.position.set(.18, -.15, -.08); torch.target.position.set(0, -.1, -8);
  torch.castShadow = true; torch.shadow.mapSize.set(512, 512); torch.shadow.bias = -.0007; torch.shadow.normalBias = .025;
  torch.shadow.camera.near = .1; torch.shadow.camera.far = 22;
  camera.add(torch); camera.add(torch.target);
  // A dim wide spill preserves nearby orientation outside the narrow torch core.
  const torchSpill = new THREE.PointLight(0xa6b4aa, 1.6, 3.7, 1.5); camera.add(torchSpill);
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
  const wrapYaw = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); canvas.style.cursor = "grabbing"; canvas.focus({ preventScroll: true });
  };
  const pointerMove = (event: PointerEvent) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    yawOffset = wrapYaw(yawOffset - (event.clientX - pointer.x) * .004);
    pitchOffset = clamp(pitchOffset - (event.clientY - pointer.y) * .003, -.65, .5);
    pointer.x = event.clientX; pointer.y = event.clientY;
  };
  const pointerUp = () => { pointer = null; canvas.style.cursor = "grab"; };
  const keyboard = (event: KeyboardEvent) => {
    const amounts: Record<string, [number, number]> = { ArrowLeft: [.13, 0], ArrowRight: [-.13, 0], ArrowUp: [0, .1], ArrowDown: [0, -.1] };
    if (event.key === "Home") { yawOffset = 0; pitchOffset = 0; event.preventDefault(); }
    const amount = amounts[event.key]; if (!amount) return;
    event.preventDefault(); yawOffset = wrapYaw(yawOffset + amount[0]); pitchOffset = clamp(pitchOffset + amount[1], -.65, .5);
  };
  canvas.addEventListener("pointerdown", pointerDown); canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp); canvas.addEventListener("pointercancel", pointerUp); canvas.addEventListener("lostpointercapture", pointerUp); canvas.addEventListener("keydown", keyboard);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let previousPosition: { x: number; z: number } | null = null, previousElapsed = -1, previousStatus: GameState["status"] = "waiting", fadeAmount = 0, disposed = false;
  canvas.dataset.maskTexture = "loading";
  const maskTexture = new THREE.TextureLoader().load("/nuko-mask-v1.png", texture => {
    if (disposed) { texture.dispose(); return; }
    texture.colorSpace = THREE.SRGBColorSpace;
    for (const record of texturedFaces) {
      record.material.map = texture; record.material.needsUpdate = true;
      record.face.visible = true; record.fallback.forEach(part => { part.visible = false; });
    }
    canvas.dataset.maskTexture = "ready";
  }, undefined, () => { if (!disposed) canvas.dataset.maskTexture = "unavailable"; });
  textures.add(maskTexture);
  let animationTime = 0, apparitionCount = 0;
  const apparitionPresentations = new Map<RoomId, { effectId: number; presented: boolean }>();
  const viewDirection = new THREE.Vector3();
  const frustum = new THREE.Frustum(), viewMatrix = new THREE.Matrix4();
  const apparitionCenter = new THREE.Vector3();
  const apparitionBounds = new THREE.Sphere(apparitionCenter, .65);
  // Walk the same occupied grid as the renderer before anchoring a hallucination.
  // This never writes the simulation, nor does it move the actual killer.
  function placeApparition(group: THREE.Group) {
    camera.getWorldDirection(viewDirection);
    const horizontalLength = Math.hypot(viewDirection.x, viewDirection.z) || 1;
    const dx = viewDirection.x / horizontalLength, dz = viewDirection.z / horizontalLength;
    let ahead = .3;
    for (let sample = .3; sample <= 2.2; sample += .1) {
      if (!isWorldWalkable(layout, camera.position.x + dx * sample, camera.position.z + dz * sample)) break;
      ahead = sample;
    }
    group.position.set(camera.position.x + dx * ahead, 0, camera.position.z + dz * ahead);
    // Match the current vertical look for the first presentation, then stay
    // anchored in world space so looking away remains possible.
    group.position.y = Math.max(-1.6, Math.min(.25, camera.position.y + viewDirection.y / horizontalLength * ahead - 1.92));
    group.rotation.y = Math.atan2(group.position.x - camera.position.x, group.position.z - camera.position.z);
  }
  const selectedRing = new THREE.Mesh(geometry(new THREE.RingGeometry(.85, .89, 48)), material(new THREE.MeshBasicMaterial({ color: 0xe8bc75, transparent: true, opacity: .55, side: THREE.DoubleSide })));
  selectedRing.rotation.x = -Math.PI / 2; selectedRing.position.y = .015; scene.add(selectedRing);

  return {
    update(state, dt, look, selected) {
      if (disposed) return;
      const delta = state.paused ? 0 : clamp(Number.isFinite(dt) ? dt : 0, 0, .1);
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
      if (reset) {
        yawOffset = 0; pitchOffset = 0; desiredYaw = -Math.PI / 2; baseYaw = desiredYaw;
        animationTime = 0; apparitionCount = 0; apparitionPresentations.clear();
      }
      if (state.status === "running") animationTime += delta;
      const turn = Math.atan2(Math.sin(desiredYaw - baseYaw), Math.cos(desiredYaw - baseYaw));
      baseYaw += turn * (reducedMotion.matches ? 1 : 1 - Math.exp(-delta * 7));
      const moving = state.status === "running" && state.currentAction?.action === "move";
      const bob = moving && !reducedMotion.matches ? Math.sin(animationTime * 8) * .018 : 0;
      camera.position.set(point.x, (isHiding(state) ? 1.03 : 1.64) + bob, point.z);
      camera.rotation.set(clamp(pitchOffset + (look?.pitch || 0), -.72, .62), baseYaw + yawOffset + (look?.yaw || 0), 0, "YXZ");
      const currentBlackout = state.effects.some((effect) => effect.roomId === state.roomId && effect.type === "blackout" && effect.expiresAt > state.elapsed);
      const enemyPoint = state.killer.spawned ? toWorld(actorPosition(state, "killer")) : null;
      const enemyDistance = enemyPoint ? Math.hypot(enemyPoint.x - point.x, enemyPoint.z - point.z) : 40;
      const tension = clamp(Math.max(state.fear / 100, 1 - enemyDistance / 9), 0, 1);
      hemisphere.intensity = currentBlackout ? .075 : .22; fill.intensity = currentBlackout ? .018 : .055;
      // Slow irregular ballast sag, never a rapid strobe. Both clocks freeze at dt=0.
      const ballast = reducedMotion.matches ? 1 : .94 + Math.sin(animationTime * 1.45) * .035 + Math.sin(animationTime * .47) * .025;
      const breath = reducedMotion.matches ? 0 : (Math.sin(animationTime * 2.15) + 1) * .5 * tension;
      let currentApparition = false, visibleApparitions = 0;
      camera.updateMatrixWorld(); viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(viewMatrix);
      for (const [id, fixture] of roomFixtures) {
        const active = state.effects.filter((effect) => effect.roomId === id && effect.expiresAt > state.elapsed);
        const blackout = active.some((effect) => effect.type === "blackout");
        const pressure = id === state.roomId ? 1 - breath * .22 : 1;
        fixture.light.intensity = blackout ? .1 : 6.5 * ballast * pressure;
        fixture.bulb.emissiveIntensity = blackout ? .008 : .75 * ballast * pressure;
        const locked = (state.locks[id] ?? 0) > state.elapsed;
        fixture.panel.color.setHex(locked ? 0xce4b36 : 0x68ae95); fixture.panel.emissive.setHex(locked ? 0x9d261a : 0x3a9d79);
        const apparition = active.find((effect) => effect.type === "apparition");
        fixture.ghost.visible = !!apparition;
        if (apparition) {
          let presentation = apparitionPresentations.get(id);
          if (!presentation || presentation.effectId !== apparition.id) {
            presentation = { effectId: apparition.id, presented: false }; apparitionPresentations.set(id, presentation);
          }
          if (id === state.roomId && !presentation.presented) {
            placeApparition(fixture.ghost); presentation.presented = true; apparitionCount++;
          }
          // Appears clearly, holds, then breaks into black patches during its final second.
          const remaining = apparition.expiresAt - state.elapsed;
          const dissolve = reducedMotion.matches ? 0 : clamp(1 - remaining / 1.25, 0, 1);
          for (const mat of figures.get(fixture.ghost)!.ghostMaterials) {
            mat.opacity = .92 * (1 - dissolve * .85); mat.alphaTest = .025 + dissolve * .94;
            mat.emissiveIntensity = .08 * (1 - dissolve);
          }
          animateFigure(fixture.ghost, animationTime, false, reducedMotion.matches);
          if (id === state.roomId) currentApparition = true;
          apparitionCenter.copy(fixture.ghost.position); apparitionCenter.y += 1.7;
          if (frustum.intersectsSphere(apparitionBounds)) visibleApparitions++;
        } else apparitionPresentations.delete(id);
        fixture.whisper.visible = active.some((effect) => effect.type === "whisper");
        fixture.whisper.rotation.y = reducedMotion.matches ? 0 : animationTime * .13;
      }
      corridorFixtures.forEach((lamp) => { lamp.intensity = (currentBlackout ? .18 : 3.5) * ballast * (1 - breath * .12); });
      killer.visible = state.killer.spawned;
      if (enemyPoint) {
        killer.position.set(enemyPoint.x, 0, enemyPoint.z);
        // The mask faces negative Z in local space. Position stays authoritative.
        killer.rotation.y = Math.atan2(enemyPoint.x - point.x, enemyPoint.z - point.z);
        animateFigure(killer, animationTime, !!state.killer.targetRoomId, reducedMotion.matches);
      }
      canvas.dataset.apparitionCurrent = String(currentApparition);
      canvas.dataset.apparitionPresentations = String(apparitionCount);
      // Frustum count is explicitly a camera-range diagnostic, not an occlusion claim.
      canvas.dataset.apparitionInFrustum = String(visibleApparitions);
      canvas.dataset.visualTension = tension.toFixed(2);
      if (selected) { const center = toWorld(roomCenter(selected)); selectedRing.position.set(center.x, .016, center.z); selectedRing.visible = true; }
      else selectedRing.visible = false;
      exitDoor.position.x = exitCenter.x + (state.status === "escaped" ? 2.1 : 0);
      torch.intensity = (state.status === "contained" ? 45 : 86) * (1 - breath * .1);
      torch.target.position.x = reducedMotion.matches ? 0 : Math.sin(animationTime * 1.2) * .05 * tension;
      torchSpill.intensity = currentBlackout ? .85 : 1.6;
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
