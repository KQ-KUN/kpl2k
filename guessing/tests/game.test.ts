import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  comparePlayers,
  playersForDifficulty,
  randomTargetId,
  searchPlayers,
} from "../src/game.ts";
import {
  buildGeniusPeople,
  buildGeniusQuestions,
  rankGeniusPeople,
  selectGeniusQuestion,
  shouldGuessGeniusPerson,
} from "../src/genius.ts";
import type { QuizData, QuizPlayer } from "../src/types.ts";


function player(overrides: Partial<QuizPlayer> = {}): QuizPlayer {
  return {
    id: "a",
    nickname: "Fly",
    aliases: ["fly"],
    iconUrl: "",
    positions: ["对抗路"],
    latestTeamId: "wolves",
    latestTeamName: "重庆狼队",
    teamHistory: ["qg", "wolves"],
    teamHistoryNames: ["QGhappy", "重庆狼队"],
    debutYear: 2017,
    latestYear: 2026,
    hasFmvp: true,
    championshipCount: 4,
    totalGames: 1000,
    peakRating: 95,
    active: true,
    difficulty: ["popular", "normal", "hardcore"],
    ...overrides,
  };
}


test("comparePlayers returns exact, partial and target-relative arrows", () => {
  const target = player();
  const guess = player({
    id: "b",
    nickname: "测试选手",
    positions: ["对抗路", "打野"],
    latestTeamId: "estar",
    teamHistory: ["qg", "estar"],
    debutYear: 2019,
    latestYear: 2025,
    hasFmvp: false,
    championshipCount: 2,
    active: false,
  });
  const result = comparePlayers(guess, target);
  assert.equal(result.positions, "partial");
  assert.equal(result.latestTeam, "partial");
  assert.equal(result.debutYear, "lower");
  assert.equal(result.latestYear, "higher");
  assert.equal(result.hasFmvp, "miss");
  assert.equal(result.championshipCount, "higher");
  assert.equal(result.active, "miss");
  assert.equal(result.isCorrect, false);
});


test("difficulty pools stay nested and search is nickname-aware", () => {
  const popular = player();
  const normal = player({ id: "b", nickname: "一诺", aliases: ["yinuo"], difficulty: ["normal", "hardcore"] });
  const hardcore = player({ id: "c", nickname: "梦岚", difficulty: ["hardcore"] });
  const players = [popular, normal, hardcore];
  assert.deepEqual(playersForDifficulty(players, "popular").map((item) => item.id), ["a"]);
  assert.equal(playersForDifficulty(players, "normal").length, 2);
  assert.equal(playersForDifficulty(players, "hardcore").length, 3);
  assert.equal(searchPlayers(players, "yi")[0]?.id, "b");
});


test("classic mode chooses from the selected difficulty pool", () => {
  const popular = player();
  const hardcore = player({ id: "b", nickname: "梦岚", difficulty: ["hardcore"] });
  assert.equal(randomTargetId([popular, hardcore], "popular"), popular.id);
});


test("historical career and finals-starter corrections stay intact", () => {
  const data = JSON.parse(
    readFileSync(new URL("../public/data/quiz_players.json", import.meta.url), "utf8"),
  ) as QuizData;
  const rosterData = JSON.parse(
    readFileSync(new URL("../config/championship_rosters.json", import.meta.url), "utf8"),
  ) as {
    events: Array<{ id: string; name: string; starters: string[] }>;
  };
  const byName = new Map(data.players.map((item) => [item.nickname, item]));

  assert.deepEqual(
    {
      debutYear: byName.get("一诺")?.debutYear,
      championshipCount: byName.get("一诺")?.championshipCount,
    },
    { debutYear: 2018, championshipCount: 7 },
  );
  assert.equal(byName.get("梦泪")?.championshipCount, 0);
  assert.equal(byName.get("钟意")?.championshipCount, 7);
  assert.equal(byName.get("钎城")?.debutYear, 2019);
  assert.equal(byName.get("无畏")?.debutYear, 2020);

  const kcc2024 = rosterData.events.find((event) => event.id === "KCC2024");
  assert.deepEqual(kcc2024?.starters, ["轩染", "钟意", "长生", "小俞", "大帅"]);
  assert.ok(rosterData.events.every((event) => event.starters.length === 5));
  assert.ok(rosterData.events.every((event) => !event.name.includes("KWC")));
});


test("network genius reuses the standard pool and keeps coaches and commentators", () => {
  const people = buildGeniusPeople([
    player({ difficulty: ["normal", "hardcore"] }),
    player({ id: "hard", nickname: "冷门选手", difficulty: ["hardcore"] }),
  ]);
  assert.ok(people.some((item) => item.name === "Fly"));
  assert.ok(!people.some((item) => item.name === "冷门选手"));
  assert.ok(people.some((item) => item.roles.includes("coach")));
  assert.ok(people.some((item) => item.roles.includes("commentator")));
});


test("network genius answers raise the matching person and avoid repeated questions", () => {
  const people = buildGeniusPeople([
    player({ difficulty: ["normal", "hardcore"] }),
    player({
      id: "b",
      nickname: "一诺",
      latestTeamId: "ag",
      latestTeamName: "成都AG超玩会",
      teamHistory: ["ag"],
      teamHistoryNames: ["成都AG超玩会"],
      positions: ["发育路"],
      debutYear: 2018,
      championshipCount: 7,
      difficulty: ["normal", "hardcore"],
    }),
  ]);
  const questions = buildGeniusQuestions();
  const responses = [
    { questionId: "role:player", answer: "yes" as const },
    { questionId: "team:成都AG超玩会", answer: "yes" as const },
    { questionId: "position:发育路", answer: "yes" as const },
    { questionId: "champion:5", answer: "yes" as const },
  ];
  const ranked = rankGeniusPeople(people, questions, responses);
  assert.equal(ranked[0]?.person.name, "一诺");
  const asked = new Set(responses.map((response) => response.questionId));
  const next = selectGeniusQuestion(questions, ranked, asked);
  assert.ok(next === null || !asked.has(next.id));
});


test("network genius makes an early guess and falls back by question 12", () => {
  const people = buildGeniusPeople([]);
  const leader = people[0];
  const runnerUp = people[1];
  assert.ok(leader && runnerUp);

  const confidentRanking = [
    { person: leader, probability: 0.57 },
    { person: runnerUp, probability: 0.43 },
  ];
  assert.equal(shouldGuessGeniusPerson(confidentRanking, 4), false);
  assert.equal(shouldGuessGeniusPerson(confidentRanking, 5), true);

  const uncertainRanking = [
    { person: leader, probability: 0.35 },
    { person: runnerUp, probability: 0.34 },
  ];
  assert.equal(shouldGuessGeniusPerson(uncertainRanking, 11), false);
  assert.equal(shouldGuessGeniusPerson(uncertainRanking, 12), true);

  const data = JSON.parse(
    readFileSync(new URL("../public/data/quiz_players.json", import.meta.url), "utf8"),
  ) as QuizData;
  const candidates = buildGeniusPeople(data.players);
  const questions = buildGeniusQuestions();
  const target = candidates.find((person) => person.name === "一诺");
  assert.ok(target);
  const responses: Array<{ questionId: string; answer: "yes" | "no" | "unknown" }> = [];
  let guessedAfter = 0;
  for (let index = 0; index < 12; index += 1) {
    const ranking = rankGeniusPeople(candidates, questions, responses);
    if (shouldGuessGeniusPerson(ranking, responses.length)) {
      guessedAfter = responses.length;
      break;
    }
    const asked = new Set(responses.map((response) => response.questionId));
    const question = selectGeniusQuestion(questions, ranking, asked);
    assert.ok(question);
    const expected = question.answer(target);
    responses.push({
      questionId: question.id,
      answer: expected === null ? "unknown" : expected ? "yes" : "no",
    });
  }
  if (!guessedAfter) {
    const ranking = rankGeniusPeople(candidates, questions, responses);
    if (shouldGuessGeniusPerson(ranking, responses.length)) guessedAfter = responses.length;
  }
  assert.ok(guessedAfter >= 5 && guessedAfter <= 12);
});


test("network genius staff portraits are complete and Tianyun differs from Linger", () => {
  const people = buildGeniusPeople([]);
  const staff = people.filter((person) => person.id.startsWith("extra:"));
  assert.equal(staff.length, 18);
  assert.ok(staff.every((person) => person.iconUrl.startsWith("/assets/staff-icons/")));

  const questions = buildGeniusQuestions();
  const shared = [
    { questionId: "role:commentator", answer: "yes" as const },
    { questionId: "female", answer: "yes" as const },
    { questionId: "host-interviewer", answer: "yes" as const },
  ];
  const tianyun = rankGeniusPeople(people, questions, [
    ...shared,
    { questionId: "english-broadcast", answer: "yes" as const },
    { questionId: "rookie-commentator-award", answer: "no" as const },
  ]);
  const linger = rankGeniusPeople(people, questions, [
    ...shared,
    { questionId: "english-broadcast", answer: "no" as const },
    { questionId: "rookie-commentator-award", answer: "yes" as const },
  ]);
  assert.equal(tianyun[0]?.person.name, "天云");
  assert.equal(linger[0]?.person.name, "灵儿");
});


test("network genius coach catalog keeps verified identities, teams and titles", () => {
  const coaches = buildGeniusPeople([]).filter((person) => person.roles.includes("coach"));
  const expected = [
    { name: "久哲", teams: ["南京Hero久竞", "广州TTG", "上海RNG.M"], titles: 5, active: null },
    { name: "Gemini", teams: ["QGhappy", "重庆狼队"], titles: 4, active: true },
    { name: "SK", teams: ["BA黑凤梨", "QGhappy", "深圳DYG", "武汉eStarPro", "重庆狼队"], titles: 5, active: true },
    { name: "张角", teams: ["南京Hero久竞", "济南RW侠", "成都AG超玩会", "上海EDG.M", "杭州LGD.NBW", "长沙TES.A"], titles: 0, active: true },
    { name: "林", teams: ["上海EDG.M", "深圳DYG", "武汉eStarPro", "重庆狼队", "南京Hero久竞", "北京JDG", "北京WB"], titles: 2, active: true },
    { name: "花楼", teams: ["佛山GK", "北京WB", "武汉eStarPro", "南京Hero久竞"], titles: 0, active: null },
    { name: "LoveCD", teams: ["西安WE", "广州TTG", "重庆狼队"], titles: 2, active: false },
    { name: "770", teams: ["BA黑凤梨", "KZ", "QGhappy", "KS.YTG", "武汉eStarPro", "北京JDG"], titles: 1, active: null },
  ];
  assert.deepEqual(coaches.map((coach) => coach.name), expected.map((coach) => coach.name));
  for (const profile of expected) {
    const coach = coaches.find((person) => person.name === profile.name);
    assert.ok(coach, `缺少教练：${profile.name}`);
    assert.deepEqual(coach.teams, profile.teams, `${profile.name} 战队履历不一致`);
    assert.equal(coach.championshipCount, profile.titles, `${profile.name} 冠军数不一致`);
    assert.equal(coach.active, profile.active, `${profile.name} 活跃状态不一致`);
    assert.equal(coach.female, false, `${profile.name} 性别信息缺失`);
    assert.equal(coach.hasFmvp, false, `${profile.name} FMVP 信息缺失`);
  }
  const hashes = coaches.map((coach) => createHash("sha256")
    .update(readFileSync(new URL(`../public${coach.iconUrl}`, import.meta.url)))
    .digest("hex"));
  assert.equal(new Set(hashes).size, coaches.length, "教练头像存在重复或串位");
  assert.equal(coaches.find((coach) => coach.name === "林")?.iconUrl, "/assets/staff-icons/lin-official.jpg");
  assert.equal(coaches.find((coach) => coach.name === "LoveCD")?.iconUrl, "/assets/staff-icons/lovecd.webp");
});
