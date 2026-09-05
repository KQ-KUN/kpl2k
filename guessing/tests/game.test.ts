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
  shouldDelayGeniusGuess,
  shouldGuessGeniusPerson,
} from "../src/genius.ts";
import type { QuizData, QuizPlayer } from "../src/types.ts";


test("official recent finals corrections are present in the shipped snapshot", () => {
  const data: QuizData = JSON.parse(readFileSync(new URL("../public/data/quiz_players.json", import.meta.url), "utf8"));
  const byName = new Map(data.players.map((entry) => [entry.nickname, entry]));
  const titles = { "道崽": 1, "风箫": 1, "一笙": 3, "小俞": 1, "清清": 3,
    "皖皖": 1, "归期": 2, "小胖": 5, "星宇": 1, "玖欣": 1, "小屿": 1 };
  for (const [name, count] of Object.entries(titles)) {
    assert.equal(byName.get(name)?.championshipCount, count, name);
  }
  assert.equal(byName.get("信")?.hasFmvp, true);
});

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

test("same nickname players keep separate identities and uncertain honours are neutral", () => {
  const entries = [player({ id: "one", nickname: "九月" }), player({ id: "two", nickname: "九月" })];
  const people = buildGeniusPeople(entries);
  assert.ok(people.some((entry) => entry.id === "one"));
  assert.ok(people.some((entry) => entry.id === "two"));
  const uncertain = player({ championshipVerified: false });
  assert.equal(comparePlayers(uncertain, entries[0]!).championshipCount, "unknown");
  assert.equal(comparePlayers(entries[0]!, uncertain).championshipCount, "unknown");
  assert.equal(buildGeniusPeople([uncertain]).find((entry) => entry.id === uncertain.id)?.championshipCount, null);
});


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


test("network genius covers the full player pool and keeps coaches and commentators", () => {
  const people = buildGeniusPeople([
    player({ difficulty: ["normal", "hardcore"] }),
    player({ id: "hard", nickname: "冷门选手", difficulty: ["hardcore"] }),
  ]);
  assert.ok(people.some((item) => item.name === "Fly"));
  assert.ok(people.some((item) => item.name === "冷门选手"));
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
    { questionId: "position:发育路", answer: "yes" as const },
    { questionId: "champion:5", answer: "yes" as const },
  ];
  const ranked = rankGeniusPeople(people, questions, responses);
  assert.equal(ranked[0]?.person.name, "一诺");
  const asked = new Set(responses.map((response) => response.questionId));
  const next = selectGeniusQuestion(questions, ranked, asked);
  assert.ok(next === null || !asked.has(next.id));
});


test("network genius varies question themes and spaces out team questions", () => {
  const data = JSON.parse(
    readFileSync(new URL("../public/data/quiz_players.json", import.meta.url), "utf8"),
  ) as QuizData;
  const people = buildGeniusPeople(data.players);
  const questions = buildGeniusQuestions(people);
  assert.ok(questions.some((question) => question.id === "arc:long-career"));
  assert.ok(questions.some((question) => question.id === "honour:fmvp-dynasty"));
  assert.ok(questions.some((question) => question.id === "record:ironman"));
  assert.ok(questions.some((question) => question.id === "last-seen:2025"));
  assert.ok(questions.some((question) => question.id === "name:latin"));
  assert.ok(questions.some((question) => question.id.startsWith("team:")));
  assert.ok(questions.every((question) => question.id !== "record:peak-95"));
  assert.ok(questions.every((question) => !question.text.includes("图鉴战力")));
  const seenCategories = new Set<string>();

  for (const target of people.filter((person) => person.roles.includes("player")).slice(0, 40)) {
    const responses: Array<{ questionId: string; answer: "yes" | "no" | "unknown" }> = [];
    for (let index = 0; index < 12; index += 1) {
      const ranked = rankGeniusPeople(people, questions, responses);
      if (shouldGuessGeniusPerson(ranked, responses.length)) break;
      const asked = new Set(responses.map((response) => response.questionId));
      const question = selectGeniusQuestion(questions, ranked, asked);
      if (!question) break;
      const expected = question.answer(target);
      responses.push({
        questionId: question.id,
        answer: expected === null ? "unknown" : expected ? "yes" : "no",
      });
    }
    const selected = responses.map((response) => questions.find((question) => question.id === response.questionId));
    for (const question of selected) {
      if (question) seenCategories.add(question.category);
    }
    const teamIndexes = selected
      .map((question, index) => question?.category === "战队履历" ? index : -1)
      .filter((index) => index >= 0);
    assert.ok(teamIndexes.every((index) => index >= 4), `${target.name} 过早进入战队问题`);
    for (let index = 1; index < teamIndexes.length; index += 1) {
      assert.ok(teamIndexes[index]! - teamIndexes[index - 1]! >= 3, `${target.name} 连续使用战队问题`);
    }
    for (let index = 1; index < selected.length; index += 1) {
      assert.ok(
        selected[index - 1]?.category !== "人物称呼" || selected[index]?.category !== "人物称呼",
        `${target.name} 连续使用称呼问题`,
      );
    }
  }
  assert.ok(seenCategories.has("生涯轨迹"));
  assert.ok(seenCategories.has("荣誉拼图"));
  assert.ok(seenCategories.has("赛场履历"));
  assert.ok(seenCategories.has("人物称呼"));
});


test("network genius understands natural nickname clues", () => {
  const people = buildGeniusPeople([
    player({ id: "xiao-y", nickname: "小Y", difficulty: ["hardcore"] }),
    player({ id: "qiqi", nickname: "琪琪", difficulty: ["hardcore"] }),
    player({ id: "koko", nickname: "KoKo", difficulty: ["hardcore"] }),
    player({ id: "seven", nickname: "七", difficulty: ["hardcore"] }),
    player({ id: "north", nickname: "北诗", difficulty: ["hardcore"] }),
    player({ id: "white", nickname: "白衣", difficulty: ["hardcore"] }),
    player({ id: "wind", nickname: "风铃", difficulty: ["hardcore"] }),
  ]);
  const questions = new Map(buildGeniusQuestions(people).map((question) => [question.id, question]));
  const person = (name: string) => {
    const match = people.find((item) => item.name === name);
    assert.ok(match);
    return match;
  };
  assert.equal(questions.get("name:contains-xiao")?.answer(person("小Y")), true);
  assert.equal(questions.get("name:mixed")?.answer(person("小Y")), true);
  assert.equal(questions.get("name:repeated")?.answer(person("琪琪")), true);
  assert.equal(questions.get("name:repeated")?.answer(person("KoKo")), true);
  assert.equal(questions.get("name:number")?.answer(person("七")), true);
  assert.equal(questions.get("name:direction")?.answer(person("北诗")), true);
  assert.equal(questions.get("name:color")?.answer(person("白衣")), true);
  assert.equal(questions.get("name:nature")?.answer(person("风铃")), true);
});


test("network genius resolves close rivals before guessing", () => {
  const data = JSON.parse(
    readFileSync(new URL("../public/data/quiz_players.json", import.meta.url), "utf8"),
  ) as QuizData;
  const people = buildGeniusPeople(data.players);
  const questions = buildGeniusQuestions(people);
  const target = people.find((person) => person.name === "一诺");
  const rival = people.find((person) => person.name === "大帅");
  assert.ok(target && rival);
  const responses: Array<{ questionId: string; answer: "yes" | "no" | "unknown" }> = [];
  let guess = "";
  let askedDirectContrast = false;
  for (let index = 0; index < 16; index += 1) {
    const ranked = rankGeniusPeople(people, questions, responses);
    const question = selectGeniusQuestion(
      questions,
      ranked,
      new Set(responses.map((response) => response.questionId)),
    );
    if (shouldGuessGeniusPerson(ranked, responses.length)
      && !shouldDelayGeniusGuess(question, ranked, responses.length)) {
      guess = ranked[0]?.person.name ?? "";
      break;
    }
    assert.ok(question);
    const expected = question.answer(target);
    if (question.answer(target) !== null
      && question.answer(rival) !== null
      && question.answer(target) !== question.answer(rival)) askedDirectContrast = true;
    responses.push({
      questionId: question.id,
      // 模拟玩家漏记一诺早期 BA 经历；系统仍应继续核对位置、年代等硬差异。
      answer: question.id === "arc:multi-team" ? "no" : expected === null ? "unknown" : expected ? "yes" : "no",
    });
  }
  assert.equal(guess, "一诺");
  assert.equal(askedDirectContrast, true);
});


test("network genius can identify representative hardcore players", () => {
  const data = JSON.parse(
    readFileSync(new URL("../public/data/quiz_players.json", import.meta.url), "utf8"),
  ) as QuizData;
  const people = buildGeniusPeople(data.players);
  const questions = buildGeniusQuestions(people);
  const availableNames = new Set(people.map((person) => person.name.toLocaleLowerCase("zh-CN")));
  assert.ok(data.players.every((player) => availableNames.has(player.nickname.toLocaleLowerCase("zh-CN"))));

  for (const name of ["小词", "离洛", "浅风", "风铃", "小优", "玖痕", "小北", "落空", "万基", "亦南", "孤梦", "情缘"]) {
    const target = people.find((person) => person.name === name);
    assert.ok(target, `冷门候选缺失：${name}`);
    const responses: Array<{ questionId: string; answer: "yes" | "no" | "unknown" }> = [];
    for (let index = 0; index < 12; index += 1) {
      const ranked = rankGeniusPeople(people, questions, responses);
      if (shouldGuessGeniusPerson(ranked, responses.length)) break;
      const question = selectGeniusQuestion(
        questions,
        ranked,
        new Set(responses.map((response) => response.questionId)),
      );
      assert.ok(question, `${name} 无可用问题`);
      const expected = question.answer(target);
      responses.push({
        questionId: question.id,
        answer: expected === null ? "unknown" : expected ? "yes" : "no",
      });
    }
    const ranked = rankGeniusPeople(people, questions, responses);
    assert.equal(ranked[0]?.person.id, target.id, `${name} 未被推到首位`);
    assert.ok(shouldGuessGeniusPerson(ranked, responses.length), `${name} 未进入猜测阶段`);
  }
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
