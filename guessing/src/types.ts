export const DIFFICULTIES = ["popular", "normal", "hardcore"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export type GameMode = "classic";
export type Feedback = "exact" | "partial" | "miss" | "higher" | "lower";

export interface QuizPlayer {
  id: string;
  nickname: string;
  aliases: string[];
  iconUrl: string;
  positions: string[];
  latestTeamId: string;
  latestTeamName: string;
  teamHistory: string[];
  teamHistoryNames: string[];
  debutYear: number;
  latestYear: number;
  hasFmvp: boolean;
  championshipCount: number;
  totalGames: number;
  peakRating: number;
  active: boolean;
  difficulty: Difficulty[];
}

export interface QuizData {
  schemaVersion: number;
  dataVersion: string;
  sourceCommit: string;
  playersHash: string;
  players: QuizPlayer[];
}

export interface GuessResult {
  playerId: string;
  positions: Feedback;
  latestTeam: Feedback;
  debutYear: Feedback;
  latestYear: Feedback;
  hasFmvp: Feedback;
  championshipCount: Feedback;
  active: Feedback;
  isCorrect: boolean;
}

export interface StoredGame {
  storageVersion: 3;
  mode: GameMode;
  difficulty: Difficulty;
  dataVersion: string;
  targetId: string;
  guesses: string[];
  finished: boolean;
  won: boolean;
  recorded: boolean;
}

export interface Stats {
  storageVersion: 1;
  games: number;
  wins: number;
  totalWinningGuesses: number;
}

export interface LibraryVersion {
  year: number;
  season_label: string;
  team: string;
  position: string;
  rating: number;
  peak: boolean;
  games: number;
  win_rate: number;
  kda: number;
  kills: number;
  assists: number;
  gpm: number;
  participation: number;
  hurt_rate: number;
  be_hurt_rate: number;
  damage_convert: number;
  towers: number;
  mvp_count: number;
  mvp_per_game: number;
  heroes: string[];
}

export interface LibraryPlayer {
  id: string;
  name: string;
  icon: string;
  positions: string[];
  legend: boolean;
  peak_rating: number;
  version_count: number;
  team: string;
  active: boolean;
  current_team: string | null;
  last_order: number;
  mvp_total: number;
  versions: LibraryVersion[];
}

export interface LibraryData {
  schema_version: string;
  data_version: string;
  players: LibraryPlayer[];
}
