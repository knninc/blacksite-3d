import { createGameAudio } from "../audio.ts";
import {
  ROOMS, MAP_ROUTES, SABOTAGE, createState, tick, sabotage, applyDecision,
  killerDecisions, killerDecisionSignature, applyKillerDecision,
  type GameState, type RoomId, type SabotageType, type Decision,
} from "../simulation.ts";
import { legalDecisions, createSessionRequest, createDecisionRequest, createKillerDecisionRequest, roomName } from "../live-contract.ts";
import { createHospital3D } from "./renderer";
import "./game.css";

const interventions: { type: SabotageType; name: string; detail: string; glyph: string }[] = [
  { type: "blackout", name: "停電", detail: "照明を落とし、作業を遅らせる", glyph: "◐" },
  { type: "lock", name: "扉を封鎖", detail: "移動を止め、経路を変える", glyph: "⊞" },
  { type: "whisper", name: "囁き", detail: "部屋に声を響かせ、恐怖を上げる", glyph: "≋" },
  { type: "apparition", name: "怪異", detail: "姿を現し、恐怖を大きく上げる", glyph: "◇" },
];
const actionLabels: Record<string, string> = { move: "移動", search: "探索", restore: "電源復旧", unlock: "解錠", hide: "隠れる", wait: "呼吸を整える" };
const clock = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, "0")}:${Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, "0")}`;

/** Mounts an independent view. All authoritative rules remain in simulation.ts. */
export function mountBlacksite3D(root: HTMLElement): () => void {
  root.classList.add("blacksite3d");
  root.innerHTML = `
    <div class="b3-scene" data-ui="scene" aria-label="AIサムの視点で見る病院。ドラッグで見回せます。"></div>
    <div class="b3-vignette" aria-hidden="true"></div><div class="b3-scanline" aria-hidden="true"></div>
    <div class="b3-crosshair" aria-hidden="true"><i></i></div>
    <header class="b3-header">
      <a class="b3-brand" href="/" aria-label="BLACKSITE SUBJECT VIEW"><strong>BLACKSITE<span> / SUBJECT VIEW</span></strong><small>AIサムが歩く。あなたは病院だ。</small></a>
      <nav class="b3-controls" aria-label="表示・音・ゲーム操作">
        <button type="button" data-ui="sound" aria-pressed="false">音 OFF</button>
        <button type="button" data-ui="recenter" title="サムの進行方向へ戻す">視点を戻す</button>
        <button type="button" data-ui="map-toggle" aria-expanded="false" aria-controls="b3-map-panel">病院図</button>
        <button type="button" data-ui="help-toggle" aria-expanded="false" aria-controls="b3-help-panel">操作 ?</button>
        <button type="button" data-ui="pause">一時停止</button>
      </nav>
    </header>
    <section class="b3-topline" aria-label="ゲーム状況">
      <div class="b3-status"><span class="b3-dot"></span><span data-ui="mode">ローカルAI / API通信なし</span><small data-ui="phase">開始待ち</small></div>
      <div class="b3-metrics"><div><span>残り時間</span><strong data-ui="time">03:00</strong></div><div><span>恐怖</span><strong data-ui="fear">08<span>/100</span></strong><meter data-ui="fear-meter" min="0" max="100" value="8" aria-label="サムの恐怖"></meter></div></div>
    </section>
    <section class="b3-objectives" aria-label="サムの脱出進行">
      <p class="b3-eyebrow">SUBJECT OBJECTIVES</p>
      <ol><li data-ui="key-objective"><i>01</i><span>キーカード</span><small data-ui="key-state">未取得</small></li><li data-ui="power-objective"><i>02</i><span>非常用電源</span><small data-ui="power-state">未復旧</small></li><li data-ui="exit-objective"><i>03</i><span>避難口</span><small data-ui="exit-state">未解錠</small></li></ol>
    </section>
    <aside class="b3-map" id="b3-map-panel" data-ui="map" hidden aria-label="干渉先の部屋選択">
      <div class="b3-panel-heading"><span>FACILITY / 7 ROOMS</span><button type="button" data-ui="map-close" aria-label="病院図を閉じる">×</button></div>
      <svg viewBox="90 90 850 590" role="img" aria-label="7室の接続図">
        ${MAP_ROUTES.map(route => `<polyline points="${route.points.map(point => point.join(",")).join(" ")}"/>`).join("")}
        ${ROOMS.map(room => `<g data-map-room="${room.id}"><rect x="${room.x}" y="${room.y}" width="${room.w}" height="${room.h}" rx="8"/><text x="${room.x + room.w / 2}" y="${room.y + room.h / 2 + 10}">${room.label}</text></g>`).join("")}
      </svg>
      <button type="button" class="b3-follow" data-ui="follow" aria-pressed="true">◎ サムの進行先を自動選択</button>
      <div class="b3-rooms">${ROOMS.map(room => `<button type="button" data-room="${room.id}" aria-pressed="false"><span>${room.label}</span>${roomName(room.id)}</button>`).join("")}</div>
      <p>番号は部屋。明るい部屋がサムの現在地。<br>選んだ部屋に、下の4つの干渉を送ります。</p>
    </aside>
    <aside class="b3-help" id="b3-help-panel" data-ui="help" hidden>
      <p class="b3-eyebrow">YOU ARE THE BUILDING</p><h2>サムの脱出を阻止する。</h2>
      <p>サムはAIで自動移動します。あなたが歩く操作はありません。視点をドラッグして、サムが見る病院を見回してください。</p>
      <p><kbd>1</kbd> 停電　<kbd>2</kbd> 封鎖　<kbd>3</kbd> 囁き　<kbd>4</kbd> 怪異<br><kbd>Space</kbd> 一時停止・再開　<kbd>R</kbd> リセット<br><kbd>Esc</kbd> 一時停止　<kbd>↑ ↓ ← →</kbd> 視点</p>
      <p>干渉先はサムの進行先を自動追従。病院図から任意の部屋も選べます。エネルギーは徐々に回復し、Tiboの支援で100と待機時間が回復します。</p>
      <p>180秒以内にサムが脱出するとあなたの敗北。恐怖100または時間切れで脱出を阻止できます。キーカード取得後にぬこぬこさんが出現します。</p>
      <a href="/classic">クラシック版へ</a>
    </aside>
    <div class="b3-support" data-ui="support" hidden role="status">TIBO / 支援到着 <span>エネルギー100・全干渉の待機時間をリセット</span></div>
    <section class="b3-bottom">
      <div class="b3-subject"><div><span class="b3-eyebrow">SAM / AI ACTION</span><span data-ui="elapsed">経過 00:00</span></div><h2 data-ui="action">病院は、あなたを待っている。</h2><p data-ui="reason" aria-live="polite">サムが自動で脱出を試みます。あなたは病院として干渉します。</p><small data-ui="threat">ぬこぬこさん / 未出現</small></div>
      <div class="b3-intervention-heading"><div><span class="b3-eyebrow">INTERVENTION</span><span data-ui="target">干渉先：受付 / 自動追従</span></div><div class="b3-energy"><span>ENERGY</span><strong data-ui="energy">100</strong><progress data-ui="energy-meter" max="100" value="100" aria-label="干渉エネルギー"></progress></div></div>
      <div class="b3-interventions">${interventions.map((item, index) => `<button type="button" data-intervention="${item.type}" title="${item.detail}" disabled><span class="b3-intervention-top"><kbd>${index + 1}</kbd><i>${item.glyph}</i></span><strong>${item.name}</strong><span class="b3-intervention-info" data-feedback="${item.type}">ENERGY ${SABOTAGE[item.type].cost}</span><span class="b3-cooldown-track"><i data-cooldown="${item.type}"></i></span></button>`).join("")}</div>
      <p class="b3-notice" data-ui="notice" role="status">ドラッグで見回す / 1–4で干渉 / Spaceで停止</p>
    </section>
    <div class="b3-overlay" data-ui="overlay">
      <section class="b3-intro" data-ui="intro" aria-label="ゲーム開始">
        <p class="b3-eyebrow">A FIRST-PERSON AI HORROR EXPERIMENT</p><p class="b3-intro-wordmark">BLACKSITE<span>SUBJECT VIEW</span></p>
        <h1>AIサムが歩く。<br>あなたは病院だ。</h1><p class="b3-intro-copy">脱出を試みるAIの目を通して、廃病院を見る。<br>照明、扉、囁き、怪異。あなたの干渉で、判断が変わる。</p>
        <div class="b3-mode-picker"><label for="b3-controller">サムの判断</label><select id="b3-controller" data-ui="controller"><option value="local">ローカルAI / API通信なし</option><option value="api" disabled>実API / 未確認</option></select><button type="button" data-ui="check-api">実APIの接続を確認</button></div>
        <p class="b3-api-status" data-ui="api-status">すぐに遊べます。自動で動くサムの脱出を阻止してください。</p>
        <div class="b3-start-buttons"><button type="button" class="b3-primary" data-ui="start-silent">音なしで開始 <span>↗</span></button><button type="button" data-ui="start-sound">音ありで開始</button></div>
        <p class="b3-intro-foot">180秒の逃走 / 7つの部屋 / 4つの干渉 <a href="/classic">クラシック版 ↗</a></p>
      </section>
      <section class="b3-pause-card" data-ui="pause-card" hidden aria-label="一時停止">
        <p class="b3-eyebrow" data-ui="pause-eyebrow">SIMULATION PAUSED</p><h2 data-ui="pause-title">一時停止</h2><p data-ui="pause-detail">サムも病院の時間も停止しています。</p><button type="button" class="b3-primary" data-ui="resume">再開する</button><button type="button" data-ui="retry" hidden>実APIを再試行</button><button type="button" data-ui="reset">最初から</button><a href="/classic">クラシック版へ</a>
      </section>
      <section class="b3-result" data-ui="result" hidden aria-label="ゲーム結果"><p class="b3-eyebrow" data-ui="result-label">RUN COMPLETE</p><h2 data-ui="result-title"></h2><p data-ui="result-copy"></p><div class="b3-result-stats" data-ui="result-stats"></div><button type="button" class="b3-primary" data-ui="replay">もう一度プレイ</button><button type="button" data-ui="result-reset">モードを選び直す</button><a href="/classic">クラシック版へ</a></section>
    </div>`;

  const events = new AbortController();
  const ui = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-ui="${name}"]`)!;
  const text = (name: string, value: string) => { const node = ui(name); if (node.textContent !== value) node.textContent = value; };
  const listen = (element: EventTarget, name: string, handler: EventListener) => element.addEventListener(name, handler, { signal: events.signal });
  let disposed = false;
  let renderer: ReturnType<typeof createHospital3D>;
  try { renderer = createHospital3D(ui("scene")); }
  catch {
    root.innerHTML = '<section class="b3-unsupported"><p>BLACKSITE / SUBJECT VIEW</p><h1>この環境では3D表示を開始できません。</h1><p>WebGLが利用できるブラウザーで開き直してください。</p><a href="/classic">クラシック版を開く ↗</a></section>';
    return () => { root.replaceChildren(); root.classList.remove("blacksite3d"); };
  }
  let state: GameState = createState();
  let followSam = true;
  let selected: RoomId = "reception";
  let started = false;
  let generation = 0;
  let sessionId = "", sessionToken = "", plan = "";
  let apiPending = false, apiError = "", phase = "";
  let apiAvailable = false;
  let pending: { actor: "escape" | "killer"; decision: Decision; signature: string } | null = null;
  let soundOn = false, soundLoading = false, soundRevision = 0;
  let supportRemaining = 0, noticeRemaining = 0;
  let look = { yaw: 0, pitch: 0 };
  const lookKeys = new Set<string>();
  const audio = createGameAudio({ onError: message => notice(message, 8) });

  function targetRoom(): RoomId { return followSam ? state.targetRoomId ?? state.roomId : selected; }
  function notice(message: string, seconds = 4) { text("notice", message); noticeRemaining = seconds; }
  function closeSession(id = sessionId, token = sessionToken) {
    if (!id || !token) return;
    void fetch(`/api/session/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-blacksite-session-token": token }, keepalive: true }).catch(() => {});
  }
  function releaseSession() { closeSession(); sessionId = sessionToken = ""; }
  function canAdvance() { return started && state.status === "running" && !state.paused && !state.thinking && !apiError && !document.hidden; }
  async function setSound(value: boolean) {
    const revision = ++soundRevision;
    soundOn = value; soundLoading = value;
    const result = audio.setEnabled(value);
    render();
    const ready = await result;
    if (disposed || revision !== soundRevision) return;
    soundOn = ready; soundLoading = false; render();
  }
  async function request(path: string, body: unknown) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    const data = await response.json();
    // Server messages can contain provider payloads. Keep public errors categorical.
    if (!response.ok) throw new Error(response.status === 401 ? "実APIの認証が必要です。認証後に再試行してください。" : `実APIの通信に失敗しました（HTTP ${response.status}）。`);
    return data;
  }
  function failApi(error: unknown) {
    apiError = error instanceof Error && /^(実API|API|ぬこぬこ|保留)/.test(error.message) ? error.message : "実APIの応答を取得できませんでした。接続を確認して再試行してください。";
    state.paused = true;
  }
  async function startLive() {
    if (!apiAvailable || apiPending || disposed) return;
    const gen = generation;
    apiPending = true; state.thinking = true; phase = "脱出方針を生成中 / 時間停止"; apiError = "";
    render();
    try {
      const result = await request("/api/session", createSessionRequest());
      if (gen !== generation || disposed) { closeSession(result.sessionId, result.sessionToken); return; }
      if (typeof result.sessionId !== "string" || !result.sessionId || typeof result.sessionToken !== "string" || !result.sessionToken || typeof result.outputText !== "string") {
        closeSession(result.sessionId, result.sessionToken);
        throw new Error("APIのセッション応答が不正です。");
      }
      sessionId = result.sessionId; sessionToken = result.sessionToken; plan = result.outputText;
      state.decisions.unshift({ time: state.elapsed, action: "plan", target: state.roomId, reason: plan, source: "api" });
    } catch (error) { if (gen === generation && !disposed) failApi(error); }
    finally { if (gen === generation && !disposed) { apiPending = false; state.thinking = false; phase = ""; render(); } }
  }
  function applyPending() {
    if (!pending || !canAdvance()) return;
    const result = pending; pending = null;
    const valid = result.actor === "killer"
      ? result.signature === killerDecisionSignature(state) && applyKillerDecision(state, result.decision)
      : applyDecision(state, result.decision, "api");
    if (!valid) failApi(new Error("保留中の判断が現在の状況に適用できません。実APIを再試行してください。"));
  }
  async function nextDecision() {
    if (state.controller !== "api" || !sessionId || !canAdvance() || apiPending || pending) return;
    const killerChoices = killerDecisions(state);
    const actor = killerChoices.length ? "killer" : "escape";
    if (actor === "escape" && state.currentAction) return;
    const choices = actor === "killer" ? killerChoices : legalDecisions(state);
    if (!choices.length) { failApi(new Error("APIに渡せる合法な行動がありません。")); return; }
    if (actor === "escape" && choices.length === 1) {
      if (applyDecision(state, choices[0], "system")) state.decisions[0].reason = `強制行動：${choices[0].reason}`;
      return;
    }
    const gen = generation, signature = killerDecisionSignature(state);
    apiPending = true; state.thinking = true; phase = `${actor === "killer" ? "ぬこぬこさん" : "サム"}の判断待ち / 時間停止`;
    render();
    try {
      const result = await request("/api/decision", actor === "killer" ? createKillerDecisionRequest(state, choices, sessionId, sessionToken) : createDecisionRequest(state, plan, choices, sessionId, sessionToken));
      if (disposed || gen !== generation) return;
      if (result.actor !== actor) throw new Error("APIの操作対象が一致しません。");
      const prefix = actor === "killer" ? "killer_choice_" : "choice_";
      const id = result.action?.id;
      const index = typeof id === "string" && id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length)) ? Number(id.slice(prefix.length)) : -1;
      const decision = id === `${prefix}${index}` ? choices[index] : undefined;
      if (!decision) throw new Error("APIが合法な行動を返しませんでした。");
      if (actor === "killer" && (signature !== killerDecisionSignature(state) || !applyKillerDecision({ ...structuredClone(state), paused: false }, decision))) throw new Error("ぬこぬこさんの追跡経路が合法ではありません。");
      // Hold completed responses across pause / tab hide; apply only after explicit resume.
      pending = { actor, decision, signature };
      apiError = "";
    } catch (error) { if (gen === generation && !disposed) failApi(error); }
    finally { if (gen === generation && !disposed) { apiPending = false; state.thinking = false; phase = ""; render(); } }
  }
  async function checkApi() {
    const button = ui<HTMLButtonElement>("check-api");
    button.disabled = true; text("api-status", "実APIの設定と認証状態を確認中…");
    try {
      const response = await fetch("/api/status", { signal: AbortSignal.any([events.signal, AbortSignal.timeout(15000)]) });
      const data = await response.json();
      if (disposed) return;
      apiAvailable = response.ok && data.configured === true && data.authenticated === true;
      const option = ui<HTMLSelectElement>("controller").options[1];
      option.disabled = !apiAvailable;
      option.textContent = apiAvailable ? "実API / 接続可能" : "実API / 利用不可";
      text("api-status", apiAvailable ? "実APIが利用できます。選択するとAIの判断時に通信します。" : "実APIの設定または認証を確認できません。ローカルAIで遊べます。");
    } catch { if (!disposed) text("api-status", "実APIの接続を確認できませんでした。ローカルAIで遊べます。"); }
    finally { if (!disposed) button.disabled = false; }
  }
  function start(withSound: boolean) {
    if (started || disposed) return;
    const live = ui<HTMLSelectElement>("controller").value === "api";
    if (live && !apiAvailable) return;
    started = true; state.status = "running"; state.controller = live ? "api" : "local"; state.paused = false;
    void setSound(withSound); // Silent start always disables an earlier audio preference.
    if (live) void startLive();
    else tick(state, 0.001);
    render();
    ui("pause").focus({ preventScroll: true });
  }
  function reset() {
    generation++; releaseSession(); pending = null; apiPending = false; apiError = ""; phase = ""; plan = "";
    soundRevision++; audio.reset(); soundOn = soundLoading = false;
    state = createState(); started = false; followSam = true; selected = "reception";
    supportRemaining = noticeRemaining = 0; look = { yaw: 0, pitch: 0 }; lookKeys.clear(); renderer.recenter();
    text("notice", "ドラッグで見回す / 1–4で干渉 / Spaceで停止"); render();
  }
  function pauseToggle(forcePause = false) {
    if (!started || state.status !== "running") return;
    if (apiError) { notice("実APIエラーがあります。「実APIを再試行」で再開してください。"); return; }
    state.paused = forcePause || !state.paused; lookKeys.clear(); render();
  }
  function retry() {
    if (!apiError || state.controller !== "api" || apiPending) return;
    apiError = ""; state.paused = false;
    if (!sessionId) void startLive();
    else void nextDecision();
    render();
  }
  function interfere(type: SabotageType) {
    const room = targetRoom();
    if (document.hidden || !canAdvance()) return;
    if (sabotage(state, type, room)) { audio.playIntervention(type); notice(`${roomName(room)} / ${interventions.find(item => item.type === type)!.name}を発動`); }
    else notice(state.energy < SABOTAGE[type].cost ? "エネルギーが足りません。回復を待ってください。" : "この干渉は待機時間中です。");
    render();
  }
  function togglePanel(name: "map" | "help", force?: boolean) {
    const visible = force ?? ui(name).hidden;
    ui(name).hidden = !visible;
    ui(`${name}-toggle`).setAttribute("aria-expanded", String(visible));
  }

  function render() {
    if (disposed) return;
    const ended = state.status === "escaped" || state.status === "contained";
    const paused = started && state.paused && !ended;
    ui("overlay").hidden = started && !paused && !ended;
    ui("intro").hidden = started; ui("pause-card").hidden = !paused; ui("result").hidden = !ended;
    root.classList.toggle("b3-is-playing", started); root.classList.toggle("b3-is-paused", paused);
    root.classList.toggle("b3-danger", state.fear >= 70);
    text("mode", state.controller === "local" ? "ローカルAI / API通信なし" : "実API / 接続中");
    text("phase", !started ? "開始待ち" : apiError ? "実APIエラー / 停止" : phase || (ended ? "終了" : state.paused ? "一時停止" : "RUNNING"));
    text("time", clock(state.timeRemaining)); text("elapsed", `経過 ${clock(state.elapsed)}`);
    text("fear", `${Math.round(state.fear).toString().padStart(2, "0")} /100`);
    ui<HTMLMeterElement>("fear-meter").value = state.fear;
    text("energy", String(Math.floor(state.energy))); ui<HTMLProgressElement>("energy-meter").value = state.energy;
    text("pause", state.paused ? "再開" : "一時停止"); ui<HTMLButtonElement>("pause").disabled = !started || ended || Boolean(apiError);
    text("sound", soundLoading ? "音 読込中" : soundOn ? "音 ON" : "音 OFF"); ui("sound").setAttribute("aria-pressed", String(soundOn));
    const room = targetRoom();
    text("target", `干渉先：${roomName(room)} / ${followSam ? "自動追従" : "手動選択"}`);
    ui("follow").setAttribute("aria-pressed", String(followSam));
    for (const roomButton of root.querySelectorAll<HTMLButtonElement>("button[data-room]")) {
      const active = roomButton.dataset.room === room;
      roomButton.setAttribute("aria-pressed", String(active));
      roomButton.classList.toggle("b3-sam-room", roomButton.dataset.room === state.roomId);
    }
    for (const mapRoom of root.querySelectorAll<SVGGElement>("[data-map-room]")) {
      mapRoom.classList.toggle("b3-selected-room", mapRoom.dataset.mapRoom === room);
      mapRoom.classList.toggle("b3-current-room", mapRoom.dataset.mapRoom === state.roomId);
    }
    for (const [name, complete] of [["key", state.keycard], ["power", state.power], ["exit", state.status === "escaped"]] as const) ui(`${name}-objective`).classList.toggle("b3-complete", complete);
    text("key-state", state.keycard ? "取得済" : "未取得"); text("power-state", state.power ? "復旧済" : "未復旧"); text("exit-state", state.status === "escaped" ? "脱出" : state.keycard && state.power ? "解錠可能" : "未解錠");
    const action = state.currentAction;
    const lastDecision = state.decisions.find(entry => entry.actor !== "killer" && entry.source !== "system" && entry.action !== "plan");
    text("action", !started ? "病院は、あなたを待っている。" : state.thinking ? phase : action ? `${actionLabels[action.action]} / ${roomName(action.target)}` : ended ? "観測終了" : state.paused ? "観測を一時停止" : "次の行動を判断中");
    text("reason", action?.reason || lastDecision?.reason || plan || "サムが自動で脱出を試みます。あなたは病院として干渉します。");
    text("threat", !state.killer.spawned ? "ぬこぬこさん / 未出現" : state.killer.encountered ? `ぬこぬこさん / 接触 ${state.killer.encounterCount}回・追跡中` : "ぬこぬこさん / キーカード取得により出現");
    for (const item of interventions) {
      const rule = SABOTAGE[item.type], cooldown = Math.max(0, state.cooldowns[item.type] - state.elapsed);
      const button = root.querySelector<HTMLButtonElement>(`[data-intervention="${item.type}"]`)!;
      button.disabled = !canAdvance() || cooldown > 0 || state.energy < rule.cost;
      const feedback = `${rule.cost} ENERGY · ${cooldown > 0 ? `あと${Math.ceil(cooldown)}秒` : state.energy < rule.cost ? "不足" : "READY"}`;
      root.querySelector(`[data-feedback="${item.type}"]`)!.textContent = feedback;
      root.querySelector<HTMLElement>(`[data-cooldown="${item.type}"]`)!.style.width = `${cooldown / rule.cooldown * 100}%`;
      button.setAttribute("aria-label", `${item.name}、${roomName(room)}、${feedback}`);
    }
    ui("support").hidden = supportRemaining <= 0 || !started;
    if (paused) {
      text("pause-eyebrow", apiError ? "API CONNECTION PAUSED" : "SIMULATION PAUSED");
      text("pause-title", apiError ? "実APIを停止しました" : "一時停止");
      text("pause-detail", apiError || (pending ? "AIの応答を保持しています。再開後に行動を適用します。" : "サムも病院の時間も停止しています。"));
      ui("resume").hidden = Boolean(apiError); ui("retry").hidden = !apiError;
    }
    if (ended) {
      const won = state.status === "contained";
      text("result-label", won ? "CONTAINMENT SUCCESS" : "SUBJECT ESCAPED");
      text("result-title", won ? "病院が、勝った。" : "サムは、生還した。");
      text("result-copy", state.outcome || (won ? "サムの脱出を阻止しました。" : "サムはキーカードと電源を確保し、避難口から脱出しました。"));
      text("result-stats", `経過 ${clock(state.elapsed)}　恐怖 ${Math.round(state.fear)}　干渉 ${state.interventions}回`);
    }
  }

  listen(ui("start-silent"), "click", () => start(false)); listen(ui("start-sound"), "click", () => start(true));
  listen(ui("check-api"), "click", () => { void checkApi(); });
  listen(ui("sound"), "click", () => { void setSound(!soundOn); });
  listen(ui("recenter"), "click", () => { look = { yaw: 0, pitch: 0 }; renderer.recenter(); });
  listen(ui("map-toggle"), "click", () => togglePanel("map")); listen(ui("map-close"), "click", () => togglePanel("map", false));
  listen(ui("help-toggle"), "click", () => togglePanel("help"));
  listen(ui("pause"), "click", () => pauseToggle()); listen(ui("resume"), "click", () => pauseToggle());
  listen(ui("reset"), "click", reset); listen(ui("result-reset"), "click", reset); listen(ui("retry"), "click", retry);
  listen(ui("replay"), "click", () => { const mode = state.controller, sound = soundOn; reset(); ui<HTMLSelectElement>("controller").value = mode; start(sound); });
  listen(ui("follow"), "click", () => { followSam = true; render(); });
  for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-room]")) listen(button, "click", () => { selected = button.dataset.room as RoomId; followSam = false; render(); });
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-intervention]")) listen(button, "click", () => interfere(button.dataset.intervention as SabotageType));
  listen(window, "keydown", event => {
    const e = event as KeyboardEvent;
    const target = e.target as HTMLElement | null;
    if (e.altKey || e.ctrlKey || e.metaKey || target?.matches("input,select,textarea,[contenteditable=true]")) return;
    if (e.code.startsWith("Arrow")) { if (started && target?.tagName !== "CANVAS") { e.preventDefault(); lookKeys.add(e.code); } return; }
    if (e.repeat) return;
    if (e.code === "Escape") { pauseToggle(true); return; }
    if (e.code === "Space") { if (target?.closest("button,a,summary")) return; e.preventDefault(); if (started) pauseToggle(); return; }
    if (e.code === "KeyR") { reset(); return; }
    const index = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
    if (index >= 0) { e.preventDefault(); interfere(interventions[index].type); }
  });
  listen(window, "keyup", event => { lookKeys.delete((event as KeyboardEvent).code); });
  listen(window, "blur", () => { lookKeys.clear(); if (started && state.status === "running") { state.paused = true; render(); } });
  listen(document, "visibilitychange", () => { if (document.hidden && started && state.status === "running") { state.paused = true; lookKeys.clear(); render(); } });

  let last = performance.now(), lastRender = 0, frameId = 0;
  function frame(now: number) {
    if (disposed) return;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
    const statusBefore = state.status, supportsBefore = state.tibo.appearances, encountersBefore = state.killer.encounterCount;
    applyPending();
    if (canAdvance()) {
      tick(state, dt);
      if (supportRemaining > 0) supportRemaining = Math.max(0, supportRemaining - dt);
      if (noticeRemaining > 0) { noticeRemaining -= dt; if (noticeRemaining <= 0) text("notice", "ドラッグで見回す / 1–4で干渉 / Spaceで停止"); }
    }
    if (state.tibo.appearances > supportsBefore) { supportRemaining = 6; notice("Tiboが全干渉の待機時間とエネルギーを回復しました。", 6); }
    if (state.killer.encounterCount > encountersBefore) notice(`接触！ 恐怖 ${Math.round(state.fear)} / 100。サムは逃走を続けます。`, 5);
    if (statusBefore === "running" && state.status !== "running") { releaseSession(); render(); }
    if (started && !state.paused && !document.hidden) {
      look.yaw += ((lookKeys.has("ArrowLeft") ? 1 : 0) - (lookKeys.has("ArrowRight") ? 1 : 0)) * dt;
      look.pitch = Math.max(-1, Math.min(1, look.pitch + ((lookKeys.has("ArrowUp") ? 1 : 0) - (lookKeys.has("ArrowDown") ? 1 : 0)) * dt));
    }
    if (!document.hidden) renderer.update(state, canAdvance() ? dt : 0, look, targetRoom());
    audio.update(state, canAdvance(), started && state.status === "running" && !state.paused && !document.hidden);
    if (now - lastRender > 100) { render(); lastRender = now; }
    if (state.controller === "api" && !apiError) void nextDecision();
    frameId = requestAnimationFrame(frame);
  }
  render(); renderer.update(state, 0, look, selected); frameId = requestAnimationFrame(frame);
  return () => {
    if (disposed) return;
    disposed = true; generation++; soundRevision++; events.abort(); cancelAnimationFrame(frameId);
    releaseSession(); pending = null; lookKeys.clear(); audio.dispose(); renderer.dispose();
    root.replaceChildren(); root.classList.remove("blacksite3d", "b3-is-playing", "b3-is-paused", "b3-danger");
  };
}
