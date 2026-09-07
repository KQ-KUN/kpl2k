import type { LibraryPlayer, QuizPlayer } from "./types.ts";

export function findLibraryPlayer(players: LibraryPlayer[], player: QuizPlayer): LibraryPlayer | undefined {
  const matches = players.filter((entry) => entry.id === player.id || entry.id.startsWith(`${player.id}@`));
  return matches.find((entry) => entry.id === `${player.id}@${player.latestTeamId}`) ?? matches[0];
}

export function libraryPlayerId(hash: string): string | null {
  if (!hash.startsWith("#library?")) return null;
  return new URLSearchParams(hash.slice(hash.indexOf("?") + 1)).get("player");
}
