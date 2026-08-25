# KPL 2K 背景音乐接入说明

## 音源放置

把三个音频文件放到 `app/assets/audio/` 下，文件名固定：

| 场景 | 文件名 | 用途 |
|---|---|---|
| 首页 | `首页.m4a` | 巅峰对决（固定一首） |
| 对局 | `云梦谣.m4a`、`冠军杯.m4a`、`明日坐标.m4a`、`王者冰刃.m4a`、`荣耀主题.m4a` | 王者大厅 BGM（多首，按歌名选择） |
| 夺冠（默认） | `无双的王者.m4a` | 常规战歌 |
| 夺冠（各队） | `红小孩.m4a`（AG）、`星小孩.m4a`（eStarPro）、`狼小孩.m4a`（狼队）、`淬炼小孩.m4a`（WB）、`DYG小孩.m4a`（DYG）、`HERO小孩.m4a`（Hero）、`KSG小孩.m4a`（KSG）、`TT小孩.m4a`（TTG）、`突然的陀螺小孩.m4a`（TES） | 按夺冠队伍放对应战歌 |

> 音源缺失时模块自动静默跳过，不会报错、不影响游戏。

## 接入方式

页面引入 `app/js/bgm.js`：

```html
<script src="js/bgm.js"></script>
```

初始化并切换场景：

```js
BGM.init({
  intro: 'assets/audio/首页.m4a',
  battle: [
    { name: '云梦谣', src: 'assets/audio/云梦谣.m4a' },
    { name: '冠军杯', src: 'assets/audio/冠军杯.m4a' },
    { name: '明日坐标', src: 'assets/audio/明日坐标.m4a' },
    { name: '王者冰刃', src: 'assets/audio/王者冰刃.m4a' },
    { name: '荣耀主题', src: 'assets/audio/荣耀主题.m4a' }
  ],
  champion: {
    default: 'assets/audio/无双的王者.m4a',
    byTeam: {
      '成都AG超玩会': 'assets/audio/红小孩.m4a',
      '武汉eStarPro': 'assets/audio/星小孩.m4a',
      '重庆狼队': 'assets/audio/狼小孩.m4a',
      '北京WB': 'assets/audio/淬炼小孩.m4a',
      '深圳DYG': 'assets/audio/DYG小孩.m4a',
      '南通Hero久竞': 'assets/audio/HERO小孩.m4a',
      'KSG': 'assets/audio/KSG小孩.m4a',
      '广州TTG': 'assets/audio/TT小孩.m4a',
      '长沙TES.A': 'assets/audio/突然的陀螺小孩.m4a'
    }
  }
});

BGM.play('intro');     // 进入开赛/组队页
BGM.play('battle');    // 开始模拟/展示战报
BGM.nextTrack();       // 对局中切到下一首 BGM（正在播放则直接换曲）
BGM.prevTrack();       // 对局中切到上一首
BGM.play('champion', '成都AG超玩会');  // 夺冠结算，按队伍放战歌；未配置该队时自动回退默认 无双的王者.m4a
BGM.stop();            // 全部停止
```

夺冠战歌映射：`byTeam` 里配了哪队，就放哪队的专属文件；没配的队伍夺冠时回退 `default`。
队伍 key 与产品内夺冠判定用的队伍显示名保持一致（例如"成都AG超玩会"）。

对局 BGM 用 `{ name, src }` 传歌名（UI 按歌名展示），只传字符串路径也可以，歌名自动取文件名。

## 移动端自动播放限制（重要）

浏览器禁止无手势自动出声。在用户第一次点击任意按钮时调用一次 `BGM.unlock()`，
之前排队的场景会在该手势内恢复播放：

```js
document.addEventListener('click', function once() {
  BGM.unlock();
  document.removeEventListener('click', once);
}, { once: true });
```

## 控制 API

- `BGM.setMuted(true/false)`：静音/恢复，偏好写入 localStorage（`kpl2k_bgm_muted`）
- `BGM.isMuted()`：是否静音
- `BGM.setVolume(0.6)`：音量 0–1
- `BGM.getVolume()`：当前音量
- `BGM.getScene()`：当前场景（`intro`/`battle`/`champion`/`null`）
- `BGM.getTrackIndex()`：当前对局曲目序号（0 起）
- `BGM.getTrackCount()`：对局曲目总数
- `BGM.getTrackName()`：当前对局歌名
- `BGM.getTrackNames()`：全部对局歌名（供歌单选曲）
- `BGM.playTrack(i)`：直接播放第 i 首对局曲目（0 起）
- `BGM.getTeam()`：当前夺冠战歌对应的队伍（默认战歌时为 `null`）

玩家切换的曲目会记住（localStorage `kpl2k_bgm_track`），下次进对局自动接着播。

## 测试

放好音源后直接打开 `app/bgm_demo.html`，三个按钮分别对应开头/对局/夺冠场景，
可快速验证切换、静音与停止。
