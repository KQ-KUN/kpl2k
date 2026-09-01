import type { QuizPlayer } from "./types.ts";


export const GENIUS_ANSWERS = ["yes", "probably_yes", "unknown", "probably_no", "no"] as const;
export type GeniusAnswer = (typeof GENIUS_ANSWERS)[number];
export type GeniusRole = "player" | "coach" | "commentator";
export type GeniusTrait = "host_interviewer" | "english_broadcast" | "rookie_commentator_award";

export interface GeniusPerson {
  id: string;
  name: string;
  aliases: string[];
  iconUrl: string;
  iconPosition: string;
  roles: GeniusRole[];
  traits: GeniusTrait[];
  teams: string[];
  positions: string[];
  debutYear: number | null;
  active: boolean | null;
  female: boolean | null;
  championshipCount: number | null;
  hasFmvp: boolean | null;
  popularity: number;
}

export interface GeniusQuestion {
  id: string;
  text: string;
  category: string;
  answer: (person: GeniusPerson) => boolean | null;
}

export interface GeniusResponse {
  questionId: string;
  answer: GeniusAnswer;
}

export interface RankedPerson {
  person: GeniusPerson;
  probability: number;
}

type ExtraPerson = Omit<GeniusPerson, "id" | "aliases" | "iconUrl" | "iconPosition" | "traits" | "positions" | "debutYear" | "female" | "championshipCount" | "hasFmvp"> &
  Partial<Pick<GeniusPerson, "aliases" | "iconUrl" | "iconPosition" | "traits" | "positions" | "debutYear" | "female" | "championshipCount" | "hasFmvp">>;

const EXTRA_PEOPLE: ExtraPerson[] = [
  { name: "久哲", aliases: ["胡庄浩"], roles: ["coach"], teams: ["南京Hero久竞", "广州TTG", "上海RNG.M"], active: null, popularity: 6, championshipCount: 5, female: false, hasFmvp: false },
  { name: "Gemini", aliases: ["郭家毅"], roles: ["coach", "commentator"], teams: ["QGhappy", "重庆狼队"], active: true, popularity: 7, championshipCount: 4, female: false, hasFmvp: false },
  { name: "SK", aliases: ["宋季泽"], roles: ["coach"], teams: ["BA黑凤梨", "QGhappy", "深圳DYG", "武汉eStarPro", "重庆狼队"], active: true, popularity: 5, championshipCount: 5, female: false, hasFmvp: false },
  { name: "张角", aliases: ["逆风", "周宇"], roles: ["coach"], teams: ["南京Hero久竞", "济南RW侠", "成都AG超玩会", "上海EDG.M", "杭州LGD.NBW", "长沙TES.A"], active: true, popularity: 4, championshipCount: 0, female: false, hasFmvp: false },
  { name: "林", aliases: ["老林", "吕成林"], roles: ["coach"], teams: ["上海EDG.M", "深圳DYG", "武汉eStarPro", "重庆狼队", "南京Hero久竞", "北京JDG", "北京WB"], active: true, popularity: 5, championshipCount: 2, female: false, hasFmvp: false },
  { name: "花楼", aliases: ["98K", "杨鹏"], roles: ["coach"], teams: ["佛山GK", "北京WB", "武汉eStarPro", "南京Hero久竞"], active: null, popularity: 4, championshipCount: 0, female: false, hasFmvp: false },
  { name: "LoveCD", aliases: ["老盖", "李俊峰"], roles: ["coach"], teams: ["西安WE", "广州TTG", "重庆狼队"], active: false, popularity: 4, championshipCount: 2, female: false, hasFmvp: false },
  { name: "770", aliases: ["刘雪祥"], roles: ["player", "coach", "commentator"], teams: ["BA黑凤梨", "KZ", "QGhappy", "KS.YTG", "武汉eStarPro", "北京JDG"], positions: ["游走"], debutYear: 2017, active: null, popularity: 4, championshipCount: 1, female: false, hasFmvp: false },
  { name: "李九", roles: ["commentator"], teams: [], active: true, popularity: 6, female: false },
  { name: "瓶子", roles: ["commentator"], teams: [], active: true, popularity: 6, female: false },
  { name: "英凯", roles: ["commentator"], teams: [], active: true, popularity: 5, female: false },
  { name: "潇洒", roles: ["player", "commentator"], teams: ["eStarPro"], positions: ["对抗路"], active: true, popularity: 4, female: false, championshipCount: 0, hasFmvp: false },
  { name: "狂人", roles: ["commentator"], teams: [], active: true, popularity: 4, female: false },
  { name: "黄超", roles: ["player", "commentator"], teams: ["GK"], active: true, popularity: 3, female: false, championshipCount: 0, hasFmvp: false },
  { name: "居居", roles: ["player", "commentator"], teams: ["eStarPro"], active: true, popularity: 4, female: false, championshipCount: 0, hasFmvp: false },
  { name: "天云", roles: ["commentator"], teams: [], active: true, popularity: 5, female: true },
  { name: "灵儿", roles: ["commentator"], teams: [], active: true, popularity: 5, female: true },
  { name: "琪琪", roles: ["commentator"], teams: [], active: true, popularity: 4, female: true },
];

const STAFF_AVATARS: Record<string, { url: string; position: string }> = {
  久哲: { url: "/assets/staff-icons/jiuzhe.webp", position: "50% 20%" },
  Gemini: { url: "/assets/staff-icons/gemini.webp", position: "50% 24%" },
  SK: { url: "/assets/staff-icons/sk.webp", position: "78% 20%" },
  张角: { url: "/assets/staff-icons/zhangjiao.webp", position: "50% 24%" },
  林: { url: "/assets/staff-icons/lin-official.jpg", position: "50% 18%" },
  花楼: { url: "/assets/staff-icons/hualou.webp", position: "50% 18%" },
  LoveCD: { url: "/assets/staff-icons/lovecd.webp", position: "50% 20%" },
  "770": { url: "/assets/staff-icons/770.webp", position: "50% 18%" },
  李九: { url: "/assets/staff-icons/lijiu.webp", position: "50% 18%" },
  瓶子: { url: "/assets/staff-icons/pingzi.webp", position: "50% 18%" },
  英凯: { url: "/assets/staff-icons/yingkai.webp", position: "50% 18%" },
  潇洒: { url: "/assets/staff-icons/xiaosa.webp", position: "50% 18%" },
  狂人: { url: "/assets/staff-icons/kuangren.webp", position: "50% 18%" },
  黄超: { url: "/assets/staff-icons/huangchao.webp", position: "50% 17%" },
  居居: { url: "/assets/staff-icons/juju.webp", position: "50% 18%" },
  天云: { url: "/assets/staff-icons/tianyun.webp", position: "50% 18%" },
  灵儿: { url: "/assets/staff-icons/linger.webp", position: "50% 16%" },
  琪琪: { url: "/assets/staff-icons/qiqi.webp", position: "50% 14%" },
};

const STAFF_TRAITS: Partial<Record<string, GeniusTrait[]>> = {
  英凯: ["host_interviewer"],
  天云: ["host_interviewer", "english_broadcast"],
  灵儿: ["host_interviewer", "rookie_commentator_award"],
};

const TEAM_GROUPS = [
  ["成都AG超玩会", ["AG超玩会", "成都AG"]],
  ["重庆狼队／QGhappy", ["狼队", "QGhappy", "重庆QG"]],
  ["武汉eStarPro", ["eStarPro", "武汉eStar"]],
  ["北京WB／TS", ["北京WB", "WB", "TS"]],
  ["南京Hero久竞", ["Hero久竞", "南京Hero"]],
  ["广州TTG／XQ", ["广州TTG", "TTG", "XQ"]],
  ["佛山DRG／GK", ["佛山DRG", "DRG", "GK"]],
  ["苏州KSG", ["苏州KSG", "KSG"]],
  ["深圳DYG／JC", ["深圳DYG", "DYG", "JC"]],
  ["济南RW侠", ["济南RW侠", "RW侠"]],
  ["长沙TES.A", ["长沙TES", "TES.A"]],
  ["上海EDG.M", ["上海EDG", "EDG.M"]],
  ["西安WE", ["西安WE"]],
  ["杭州LGD.NBW", ["杭州LGD", "LGD.NBW", "NBW"]],
  ["北京JDG", ["北京JDG", "JDG"]],
  ["上海RNG.M", ["上海RNG.M", "RNG.M"]],
  ["KS.YTG", ["KS.YTG", "YTG"]],
] as const;

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function buildGeniusPeople(players: QuizPlayer[]): GeniusPerson[] {
  const people = new Map<string, GeniusPerson>();
  for (const player of players.filter((item) => item.difficulty.includes("normal"))) {
    people.set(player.nickname.toLocaleLowerCase("zh-CN"), {
      id: player.id,
      name: player.nickname,
      aliases: player.aliases,
      iconUrl: player.iconUrl,
      iconPosition: "50% 50%",
      roles: ["player"],
      traits: [],
      teams: unique([player.latestTeamName, ...player.teamHistoryNames]),
      positions: player.positions,
      debutYear: player.debutYear,
      active: player.active,
      female: false,
      championshipCount: player.championshipCount,
      hasFmvp: player.hasFmvp,
      popularity: player.difficulty.includes("popular") ? 7 : 2,
    });
  }

  for (const extra of EXTRA_PEOPLE) {
    const key = extra.name.toLocaleLowerCase("zh-CN");
    const existing = people.get(key);
    const staffAvatar = STAFF_AVATARS[extra.name];
    const staffTraits = extra.traits ?? STAFF_TRAITS[extra.name] ?? [];
    if (existing) {
      existing.roles = unique([...existing.roles, ...extra.roles]) as GeniusRole[];
      existing.aliases = unique([...existing.aliases, ...(extra.aliases ?? [])]);
      existing.teams = unique([...existing.teams, ...extra.teams]);
      existing.positions = unique([...existing.positions, ...(extra.positions ?? [])]);
      existing.traits = unique([...existing.traits, ...staffTraits]) as GeniusTrait[];
      if (extra.iconUrl ?? staffAvatar?.url) existing.iconUrl = extra.iconUrl ?? staffAvatar?.url ?? existing.iconUrl;
      if (extra.iconPosition ?? staffAvatar?.position) existing.iconPosition = extra.iconPosition ?? staffAvatar?.position ?? existing.iconPosition;
      existing.active = extra.active;
      existing.popularity = Math.max(existing.popularity, extra.popularity);
      continue;
    }
    people.set(key, {
      id: `extra:${key}`,
      name: extra.name,
      aliases: extra.aliases ?? [],
      iconUrl: extra.iconUrl ?? staffAvatar?.url ?? "",
      iconPosition: extra.iconPosition ?? staffAvatar?.position ?? "50% 50%",
      roles: extra.roles,
      traits: staffTraits,
      teams: extra.teams,
      positions: extra.positions ?? [],
      debutYear: extra.debutYear ?? null,
      active: extra.active,
      female: extra.female ?? null,
      championshipCount: extra.championshipCount ?? null,
      hasFmvp: extra.hasFmvp ?? null,
      popularity: extra.popularity,
    });
  }
  return [...people.values()];
}

function roleQuestion(role: GeniusRole, label: string): GeniusQuestion {
  return {
    id: `role:${role}`,
    text: `你想的这位人物主要以${label}身份为人熟知吗？`,
    category: "人物身份",
    answer: (person) => person.roles.includes(role),
  };
}

function booleanQuestion(
  id: string,
  text: string,
  category: string,
  read: (person: GeniusPerson) => boolean | null,
): GeniusQuestion {
  return { id, text, category, answer: read };
}

export function buildGeniusQuestions(): GeniusQuestion[] {
  const questions: GeniusQuestion[] = [
    roleQuestion("player", "职业选手"),
    roleQuestion("coach", "教练"),
    roleQuestion("commentator", "官方解说或主持"),
    booleanQuestion("active", "你想的这位人物目前仍活跃在 KPL 相关赛事中吗？", "当前状态", (person) => person.active),
    booleanQuestion("female", "你想的这位人物是女性吗？", "人物特征", (person) => person.female),
    booleanQuestion("host-interviewer", "你想的这位人物经常担任舞台主持或赛后采访吗？", "工作场景", (person) => person.traits.includes("host_interviewer")),
    booleanQuestion("english-broadcast", "你想的这位人物曾在 KPL 总决赛进行英文解说吗？", "特定场景", (person) => person.traits.includes("english_broadcast")),
    booleanQuestion("rookie-commentator-award", "你想的这位人物获得过 2018 年 KPL 最佳新人解说吗？", "解说荣誉", (person) => person.traits.includes("rookie_commentator_award")),
    booleanQuestion("champion", "你想的这位人物拿过 KPL 联赛或挑战者杯冠军吗？", "生涯荣誉", (person) => person.championshipCount === null ? null : person.championshipCount > 0),
    booleanQuestion("champion:3", "你想的这位人物至少拿过三次 KPL 联赛或挑战者杯冠军吗？", "生涯荣誉", (person) => person.championshipCount === null ? null : person.championshipCount >= 3),
    booleanQuestion("champion:5", "你想的这位人物至少拿过五次 KPL 联赛或挑战者杯冠军吗？", "生涯荣誉", (person) => person.championshipCount === null ? null : person.championshipCount >= 5),
    booleanQuestion("fmvp", "你想的这位人物拿过 KPL 联赛或挑战者杯 FMVP 吗？", "生涯荣誉", (person) => person.hasFmvp),
    ...[2018, 2020, 2022, 2024].map((year) => booleanQuestion(
      `debut:${year}`,
      `你想的这位人物是在 ${year} 年以前登上 KPL 赛场的吗？`,
      "登场时间",
      (person) => person.debutYear === null ? null : person.debutYear < year,
    )),
    ...["对抗路", "打野", "中路", "发育路", "游走"].map((position) => booleanQuestion(
      `position:${position}`,
      `你想的这位人物打职业时主要担任${position}吗？`,
      "比赛位置",
      (person) => person.roles.includes("player") ? person.positions.includes(position) : null,
    )),
    ...TEAM_GROUPS.map(([label, aliases]) => booleanQuestion(
      `team:${label}`,
      `你想的这位人物曾经效力、执教或长期关联过 ${label} 吗？`,
      "战队经历",
      (person) => person.teams.some((team) => aliases.some((alias) => team.includes(alias))),
    )),
  ];
  return questions;
}

function likelihood(expected: boolean | null, answer: GeniusAnswer): number {
  if (expected === null || answer === "unknown") return 0.55;
  if (answer === "yes") return expected ? 1 : 0.06;
  if (answer === "probably_yes") return expected ? 0.82 : 0.24;
  if (answer === "probably_no") return expected ? 0.24 : 0.82;
  return expected ? 0.06 : 1;
}

export function rankGeniusPeople(
  people: GeniusPerson[],
  questions: GeniusQuestion[],
  responses: GeniusResponse[],
  excludedIds: ReadonlySet<string> = new Set(),
): RankedPerson[] {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const scored = people
    .filter((person) => !excludedIds.has(person.id))
    .map((person) => {
      let score = Math.log(Math.max(person.popularity, 0.1));
      for (const response of responses) {
        const question = byId.get(response.questionId);
        if (question) score += Math.log(likelihood(question.answer(person), response.answer));
      }
      return { person, score };
    });
  const maxScore = Math.max(...scored.map((item) => item.score), 0);
  const weighted = scored.map((item) => ({ ...item, weight: Math.exp(item.score - maxScore) }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0) || 1;
  return weighted
    .map((item) => ({ person: item.person, probability: item.weight / total }))
    .sort((left, right) => right.probability - left.probability || right.person.popularity - left.person.popularity);
}

export function shouldGuessGeniusPerson(
  ranked: RankedPerson[],
  responseCount: number,
): boolean {
  const leader = ranked[0];
  return Boolean(
    leader
    && responseCount >= 5
    && (leader.probability >= 0.56 || responseCount >= 12),
  );
}

export function selectGeniusQuestion(
  questions: GeniusQuestion[],
  ranked: RankedPerson[],
  askedIds: ReadonlySet<string>,
): GeniusQuestion | null {
  const totalWeight = ranked.reduce((sum, item) => sum + item.probability, 0) || 1;
  const leader = ranked[0];
  const runnerUp = ranked[1];
  let best: { question: GeniusQuestion; score: number } | null = null;
  for (const question of questions) {
    if (askedIds.has(question.id)) continue;
    const leaderAnswer = leader ? question.answer(leader.person) : null;
    const runnerUpAnswer = runnerUp ? question.answer(runnerUp.person) : null;
    const separatesLeaders = (leader?.probability ?? 0) >= 0.35
      && leaderAnswer !== null
      && runnerUpAnswer !== null
      && leaderAnswer !== runnerUpAnswer;
    let known = 0;
    let yes = 0;
    for (const item of ranked) {
      const expected = question.answer(item.person);
      if (expected === null) continue;
      known += item.probability;
      if (expected) yes += item.probability;
    }
    if (known < totalWeight * 0.25 && !separatesLeaders) continue;
    const yesRatio = yes / known;
    if ((yesRatio < 0.04 || yesRatio > 0.96) && !separatesLeaders) continue;
    const coverage = known / totalWeight;
    const balance = 1 - Math.abs(0.5 - yesRatio) * 2;
    const score = coverage * (0.2 + balance * 0.8) + (separatesLeaders ? 1 : 0);
    if (!best || score > best.score) best = { question, score };
  }
  return best?.question ?? null;
}
