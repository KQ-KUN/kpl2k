import type { Difficulty, Feedback, GuessResult, QuizPlayer } from "./types.ts";


export const MAX_GUESSES = 8;

// 按已收录小局数分档，不将历史数据缺口当作零出场。
export function appearanceBand(totalGames: number): number | null {
  if (!Number.isInteger(totalGames) || totalGames <= 0) return null;
  if (totalGames <= 100) return 0;
  if (totalGames <= 300) return 1;
  if (totalGames <= 600) return 2;
  return 3;
}

export function appearanceLabel(totalGames: number): string {
  const band = appearanceBand(totalGames);
  return band === null ? "暂无记录" : ["1–100局", "101–300局", "301–600局", "601局以上"][band]!;
}


function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}


function setFeedback(guess: string[], target: string[]): Feedback {
  if (sameSet(guess, target)) return "exact";
  return guess.some((value) => target.includes(value)) ? "partial" : "miss";
}


function numberFeedback(guess: number | null | undefined, target: number | null | undefined): Feedback {
  if (guess == null || target == null) return "unknown";
  if (guess === target) return "exact";
  return target > guess ? "higher" : "lower";
}


export function comparePlayers(guess: QuizPlayer, target: QuizPlayer): GuessResult {
  const latestTeam =
    guess.latestTeamId === target.latestTeamId
      ? "exact"
      // 当前格展示的是猜测选手的最近战队，只问答案选手是否曾效力该队。
      : target.teamHistory.includes(guess.latestTeamId)
        ? "partial"
        : "miss";

  return {
    playerId: guess.id,
    positions: setFeedback(guess.positions, target.positions),
    latestTeam,
    debutYear: numberFeedback(guess.debutYear, target.debutYear),
    latestYear: numberFeedback(guess.latestYear, target.latestYear),
    hasFmvp: guess.hasFmvp === target.hasFmvp ? "exact" : "miss",
    championshipCount: numberFeedback(guess.championshipCount, target.championshipCount),
    eventCount: numberFeedback(guess.eventCount, target.eventCount),
    appearances: numberFeedback(appearanceBand(guess.totalGames), appearanceBand(target.totalGames)),
    formalTeamCount: numberFeedback(guess.formalTeamCount, target.formalTeamCount),
    isCorrect: guess.id === target.id,
  };
}

// 只比较玩家看到的线索；未知字段不成为隐藏的排除条件。
export function isAcceptedGuess(guess: QuizPlayer, target: QuizPlayer): boolean {
  const { isCorrect, playerId: _playerId, ...feedback } = comparePlayers(guess, target);
  return isCorrect || Object.values(feedback).every((value) => value === "exact" || value === "unknown");
}


export function isClassicEligible(player: QuizPlayer): boolean {
  return player.difficulty.includes("hardcore");
}

export function playersForDifficulty(players: QuizPlayer[], difficulty: Difficulty): QuizPlayer[] {
  return players.filter((player) => isClassicEligible(player) && player.difficulty.includes(difficulty));
}


export function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase("zh-CN");
}


function searchKey(value: string): string {
  return normalizeSearch(value).replace(/\s+/g, "");
}


export function searchPlayers(players: QuizPlayer[], query: string, limit = 8): QuizPlayer[] {
  const needle = searchKey(query);
  if (!needle) return [];
  return players
    .filter((player) =>
      isClassicEligible(player) && [player.nickname, ...player.aliases].some((value) => searchKey(value).includes(needle)),
    )
    .sort((left, right) => {
      const leftPrefix = searchKey(left.nickname).startsWith(needle) ? 0 : 1;
      const rightPrefix = searchKey(right.nickname).startsWith(needle) ? 0 : 1;
      return leftPrefix - rightPrefix || left.nickname.localeCompare(right.nickname, "zh-CN");
    })
    .slice(0, limit);
}


export function randomTargetId(players: QuizPlayer[], difficulty: Difficulty): string {
  const pool = playersForDifficulty(players, difficulty);
  if (!pool.length) throw new Error(`难度池为空：${difficulty}`);
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const value = random[0];
  if (value === undefined) throw new Error("随机数生成失败");
  const target = pool[value % pool.length];
  if (!target) throw new Error("随机题生成失败");
  return target.id;
}


export function feedbackSymbol(feedback: Feedback): string {
  if (feedback === "unknown") return "—";
  if (feedback === "exact") return "✓";
  if (feedback === "partial") return "≈";
  if (feedback === "higher") return "↑";
  if (feedback === "lower") return "↓";
  return "×";
}
