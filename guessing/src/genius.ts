import type { QuizPlayer } from "./types.ts";


export const GENIUS_ANSWERS = ["yes", "probably_yes", "unknown", "probably_no", "no"] as const;
export const GENIUS_MAX_QUESTIONS = 16;
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
  latestYear: number | null;
  totalGames: number | null;
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

type ExtraPerson = Omit<GeniusPerson, "id" | "aliases" | "iconUrl" | "iconPosition" | "traits" | "positions" | "debutYear" | "latestYear" | "totalGames" | "female" | "championshipCount" | "hasFmvp"> &
  Partial<Pick<GeniusPerson, "aliases" | "iconUrl" | "iconPosition" | "traits" | "positions" | "debutYear" | "latestYear" | "totalGames" | "female" | "championshipCount" | "hasFmvp">>;

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

function hasRepeatedNamePattern(name: string): boolean {
  const characters = [...name.toLocaleLowerCase("zh-CN")];
  if (characters.some((character, index) => index > 0 && character === characters[index - 1])) return true;
  if (characters.length < 4 || characters.length % 2 !== 0) return false;
  const middle = characters.length / 2;
  return characters.slice(0, middle).join("") === characters.slice(middle).join("");
}

export function buildGeniusPeople(players: QuizPlayer[]): GeniusPerson[] {
  const people = new Map<string, GeniusPerson>();
  for (const player of players) {
    people.set(player.id, {
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
      latestYear: player.latestYear,
      totalGames: player.totalGames,
      active: player.active,
      female: false,
      championshipCount: player.championshipVerified === false ? null : player.championshipCount,
      hasFmvp: player.hasFmvp,
      popularity: player.difficulty.includes("popular") ? 7 : player.difficulty.includes("normal") ? 2 : 0.7,
    });
  }

  for (const extra of EXTRA_PEOPLE) {
    const key = extra.name.toLocaleLowerCase("zh-CN");
    const matches = [...people.values()].filter((person) => person.name.toLocaleLowerCase("zh-CN") === key);
    const existing = matches.length === 1 ? matches[0] : undefined;
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
      latestYear: extra.latestYear ?? null,
      totalGames: extra.totalGames ?? null,
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

export function buildGeniusQuestions(people: GeniusPerson[] = []): GeniusQuestion[] {
  const extraTeamNames = unique(people.flatMap((person) => person.teams))
    .filter((team) => !/待定|未知|自由人/.test(team))
    .filter((team) => !TEAM_GROUPS.some(([, aliases]) => aliases.some(
      (alias) => team.includes(alias) || alias.includes(team),
    )));
  const questions: GeniusQuestion[] = [
    roleQuestion("player", "职业选手"),
    roleQuestion("coach", "教练"),
    roleQuestion("commentator", "官方解说或主持"),
    booleanQuestion("active", "你想的这位人物目前仍活跃在 KPL 相关赛事中吗？", "当前状态", (person) => person.active),
    booleanQuestion("female", "你想的这位人物是女性吗？", "人物特征", (person) => person.female),
    booleanQuestion("host-interviewer", "你想的这位人物经常担任舞台主持或赛后采访吗？", "工作场景", (person) => person.traits.includes("host_interviewer")),
    booleanQuestion("english-broadcast", "你想的这位人物曾在 KPL 总决赛进行英文解说吗？", "特定场景", (person) => person.traits.includes("english_broadcast")),
    booleanQuestion("rookie-commentator-award", "你想的这位人物获得过 2018 年 KPL 最佳新人解说吗？", "解说荣誉", (person) => person.traits.includes("rookie_commentator_award")),
    booleanQuestion("champion", "你想的这位人物作为决赛首发，拿过 KPL 联赛或冠军杯系列赛事冠军吗？", "生涯荣誉", (person) => person.championshipCount === null ? null : person.championshipCount > 0),
    booleanQuestion("champion:3", "你想的这位人物作为决赛首发，至少拿过三次 KPL 联赛或冠军杯系列赛事冠军吗？", "生涯荣誉", (person) => person.championshipCount === null ? null : person.championshipCount >= 3),
    booleanQuestion("champion:5", "你想的这位人物作为决赛首发，至少拿过五次 KPL 联赛或冠军杯系列赛事冠军吗？", "生涯荣誉", (person) => person.championshipCount === null ? null : person.championshipCount >= 5),
    booleanQuestion("fmvp", "你想的这位人物拿过 KPL 联赛或冠军杯系列赛事 FMVP 吗？", "生涯荣誉", (person) => person.hasFmvp),
    booleanQuestion("arc:multi-role", "你想的这位人物是否把生涯从选手席延伸到了教练席或解说席？", "生涯轨迹", (person) => person.roles.includes("player") && person.roles.length > 1),
    booleanQuestion("arc:versatile", "你想的这位人物打职业时，是能胜任两个或更多位置的摇摆人吗？", "生涯轨迹", (person) => person.roles.includes("player") ? person.positions.length >= 2 : null),
    booleanQuestion("arc:long-career", "你想的这位人物，KPL 生涯是否跨越了至少六个自然年？", "生涯轨迹", (person) => person.debutYear === null || person.latestYear === null ? null : person.latestYear - person.debutYear >= 5),
    booleanQuestion("arc:one-season", "你想的这位选手是否只在一个自然年留下过正式比赛记录？", "生涯轨迹", (person) => person.debutYear === null || person.latestYear === null ? null : person.latestYear === person.debutYear),
    booleanQuestion("arc:multi-team", "你想的这位人物是否至少效力或执教过两支战队？", "生涯轨迹", (person) => person.teams.length >= 2),
    booleanQuestion("arc:evergreen", "你想的这位人物是 2020 年前登场、如今仍活跃的老将吗？", "生涯轨迹", (person) => person.debutYear === null || person.active === null ? null : person.debutYear < 2020 && person.active),
    booleanQuestion("arc:well-travelled", "你想的这位人物，生涯足迹是否遍布四支或更多战队？", "生涯轨迹", (person) => person.teams.length >= 4),
    booleanQuestion("honour:fmvp-dynasty", "你想的这位人物是否既拿过 FMVP，又至少三次捧起冠军奖杯？", "荣誉拼图", (person) => person.hasFmvp === null || person.championshipCount === null ? null : person.hasFmvp && person.championshipCount >= 3),
    booleanQuestion("honour:active-champion", "你想的这位人物是仍活跃在赛场的冠军选手吗？", "荣誉拼图", (person) => person.active === null || person.championshipCount === null ? null : person.roles.includes("player") && person.active && person.championshipCount > 0),
    booleanQuestion("honour:early-fmvp", "你想的这位人物是 2018 年前登场、后来拿到 FMVP 的选手吗？", "荣誉拼图", (person) => person.debutYear === null || person.hasFmvp === null ? null : person.roles.includes("player") && person.debutYear < 2018 && person.hasFmvp),
    booleanQuestion("record:ironman", "你想的这位选手是否打满过至少五百小局，是赛场上的铁人？", "赛场履历", (person) => person.totalGames === null ? null : person.totalGames >= 500),
    booleanQuestion("record:brief-champion", "你想的这位选手是否在不足三百局的生涯里就拿到过冠军？", "赛场履历", (person) => person.totalGames === null || person.championshipCount === null ? null : person.totalGames < 300 && person.championshipCount > 0),
    booleanQuestion("record:active-veteran", "你想的这位选手是否已经征战三百局以上，如今仍在赛场？", "赛场履历", (person) => person.totalGames === null || person.active === null ? null : person.totalGames >= 300 && person.active),
    ...[50, 150, 300].map((games) => booleanQuestion(
      `games:${games}`,
      `你想的这位选手，正式比赛记录是否达到过 ${games} 小局？`,
      "赛场履历",
      (person) => person.totalGames === null ? null : person.totalGames >= games,
    )),
    ...[2018, 2020, 2022, 2024].map((year) => booleanQuestion(
      `debut:${year}`,
      `你想的这位人物在 ${year} 年以前就有正式比赛记录吗？`,
      "登场时间",
      (person) => person.debutYear === null ? null : person.debutYear < year,
    )),
    ...[2020, 2023, 2025].map((year) => booleanQuestion(
      `last-seen:${year}`,
      `你想的这位选手在 ${year} 年或以后仍有正式比赛记录吗？`,
      "活跃年代",
      (person) => person.latestYear === null ? null : person.latestYear >= year,
    )),
    booleanQuestion("name:latin", "你想的这位人物，常用 ID 或称呼中包含英文字母吗？", "人物称呼", (person) => /[a-z]/i.test(person.name)),
    booleanQuestion("name:short", "你想的这位人物，常用 ID 或称呼是否只有两个字符？", "人物称呼", (person) => [...person.name].length === 2),
    booleanQuestion("name:contains-xiao", "你想的这位人物，常用 ID 或称呼里有“小”字吗？", "人物称呼", (person) => person.name.includes("小")),
    booleanQuestion("name:repeated", "你想的这位人物，常用 ID 或称呼带有叠字或重复结构吗？", "人物称呼", (person) => hasRepeatedNamePattern(person.name)),
    booleanQuestion("name:single", "你想的这位人物，常用 ID 或称呼只有一个字符吗？", "人物称呼", (person) => [...person.name].length === 1),
    booleanQuestion("name:long", "你想的这位人物，常用 ID 或称呼有四个或更多字符吗？", "人物称呼", (person) => [...person.name].length >= 4),
    booleanQuestion("name:mixed", "你想的这位人物，常用 ID 或称呼是中文与英文字母混合的吗？", "人物称呼", (person) => /[\u3400-\u9fff]/.test(person.name) && /[a-z]/i.test(person.name)),
    booleanQuestion("name:number", "你想的这位人物，常用 ID 或称呼带有数字或数字汉字吗？", "人物称呼", (person) => /[\d零一二三四五六七八九十百千]/.test(person.name)),
    booleanQuestion("name:direction", "你想的这位人物，常用 ID 或称呼里有东、南、西、北这样的方位字吗？", "人物称呼", (person) => /[东南西北]/.test(person.name)),
    booleanQuestion("name:color", "你想的这位人物，常用 ID 或称呼里有颜色字吗？", "人物称呼", (person) => /[红橙黄绿青蓝紫白黑金银]/.test(person.name)),
    booleanQuestion("name:nature", "你想的这位人物，常用 ID 或称呼里有风、雨、雪、月、星、云等自然意象吗？", "人物称呼", (person) => /[风雨雪月星云海山川雷光]/.test(person.name)),
    ...["对抗路", "打野", "中路", "发育路", "游走"].map((position) => booleanQuestion(
      `position:${position}`,
      `你想的这位人物打职业时主要担任${position}吗？`,
      "比赛位置",
      (person) => person.roles.includes("player") ? person.positions.includes(position) : null,
    )),
    ...TEAM_GROUPS.map(([label, aliases]) => booleanQuestion(
      `team:${label}`,
      `你想的这位人物，职业生涯是否与 ${label} 有过正式交集？`,
      "战队履历",
      (person) => person.teams.some((team) => aliases.some((alias) => team.includes(alias))),
    )),
    ...extraTeamNames.map((team) => booleanQuestion(
      `team:${team}`,
      `你想的这位人物，职业生涯是否与 ${team} 有过正式交集？`,
      "战队履历",
      (person) => person.teams.includes(team),
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

export function shouldDelayGeniusGuess(
  question: GeniusQuestion | null,
  ranked: RankedPerson[],
  responseCount: number,
): boolean {
  if (!question || responseCount >= GENIUS_MAX_QUESTIONS) return false;
  const leader = ranked[0];
  if (!leader) return false;
  const leaderAnswer = question.answer(leader.person);
  if (leaderAnswer === null) return false;
  const rivalFloor = Math.max(0.015, leader.probability * 0.04);
  return ranked.slice(1, 6).some((rival) => {
    const rivalAnswer = question.answer(rival.person);
    return rival.probability >= rivalFloor && rivalAnswer !== null && rivalAnswer !== leaderAnswer;
  });
}

export function selectGeniusQuestion(
  questions: GeniusQuestion[],
  ranked: RankedPerson[],
  askedIds: ReadonlySet<string>,
): GeniusQuestion | null {
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const askedQuestions = [...askedIds]
    .map((id) => questionById.get(id))
    .filter((question): question is GeniusQuestion => Boolean(question));
  const categoryCounts = new Map<string, number>();
  for (const question of askedQuestions) {
    categoryCounts.set(question.category, (categoryCounts.get(question.category) ?? 0) + 1);
  }
  const recentCategories = askedQuestions.slice(-2).map((question) => question.category);
  const recentlyAskedTeam = recentCategories.includes("战队履历");
  const lastCategory = recentCategories.at(-1);
  const totalWeight = ranked.reduce((sum, item) => sum + item.probability, 0) || 1;
  const leader = ranked[0];
  const runnerUp = ranked[1];
  let best: { question: GeniusQuestion; score: number } | null = null;
  for (const question of questions) {
    if (askedIds.has(question.id)) continue;
    if (question.category === "战队履历" && (askedQuestions.length < 4 || recentlyAskedTeam)) continue;
    if (question.category === "人物称呼" && lastCategory === "人物称呼") continue;
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
    const categoryCount = categoryCounts.get(question.category) ?? 0;
    const variety = recentCategories.at(-1) === question.category
      ? 0.32
      : recentCategories.includes(question.category) ? 0.62 : 1;
    const score = (coverage * (0.2 + balance * 0.8) + (separatesLeaders ? 1 : 0))
      * variety
      / (1 + categoryCount * 0.3);
    if (!best || score > best.score) best = { question, score };
  }
  return best?.question ?? null;
}
