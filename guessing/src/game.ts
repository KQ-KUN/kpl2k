import type { Difficulty, Feedback, GuessResult, QuizPlayer } from "./types.ts";


export const MAX_GUESSES = 8;


function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}


function setFeedback(guess: string[], target: string[]): Feedback {
  if (sameSet(guess, target)) return "exact";
  return guess.some((value) => target.includes(value)) ? "partial" : "miss";
}


function numberFeedback(guess: number, target: number): Feedback {
  if (guess === target) return "exact";
  return target > guess ? "higher" : "lower";
}


export function comparePlayers(guess: QuizPlayer, target: QuizPlayer): GuessResult {
  const latestTeam =
    guess.latestTeamId === target.latestTeamId
      ? "exact"
      : guess.teamHistory.some((team) => target.teamHistory.includes(team))
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
    active: guess.active === target.active ? "exact" : "miss",
    isCorrect: guess.id === target.id,
  };
}


export function playersForDifficulty(players: QuizPlayer[], difficulty: Difficulty): QuizPlayer[] {
  return players.filter((player) => player.difficulty.includes(difficulty));
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
      [player.nickname, ...player.aliases].some((value) => searchKey(value).includes(needle)),
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
  if (feedback === "exact") return "✓";
  if (feedback === "partial") return "≈";
  if (feedback === "higher") return "↑";
  if (feedback === "lower") return "↓";
  return "×";
}
