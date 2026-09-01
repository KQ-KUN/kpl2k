import "./styles.css";

import {
  MAX_GUESSES,
  comparePlayers,
  feedbackSymbol,
  normalizeSearch,
  playersForDifficulty,
  randomTargetId,
  searchPlayers,
} from "./game.ts";
import {
  buildGeniusPeople,
  buildGeniusQuestions,
  rankGeniusPeople,
  selectGeniusQuestion,
  shouldGuessGeniusPerson,
} from "./genius.ts";
import type {
  GeniusAnswer,
  GeniusPerson,
  GeniusQuestion,
  GeniusResponse,
  RankedPerson,
} from "./genius.ts";
import type {
  Difficulty,
  Feedback,
  GameMode,
  GuessResult,
  LibraryData,
  LibraryPlayer,
  LibraryVersion,
  QuizData,
  QuizPlayer,
  Stats,
  StoredGame,
} from "./types.ts";


const STORAGE_PREFIX = "kpl-friberg-v2";
type AppView = "home" | "classic" | "genius" | "library";
type Theme = "dark" | "light";
type GeniusMascotVariant = "female" | "male";
type GeniusMascotPose = "thinking" | "reveal";

function appAssetUrl(url: string): string {
  return url.startsWith("/assets/") ? `.${url}` : url;
}
const THEME_KEY = `${STORAGE_PREFIX}:theme`;

const required = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) throw new Error(`页面缺少元素：#${id}`);
  return element as T;
};

const difficultyControl = required<HTMLDivElement>("difficulty-control");
const revealAnswerButton = required<HTMLButtonElement>("reveal-answer");
const roundLabel = required<HTMLSpanElement>("round-label");
const remainingLabel = required<HTMLElement>("remaining-label");
const statsSummary = required<HTMLDivElement>("stats-summary");
const guessForm = required<HTMLFormElement>("guess-form");
const guessInput = required<HTMLInputElement>("guess-input");
const submitButton = required<HTMLButtonElement>("submit-button");
const suggestionsElement = required<HTMLDivElement>("suggestions");
const formMessage = required<HTMLParagraphElement>("form-message");
const guessDock = required<HTMLDivElement>("guess-dock");
const guessProgress = required<HTMLSpanElement>("guess-progress");
const emptyState = required<HTMLElement>("empty-state");
const boardHeader = required<HTMLDivElement>("board-header");
const board = required<HTMLElement>("board");
const resultPanel = required<HTMLElement>("result-panel");
const rulesDialog = required<HTMLDialogElement>("rules-dialog");
const homeView = required<HTMLElement>("home-view");
const classicView = required<HTMLElement>("classic-view");
const geniusView = required<HTMLElement>("genius-view");
const geniusRoot = required<HTMLDivElement>("genius-root");
const libraryView = required<HTMLElement>("library-view");
const libraryMeta = required<HTMLParagraphElement>("library-meta");
const libraryQuery = required<HTMLInputElement>("library-query");
const libraryTeam = required<HTMLSelectElement>("library-team");
const libraryPosition = required<HTMLSelectElement>("library-position");
const librarySort = required<HTMLSelectElement>("library-sort");
const libraryList = required<HTMLDivElement>("library-list");
const themeToggle = required<HTMLButtonElement>("theme-toggle");

let data: QuizData;
let libraryData: LibraryData;
let playerById = new Map<string, QuizPlayer>();
let game: StoredGame;
let currentView: AppView = "home";
let appReady = false;
const mode: GameMode = "classic";
let difficulty: Difficulty = "popular";
let selectedPlayerId = "";
let suggestionIndex = -1;
let visibleSuggestions: QuizPlayer[] = [];
let loadSequence = 0;
let geniusPeople: GeniusPerson[] = [];
const geniusQuestions = buildGeniusQuestions();
let geniusResponses: GeniusResponse[] = [];
let geniusExcludedIds = new Set<string>();
let geniusQuestion: GeniusQuestion | null = null;
let geniusGuess: RankedPerson | null = null;
let geniusStarted = false;
let geniusFinished = false;
let geniusMascotVariant: GeniusMascotVariant | null = null;


function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // System preference remains available when storage is blocked.
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}


function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const nextTheme = theme === "dark" ? "light" : "dark";
  themeToggle.setAttribute("aria-label", `切换${nextTheme === "light" ? "浅色" : "深色"}模式`);
  const icon = themeToggle.querySelector("span");
  const label = themeToggle.querySelector<HTMLElement>(".theme-label");
  if (icon) icon.textContent = nextTheme === "light" ? "☀" : "◐";
  if (label) label.textContent = nextTheme === "light" ? "浅色" : "深色";
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
    "content",
    theme === "dark" ? "#080d1b" : "#f3f6fb",
  );
}


applyTheme(initialTheme());


function isQuizData(value: unknown): value is QuizData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<QuizData>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.dataVersion === "string" &&
    typeof candidate.sourceCommit === "string" &&
    Array.isArray(candidate.players) &&
    candidate.players.length > 0
  );
}


function isLibraryData(value: unknown): value is LibraryData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LibraryData>;
  return (
    typeof candidate.schema_version === "string" &&
    typeof candidate.data_version === "string" &&
    Array.isArray(candidate.players) &&
    candidate.players.length > 0
  );
}


function viewFromHash(): AppView {
  if (location.hash === "#classic") return "classic";
  if (location.hash === "#genius") return "genius";
  if (location.hash === "#library") return "library";
  return "home";
}


function showView(): void {
  currentView = viewFromHash();
  homeView.hidden = currentView !== "home";
  classicView.hidden = currentView !== "classic";
  geniusView.hidden = currentView !== "genius";
  libraryView.hidden = currentView !== "library";
  guessDock.hidden = !appReady || currentView !== "classic" || game.finished;
  if (appReady && currentView === "genius") renderGenius();
  if (appReady && currentView === "library") renderLibrary();
  window.scrollTo({ top: 0, behavior: "auto" });
}


function storageKey(selectedMode = mode, selectedDifficulty = difficulty): string {
  return `${STORAGE_PREFIX}:game:${selectedMode}:${selectedDifficulty}`;
}


function loadStoredGame(): StoredGame | null {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredGame>;
    if (
      value.storageVersion !== 3 ||
      value.mode !== mode ||
      value.difficulty !== difficulty ||
      value.dataVersion !== data.dataVersion ||
      typeof value.targetId !== "string" ||
      !playerById.has(value.targetId) ||
      !Array.isArray(value.guesses) ||
      value.guesses.length > MAX_GUESSES ||
      new Set(value.guesses).size !== value.guesses.length ||
      !value.guesses.every((id) => typeof id === "string" && playerById.has(id)) ||
      typeof value.finished !== "boolean" ||
      typeof value.won !== "boolean" ||
      typeof value.recorded !== "boolean" ||
      !playerById.get(value.targetId)?.difficulty.includes(difficulty)
    ) {
      return null;
    }
    return value as StoredGame;
  } catch {
    return null;
  }
}


function saveGame(): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(game));
  } catch {
    formMessage.textContent = "浏览器无法保存进度，本局仍可继续。";
  }
}


function defaultStats(): Stats {
  return {
    storageVersion: 1,
    games: 0,
    wins: 0,
    totalWinningGuesses: 0,
  };
}


function loadStats(): Stats {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}:stats`);
    if (!raw) return defaultStats();
    const value = JSON.parse(raw) as Partial<Stats>;
    if (
      value.storageVersion !== 1 ||
      typeof value.games !== "number" ||
      typeof value.wins !== "number" ||
      typeof value.totalWinningGuesses !== "number"
    ) {
      return defaultStats();
    }
    return value as Stats;
  } catch {
    return defaultStats();
  }
}


function recordFinishedGame(): void {
  if (!game.finished || game.recorded) return;
  const stats = loadStats();
  stats.games += 1;
  if (game.won) {
    stats.wins += 1;
    stats.totalWinningGuesses += game.guesses.length;
  }
  try {
    localStorage.setItem(`${STORAGE_PREFIX}:stats`, JSON.stringify(stats));
  } catch {
    // The current game remains valid even when aggregate stats cannot persist.
  }
  game.recorded = true;
  saveGame();
}


async function createGame(): Promise<StoredGame> {
  const targetId = randomTargetId(data.players, difficulty);
  return {
    storageVersion: 3,
    mode,
    difficulty,
    dataVersion: data.dataVersion,
    targetId,
    guesses: [],
    finished: false,
    won: false,
    recorded: false,
  };
}


async function loadGame(forceNew = false): Promise<void> {
  const sequence = ++loadSequence;
  setFormEnabled(false);
  const stored = forceNew ? null : loadStoredGame();
  const nextGame = stored ?? (await createGame());
  if (sequence !== loadSequence) return;
  game = nextGame;
  if (!stored) saveGame();
  selectedPlayerId = "";
  guessInput.value = "";
  formMessage.textContent = "";
  closeSuggestions();
  render();
}


function setFormEnabled(enabled: boolean): void {
  guessInput.disabled = !enabled;
  submitButton.disabled = !enabled;
}


function createAvatar(player: QuizPlayer, large = false): HTMLSpanElement {
  const wrapper = document.createElement("span");
  wrapper.className = `avatar${large ? " large" : ""}`;
  const fallback = player.nickname.slice(0, 1).toUpperCase();
  wrapper.textContent = fallback;
  if (player.iconUrl) {
    wrapper.textContent = "";
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.src = appAssetUrl(player.iconUrl);
    image.addEventListener("error", () => {
      image.remove();
      wrapper.textContent = fallback;
    }, { once: true });
    wrapper.append(image);
  }
  return wrapper;
}


function createGeniusAvatar(person: GeniusPerson): HTMLSpanElement {
  const avatar = document.createElement("span");
  avatar.className = "genius-avatar";
  const fallback = person.name.slice(0, 1).toUpperCase();
  avatar.textContent = fallback;
  if (person.iconUrl) {
    avatar.textContent = "";
    const image = document.createElement("img");
    image.alt = "";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.src = appAssetUrl(person.iconUrl);
    image.style.objectPosition = person.iconPosition;
    image.addEventListener("error", () => {
      image.remove();
      avatar.textContent = fallback;
    }, { once: true });
    avatar.append(image);
  }
  return avatar;
}


function createGeniusMascot(
  pose: GeniusMascotPose,
  variant: GeniusMascotVariant = geniusMascotVariant ?? "female",
): HTMLImageElement {
  const image = document.createElement("img");
  image.className = `genius-character ${variant}`;
  image.alt = "";
  image.decoding = "async";
  image.src = appAssetUrl(`/assets/genius-mascot/${variant}-${pose}.webp`);
  image.setAttribute("aria-hidden", "true");
  return image;
}


function geniusRanking(): RankedPerson[] {
  return rankGeniusPeople(geniusPeople, geniusQuestions, geniusResponses, geniusExcludedIds);
}


function resetGenius(started = true): void {
  geniusResponses = [];
  geniusExcludedIds = new Set();
  geniusGuess = null;
  geniusFinished = false;
  geniusStarted = started;
  if (!started) geniusMascotVariant = null;
  const ranking = geniusRanking();
  geniusQuestion = started ? selectGeniusQuestion(geniusQuestions, ranking, new Set()) : null;
  renderGenius();
}


function advanceGenius(): void {
  const ranking = geniusRanking();
  const leader = ranking[0] ?? null;
  const asked = new Set(geniusResponses.map((response) => response.questionId));
  if (leader && shouldGuessGeniusPerson(ranking, geniusResponses.length)) {
    geniusQuestion = null;
    geniusGuess = leader;
    renderGenius();
    return;
  }
  geniusQuestion = selectGeniusQuestion(geniusQuestions, ranking, asked);
  geniusGuess = geniusQuestion ? null : leader;
  renderGenius();
}


function answerGenius(answer: GeniusAnswer): void {
  if (!geniusQuestion || geniusFinished) return;
  geniusResponses.push({ questionId: geniusQuestion.id, answer });
  geniusQuestion = null;
  advanceGenius();
}


function rejectGeniusGuess(): void {
  if (!geniusGuess) return;
  geniusExcludedIds.add(geniusGuess.person.id);
  geniusGuess = null;
  const ranking = geniusRanking();
  const asked = new Set(geniusResponses.map((response) => response.questionId));
  geniusQuestion = selectGeniusQuestion(geniusQuestions, ranking, asked);
  if (!geniusQuestion) geniusGuess = ranking[0] ?? null;
  renderGenius();
}


function geniusRoleText(person: GeniusPerson): string {
  const labels: Record<GeniusPerson["roles"][number], string> = {
    player: "职业选手",
    coach: "教练",
    commentator: "官方解说",
  };
  return person.roles.map((role) => labels[role]).join(" · ");
}


function createGeniusResetButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "genius-reset";
  button.type = "button";
  button.textContent = "重新开始";
  button.addEventListener("click", () => resetGenius(false));
  return button;
}


function renderGeniusIntro(): void {
  const panel = document.createElement("section");
  panel.className = "genius-panel genius-intro";
  const eyebrow = document.createElement("p");
  eyebrow.className = "genius-kicker";
  eyebrow.textContent = "开始前";
  const title = document.createElement("h2");
  title.textContent = "选择你的猜谜助手";
  const picker = document.createElement("div");
  picker.className = "genius-mascot-picker";
  picker.setAttribute("role", "radiogroup");
  picker.setAttribute("aria-label", "选择猜谜助手");
  const choices: Array<[GeniusMascotVariant, string]> = [
    ["female", "选择女性角色"],
    ["male", "选择男性角色"],
  ];
  for (const [variant, ariaLabel] of choices) {
    const choice = document.createElement("button");
    choice.className = "genius-mascot-choice";
    choice.type = "button";
    choice.dataset.variant = variant;
    choice.setAttribute("role", "radio");
    choice.setAttribute("aria-checked", String(geniusMascotVariant === variant));
    choice.setAttribute("aria-label", ariaLabel);
    const check = document.createElement("i");
    check.textContent = "✓";
    check.setAttribute("aria-hidden", "true");
    choice.append(createGeniusMascot("thinking", variant), check);
    picker.append(choice);
  }
  const start = document.createElement("button");
  start.className = "genius-start";
  start.type = "button";
  start.disabled = geniusMascotVariant === null;
  start.textContent = "开始提问";
  picker.addEventListener("click", (event) => {
    const choice = (event.target as HTMLElement).closest<HTMLButtonElement>(".genius-mascot-choice");
    const variant = choice?.dataset.variant;
    if (variant !== "female" && variant !== "male") return;
    geniusMascotVariant = variant;
    for (const button of picker.querySelectorAll<HTMLButtonElement>(".genius-mascot-choice")) {
      const selected = button.dataset.variant === variant;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", String(selected));
    }
    start.disabled = false;
  });
  start.addEventListener("click", () => {
    if (geniusMascotVariant) resetGenius(true);
  });
  panel.append(eyebrow, title, picker, start);
  geniusRoot.append(panel);
}


function renderGeniusQuestion(): void {
  if (!geniusQuestion) return;
  const panel = document.createElement("section");
  panel.className = "genius-panel genius-question-panel";
  const top = document.createElement("div");
  top.className = "genius-topline";
  const count = document.createElement("span");
  count.textContent = `问题 ${geniusResponses.length + 1}`;
  const category = document.createElement("span");
  category.className = "genius-category";
  category.textContent = geniusQuestion.category;
  top.append(count, category, createGeniusResetButton());
  const progress = document.createElement("span");
  progress.className = "genius-progress";
  const progressFill = document.createElement("i");
  progressFill.style.width = `${Math.min(((geniusResponses.length + 1) / geniusQuestions.length) * 100, 100)}%`;
  progress.append(progressFill);
  const stage = document.createElement("div");
  stage.className = "genius-question-stage";
  const prompt = document.createElement("h2");
  prompt.textContent = geniusQuestion.text;
  stage.append(createGeniusMascot("thinking"), prompt);
  const answers = document.createElement("div");
  answers.className = "genius-answers";
  const labels: Array<[GeniusAnswer, string]> = [
    ["probably_yes", "可能是"],
    ["unknown", "不知道"],
    ["probably_no", "可能不是"],
    ["yes", "是"],
    ["no", "不是"],
  ];
  for (const [value, label] of labels) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.answer = value;
    button.textContent = label;
    button.addEventListener("click", () => answerGenius(value));
    answers.append(button);
  }
  const hint = document.createElement("p");
  hint.className = "genius-hint";
  hint.textContent = "拿不准时请选择“不知道”，这不会排除任何人物。";
  panel.append(top, progress, stage, answers, hint);
  geniusRoot.append(panel);
}


function renderGeniusGuess(): void {
  if (!geniusGuess) return;
  const person = geniusGuess.person;
  const panel = document.createElement("section");
  panel.className = "genius-panel genius-guess-panel";
  const kicker = document.createElement("p");
  kicker.className = "genius-kicker";
  kicker.textContent = geniusFinished ? "读心成功" : "我想到了";
  const visual = document.createElement("div");
  visual.className = "genius-result-visual";
  visual.append(createGeniusMascot("reveal"), createGeniusAvatar(person));
  panel.append(kicker, visual);
  const title = document.createElement("h2");
  title.textContent = person.name;
  const detail = document.createElement("p");
  detail.textContent = `${geniusRoleText(person)}${!person.roles.includes("coach") && person.teams[0] ? ` · ${person.teams[0]}` : ""}`;
  panel.append(title, detail);
  const summary = document.createElement("p");
  summary.className = "genius-summary";
  summary.textContent = `我猜：你想的人物就是 ${person.name}。`;
  panel.append(summary);
  const actions = document.createElement("div");
  actions.className = "genius-guess-actions";
  if (geniusFinished) {
    const restart = document.createElement("button");
    restart.className = "genius-start";
    restart.type = "button";
    restart.textContent = "再想一个人物";
    restart.addEventListener("click", () => resetGenius(true));
    actions.append(restart);
  } else {
    const correct = document.createElement("button");
    correct.className = "genius-correct";
    correct.type = "button";
    correct.textContent = "就是他";
    correct.addEventListener("click", () => {
      geniusFinished = true;
      renderGenius();
    });
    const wrong = document.createElement("button");
    wrong.className = "genius-wrong";
    wrong.type = "button";
    wrong.textContent = "不是他，继续问";
    wrong.addEventListener("click", rejectGeniusGuess);
    actions.append(correct, wrong);
  }
  panel.append(actions);
  geniusRoot.append(panel);
}


function renderGenius(): void {
  geniusRoot.replaceChildren();
  if (!geniusStarted) {
    renderGeniusIntro();
  } else if (geniusGuess) {
    renderGeniusGuess();
  } else {
    renderGeniusQuestion();
  }
  if (currentView === "genius") {
    requestAnimationFrame(() => geniusRoot.scrollIntoView({ block: "start", behavior: "auto" }));
  }
}


function createLibraryAvatar(player: LibraryPlayer): HTMLSpanElement {
  const avatar = document.createElement("span");
  avatar.className = "library-avatar";
  const fallback = player.name.slice(0, 1).toUpperCase();
  avatar.textContent = fallback;
  if (player.icon) {
    avatar.textContent = "";
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.src = appAssetUrl(player.icon);
    image.addEventListener("error", () => {
      image.remove();
      avatar.textContent = fallback;
    }, { once: true });
    avatar.append(image);
  }
  return avatar;
}


function formatStat(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}


function keyStats(version: LibraryVersion): string {
  if (version.position === "对抗路") {
    return `承伤 ${formatStat(version.be_hurt_rate, 0)}% · 输出 ${formatStat(version.hurt_rate, 0)}% · 推塔 ${formatStat(version.towers)}`;
  }
  if (version.position === "打野") {
    return `击杀 ${formatStat(version.kills)} · 参团 ${formatStat(version.participation, 0)}% · 经济 ${formatStat(version.gpm, 0)}`;
  }
  if (version.position === "中路") {
    return `输出 ${formatStat(version.hurt_rate, 0)}% · 转化 ${formatStat(version.damage_convert)} · 参团 ${formatStat(version.participation, 0)}%`;
  }
  if (version.position === "发育路") {
    return `KDA ${formatStat(version.kda)} · 输出 ${formatStat(version.hurt_rate, 0)}% · 经济 ${formatStat(version.gpm, 0)}`;
  }
  return `参团 ${formatStat(version.participation, 0)}% · 承伤 ${formatStat(version.be_hurt_rate, 0)}% · 助攻 ${formatStat(version.assists)}`;
}


function createLibraryCard(player: LibraryPlayer): HTMLElement {
  const card = document.createElement("article");
  card.className = "library-card-item";

  const summary = document.createElement("button");
  summary.className = "library-card-summary";
  summary.type = "button";
  summary.setAttribute("aria-expanded", "false");
  summary.append(createLibraryAvatar(player));

  const identity = document.createElement("span");
  const name = document.createElement("strong");
  name.className = "library-name";
  name.textContent = player.name;
  if (player.legend) {
    const legend = document.createElement("small");
    legend.className = "legend-badge";
    legend.textContent = "传奇";
    name.append(legend);
  }
  const team = document.createElement("span");
  team.className = "library-team-name";
  team.textContent = player.team;
  const status = document.createElement("span");
  status.className = `library-status${player.active || player.current_team ? "" : " retired"}`;
  status.textContent = player.active ? "现役" : player.current_team ? `现役 · ${player.current_team}` : "退役";
  identity.append(name, team, status);

  const toggle = document.createElement("span");
  toggle.className = "library-card-toggle";
  toggle.textContent = "查看";
  summary.append(identity, toggle);

  const peak = player.versions.find((version) => version.peak) ?? player.versions[0];
  const brief = document.createElement("div");
  brief.className = "library-brief";
  const briefValues = [
    `${player.version_count} 个版本`,
    `${player.mvp_total} 次 MVP`,
    peak ? keyStats(peak) : "暂无年度数据",
  ];
  for (const value of briefValues) {
    const pill = document.createElement("span");
    pill.className = "library-pill";
    pill.textContent = value;
    brief.append(pill);
  }

  const tags = document.createElement("div");
  tags.className = "library-tags";
  for (const position of player.positions) {
    const tag = document.createElement("span");
    tag.textContent = `# ${position}`;
    tags.append(tag);
  }

  const versions = document.createElement("div");
  versions.className = "library-versions";
  for (const version of [...player.versions].sort((left, right) => right.year - left.year)) {
    const item = document.createElement("section");
    item.className = "library-version";
    const head = document.createElement("div");
    head.className = "library-version-head";
    const label = document.createElement("span");
    label.textContent = `${version.season_label} · ${version.team} · ${version.position}`;
    const games = document.createElement("b");
    games.textContent = `${version.games} 场`;
    head.append(label, games);
    const stats = document.createElement("p");
    stats.className = "library-version-stats";
    stats.textContent = `${keyStats(version)} · 胜率 ${formatStat(version.win_rate * 100, 0)}% · ${version.games} 场${version.mvp_count ? ` · MVP ${version.mvp_count} 次` : ""}`;
    item.append(head, stats);
    if (version.heroes.length) {
      const heroes = document.createElement("p");
      heroes.className = "library-heroes";
      heroes.textContent = `英雄池：${version.heroes.slice(0, 12).join(" / ")}${version.heroes.length > 12 ? " …" : ""}`;
      item.append(heroes);
    }
    versions.append(item);
  }
  summary.addEventListener("click", () => {
    const open = card.classList.toggle("open");
    summary.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "收起" : "查看";
  });
  card.append(summary, brief, tags, versions);
  return card;
}


function renderLibrary(): void {
  const query = normalizeSearch(libraryQuery.value.trim());
  const team = libraryTeam.value;
  const position = libraryPosition.value;
  const sort = librarySort.value;
  const players = libraryData.players.filter(
    (player) =>
      (!query || normalizeSearch(player.name).includes(query)) &&
      (!team || player.team === team) &&
      (!position || player.positions.includes(position)),
  );
  players.sort((left, right) => {
    if (sort === "name") return left.name.localeCompare(right.name, "zh-CN");
    if (sort === "-mvp") return right.mvp_total - left.mvp_total;
    if (sort === "-recent") {
      const leftYear = Math.max(...left.versions.map((version) => version.year));
      const rightYear = Math.max(...right.versions.map((version) => version.year));
      return rightYear - leftYear || left.name.localeCompare(right.name, "zh-CN");
    }
    return Number(right.active) - Number(left.active) || left.name.localeCompare(right.name, "zh-CN");
  });

  const versionCount = libraryData.players.reduce((sum, player) => sum + player.version_count, 0);
  libraryMeta.textContent = `${libraryData.players.length} 位选手 · ${versionCount} 个年度版本 · 当前匹配 ${players.length} 人 · 数据与 KPL 2K 同源`;
  libraryList.replaceChildren();
  if (!players.length) {
    const empty = document.createElement("p");
    empty.className = "library-empty";
    empty.textContent = "没有匹配的选手";
    libraryList.append(empty);
    return;
  }
  const groups = new Map<string, LibraryPlayer[]>();
  for (const player of players) {
    const group = groups.get(player.team) ?? [];
    group.push(player);
    groups.set(player.team, group);
  }
  const teams = [...groups.entries()].sort(
    ([leftName, leftPlayers], [rightName, rightPlayers]) =>
      rightPlayers.length - leftPlayers.length || leftName.localeCompare(rightName, "zh-CN"),
  );
  for (const [teamName, teamPlayers] of teams) {
    const section = document.createElement("section");
    section.className = "library-team";
    const heading = document.createElement("h2");
    heading.className = "library-team-title";
    heading.textContent = teamName;
    const count = document.createElement("span");
    count.textContent = `${teamPlayers.length} 人`;
    heading.append(count);
    const cards = document.createElement("div");
    cards.className = "library-cards";
    for (const player of teamPlayers) cards.append(createLibraryCard(player));
    section.append(heading, cards);
    libraryList.append(section);
  }
}


function setupLibraryFilters(): void {
  const teams = [...new Set(libraryData.players.map((player) => player.team))].sort((left, right) =>
    left.localeCompare(right, "zh-CN"),
  );
  for (const team of teams) {
    const option = document.createElement("option");
    option.value = team;
    option.textContent = team;
    libraryTeam.append(option);
  }
}


function createPlayerCell(player: QuizPlayer): HTMLDivElement {
  const cell = document.createElement("div");
  cell.className = "player-cell";
  cell.append(createAvatar(player));
  const copy = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = player.nickname;
  const detail = document.createElement("small");
  detail.textContent = `${player.latestTeamName} · ${player.debutYear}–${player.latestYear}`;
  copy.append(name, detail);
  cell.append(copy);
  return cell;
}


function createFeedbackCell(label: string, value: string, feedback: Feedback): HTMLDivElement {
  const cell = document.createElement("div");
  cell.className = `feedback-cell ${feedback}`;
  cell.setAttribute("aria-label", `${label}：${value}，${feedbackSymbol(feedback)}`);
  const field = document.createElement("small");
  field.textContent = label;
  const content = document.createElement("strong");
  content.textContent = value;
  const symbol = document.createElement("em");
  symbol.textContent = feedbackSymbol(feedback);
  cell.append(field, content, symbol);
  return cell;
}


function resultFor(player: QuizPlayer, target: QuizPlayer): GuessResult {
  return comparePlayers(player, target);
}


function renderBoard(target: QuizPlayer): void {
  board.replaceChildren();
  for (const playerId of game.guesses) {
    const player = playerById.get(playerId);
    if (!player) continue;
    const result = resultFor(player, target);
    const row = document.createElement("article");
    row.className = "guess-row";
    row.append(
      createPlayerCell(player),
      createFeedbackCell("最近战队", player.latestTeamName, result.latestTeam),
      createFeedbackCell("位置", player.positions.join("/"), result.positions),
      createFeedbackCell("首秀", String(player.debutYear), result.debutYear),
      createFeedbackCell("最近登场", String(player.latestYear), result.latestYear),
      createFeedbackCell("冠军", String(player.championshipCount), result.championshipCount),
      createFeedbackCell("KPL FMVP", player.hasFmvp ? "拿过" : "未拿过", result.hasFmvp),
      createFeedbackCell("状态", player.active ? "现役" : "退役", result.active),
    );
    board.append(row);
  }
}


function renderProgress(): void {
  guessProgress.replaceChildren();
  for (let index = 0; index < MAX_GUESSES; index += 1) {
    const dot = document.createElement("i");
    if (index < game.guesses.length) dot.className = "used";
    guessProgress.append(dot);
  }
  guessProgress.setAttribute("aria-label", `已猜 ${game.guesses.length} 次，共 ${MAX_GUESSES} 次机会`);
}


function feedbackEmoji(feedback: Feedback): string {
  if (feedback === "exact") return "🟩";
  if (feedback === "partial") return "🟨";
  if (feedback === "higher") return "⬆️";
  if (feedback === "lower") return "⬇️";
  return "⬛";
}


function shareText(target: QuizPlayer): string {
  const rows = game.guesses.map((playerId) => {
    const player = playerById.get(playerId);
    if (!player) return "";
    const result = resultFor(player, target);
    return [
      result.latestTeam,
      result.positions,
      result.debutYear,
      result.latestYear,
      result.championshipCount,
      result.hasFmvp,
      result.active,
    ].map(feedbackEmoji).join("");
  });
  const score = game.won ? `${game.guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  return `KPL Guessing 弗一把 ${score}\n${rows.join("\n")}\n${location.origin}${location.pathname}`;
}


async function copyShare(target: QuizPlayer): Promise<void> {
  const text = shareText(target);
  try {
    await navigator.clipboard.writeText(text);
    formMessage.textContent = "战绩已复制，分享内容不含答案。";
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    formMessage.textContent = "战绩已复制，分享内容不含答案。";
  }
}


function renderResult(target: QuizPlayer): void {
  resultPanel.hidden = !game.finished;
  resultPanel.replaceChildren();
  if (!game.finished) return;

  const head = document.createElement("div");
  head.className = "result-head";
  head.append(createAvatar(target, true));
  const copy = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = game.won ? `${game.guesses.length} 次猜中 ${target.nickname}` : `答案是 ${target.nickname}`;
  const detail = document.createElement("p");
  detail.textContent = `${target.positions.join("/")} · ${target.latestTeamName} · ${target.debutYear}–${target.latestYear}`;
  copy.append(title, detail);
  head.append(copy);

  const actions = document.createElement("div");
  actions.className = "result-actions";
  const share = document.createElement("button");
  share.className = "secondary-button";
  share.type = "button";
  share.textContent = "复制无答案战绩";
  share.addEventListener("click", () => void copyShare(target));

  const next = document.createElement("button");
  next.className = "primary-button";
  next.type = "button";
  next.textContent = "再来一局";
  next.addEventListener("click", () => {
    void loadGame(true);
  });

  const library = document.createElement("a");
  library.className = "secondary-button";
  library.href = "#library";
  library.textContent = "去人物图鉴看详情";
  actions.append(share, next, library);
  resultPanel.append(head, actions);
}


function renderStats(): void {
  const stats = loadStats();
  const winRate = stats.games ? Math.round((stats.wins / stats.games) * 100) : 0;
  statsSummary.textContent = `${stats.wins} 胜 / ${stats.games} 局 · 胜率 ${winRate}%`;
}


function renderControls(): void {
  difficultyControl.querySelectorAll<HTMLButtonElement>("button[data-difficulty]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.difficulty === difficulty));
  });
}


function render(): void {
  const target = playerById.get(game.targetId);
  if (!target) throw new Error("当前题目的选手不存在");
  recordFinishedGame();
  renderControls();
  renderStats();
  renderBoard(target);
  renderProgress();
  renderResult(target);
  emptyState.hidden = game.guesses.length > 0;
  boardHeader.hidden = game.guesses.length === 0;
  guessDock.hidden = !appReady || currentView !== "classic" || game.finished;
  revealAnswerButton.hidden = game.finished;
  roundLabel.textContent = "弗一把";
  remainingLabel.textContent = game.finished
    ? game.won
      ? "挑战成功"
      : "本局结束"
    : `剩余 ${MAX_GUESSES - game.guesses.length} 次`;
  setFormEnabled(!game.finished);
}


function closeSuggestions(): void {
  visibleSuggestions = [];
  suggestionIndex = -1;
  suggestionsElement.hidden = true;
  suggestionsElement.replaceChildren();
  guessInput.setAttribute("aria-expanded", "false");
  guessInput.removeAttribute("aria-activedescendant");
}


function selectSuggestion(player: QuizPlayer): void {
  selectedPlayerId = player.id;
  guessInput.value = player.nickname;
  formMessage.textContent = `${player.latestTeamName} · ${player.positions.join("/")} · ${player.debutYear}–${player.latestYear}`;
  closeSuggestions();
}


function renderSuggestions(): void {
  const query = guessInput.value.trim();
  selectedPlayerId = "";
  suggestionIndex = -1;
  visibleSuggestions = searchPlayers(data.players, query).filter(
    (player) => !game.guesses.includes(player.id),
  );
  suggestionsElement.replaceChildren();
  if (!query || !visibleSuggestions.length || game.finished) {
    closeSuggestions();
    return;
  }
  for (const [index, player] of visibleSuggestions.entries()) {
    const option = document.createElement("button");
    option.id = `suggestion-${index}`;
    option.className = "suggestion";
    option.type = "button";
    option.role = "option";
    option.setAttribute("aria-selected", "false");
    option.append(createAvatar(player));
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = player.nickname;
    const detail = document.createElement("small");
    detail.textContent = `${player.latestTeamName} · ${player.positions.join("/")}`;
    copy.append(name, detail);
    const years = document.createElement("span");
    years.className = "years";
    years.textContent = `${player.debutYear}–${player.latestYear}`;
    option.append(copy, years);
    option.addEventListener("click", () => selectSuggestion(player));
    suggestionsElement.append(option);
  }
  suggestionsElement.hidden = false;
  guessInput.setAttribute("aria-expanded", "true");
}


function updateActiveSuggestion(): void {
  const options = suggestionsElement.querySelectorAll<HTMLButtonElement>(".suggestion");
  options.forEach((option, index) => {
    const active = index === suggestionIndex;
    option.classList.toggle("active", active);
    option.setAttribute("aria-selected", String(active));
  });
  const active = options[suggestionIndex];
  if (active) {
    guessInput.setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView({ block: "nearest" });
  } else {
    guessInput.removeAttribute("aria-activedescendant");
  }
}


function resolveTypedPlayer(): QuizPlayer | null {
  if (selectedPlayerId) return playerById.get(selectedPlayerId) ?? null;
  const needle = normalizeSearch(guessInput.value.trim()).replace(/\s+/g, "");
  const exact = data.players.filter((player) =>
    [player.nickname, ...player.aliases].some(
      (value) => normalizeSearch(value).replace(/\s+/g, "") === needle,
    ),
  );
  return exact.length === 1 ? (exact[0] ?? null) : null;
}


function submitGuess(): void {
  if (game.finished) return;
  const player = resolveTypedPlayer();
  if (!player) {
    formMessage.textContent = "请从候选列表选择一名明确的选手；同名选手不能只按昵称提交。";
    return;
  }
  if (game.guesses.includes(player.id)) {
    formMessage.textContent = "这名选手已经猜过，不会扣除次数。";
    return;
  }
  game.guesses.push(player.id);
  game.won = player.id === game.targetId;
  game.finished = game.won || game.guesses.length >= MAX_GUESSES;
  selectedPlayerId = "";
  guessInput.value = "";
  formMessage.textContent = "";
  closeSuggestions();
  saveGame();
  render();
  requestAnimationFrame(() => {
    if (game.finished) {
      resultPanel.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    guessInput.focus({ preventScroll: true });
    board.lastElementChild?.scrollIntoView({
      block: "end",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  });
}


function revealAnswer(): void {
  if (game.finished) return;
  game.finished = true;
  game.won = false;
  saveGame();
  render();
  requestAnimationFrame(() => {
    resultPanel.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  });
}


function saveSettings(): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}:settings`, JSON.stringify({ difficulty }));
  } catch {
    // Settings persistence is optional.
  }
}


function loadSettings(): void {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}:settings`);
    if (!raw) return;
    const settings = JSON.parse(raw) as { difficulty?: unknown };
    if (
      settings.difficulty === "popular" ||
      settings.difficulty === "normal" ||
      settings.difficulty === "hardcore"
    ) {
      difficulty = settings.difficulty;
    }
  } catch {
    // Invalid settings fall back to the popular pool.
  }
}


difficultyControl.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-difficulty]");
  const nextDifficulty = button?.dataset.difficulty;
  if (nextDifficulty !== "popular" && nextDifficulty !== "normal" && nextDifficulty !== "hardcore") return;
  difficulty = nextDifficulty;
  saveSettings();
  void loadGame();
});

guessInput.addEventListener("input", () => {
  formMessage.textContent = "";
  renderSuggestions();
});

guessInput.addEventListener("keydown", (event) => {
  if (suggestionsElement.hidden) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    suggestionIndex = Math.min(suggestionIndex + 1, visibleSuggestions.length - 1);
    updateActiveSuggestion();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    suggestionIndex = Math.max(suggestionIndex - 1, 0);
    updateActiveSuggestion();
  } else if (event.key === "Enter" && suggestionIndex >= 0) {
    event.preventDefault();
    const player = visibleSuggestions[suggestionIndex];
    if (player) selectSuggestion(player);
  } else if (event.key === "Escape") {
    closeSuggestions();
  }
});

guessForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitGuess();
});
revealAnswerButton.addEventListener("click", revealAnswer);

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Node)) return;
  if (!guessForm.contains(event.target)) closeSuggestions();
});

required<HTMLButtonElement>("rules-button").addEventListener("click", () => rulesDialog.showModal());
themeToggle.addEventListener("click", () => {
  const theme: Theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Theme still applies for the current page when storage is blocked.
  }
});
required<HTMLButtonElement>("close-rules").addEventListener("click", () => rulesDialog.close());
rulesDialog.addEventListener("click", (event) => {
  if (event.target === rulesDialog) rulesDialog.close();
});
for (const control of [libraryQuery, libraryTeam, libraryPosition, librarySort]) {
  control.addEventListener("input", () => renderLibrary());
}
window.addEventListener("hashchange", showView);


async function start(): Promise<void> {
  try {
    const [response, libraryResponse] = await Promise.all([
      fetch("./data/quiz_players.json", { cache: "no-cache" }),
      fetch("./data/player_library.json", { cache: "no-cache" }),
    ]);
    if (!response.ok) throw new Error(`题库请求失败：HTTP ${response.status}`);
    if (!libraryResponse.ok) throw new Error(`图鉴请求失败：HTTP ${libraryResponse.status}`);
    const value: unknown = await response.json();
    const libraryValue: unknown = await libraryResponse.json();
    if (!isQuizData(value)) throw new Error("题库格式不兼容");
    if (!isLibraryData(libraryValue)) throw new Error("图鉴格式不兼容");
    data = value;
    libraryData = libraryValue;
    playerById = new Map(data.players.map((player) => [player.id, player]));
    geniusPeople = buildGeniusPeople(data.players);
    setupLibraryFilters();
    loadSettings();
    currentView = viewFromHash();
    await loadGame();
    appReady = true;
    showView();
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    formMessage.textContent = `${message}。请刷新重试。`;
    setFormEnabled(false);
  }
}


void start();
