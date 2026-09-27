
const { Judge } = require('../src/rhythm/judge.js');
const { Note } = require('../src/rhythm/note.js');
const { InputTiming, AudioClock } = require('../src/input/timing.js');

describe('音乐游戏谱面判定', () => {
  test('时间差判定', () => {
    const j = new Judge();
    const note = new Note(1.0, 0);
    expect(j.judge(note, 1.0)).toBe('perfect');
  });
  test('窗口严格嵌套', () => {
    const j = new Judge();
    const note = new Note(1.0, 0);
    expect(j.judge(note, 1.07)).toBe('great');
    expect(j.judge(note, 1.12)).toBe('good');
  });
  test('Miss重置连击', () => {
    const j = new Judge();
    const n1 = new Note(1.0, 0);
    const n2 = new Note(2.0, 0);
    j.judge(n1, 1.0);
    expect(j.combo).toBe(1);
    j.judge(n2, 3.0);
    expect(j.combo).toBe(0);
  });
  test('自动演奏全Perfect', () => {
    const j = new Judge();
    for (let i = 0; i < 10; i++) {
      const note = new Note(i * 0.5, 0);
      expect(j.judge(note, i * 0.5)).toBe('perfect');
    }
  });
  test('Early/Late判定', () => {
    const j = new Judge();
    const note = new Note(1.0, 0);
    expect(j.judge(note, 0.95)).toBe('perfect');
  });
  test('连击计数', () => {
    const j = new Judge();
    for (let i = 0; i < 5; i++) j.judge(new Note(i, 0), i);
    expect(j.combo).toBe(5);
  });

  // ---- 引擎边界不变量 ----
  test('判定基于时间差, 与下落速度/像素距离无关', () => {
    const j = new Judge();
    const note = new Note(1.0, 0);
    expect(j.hit(note, 1.0)).toBe('perfect');
    // 同一个时间差, 无论 speed 多大都必须是同一判定
    const j2 = new Judge();
    const n2 = new Note(1.0, 0);
    expect(n2.getPosition(1.0, 500)).toBe(0);
    expect(n2.getPosition(1.0, 2000)).toBe(0);
    expect(j2.hit(n2, 1.0 + 0.04)).toBe('perfect');
  });

  test('时间差判定: Perfect/Great/Good/Miss 边界正确', () => {
    const j = new Judge({ windows: { perfect: 40, great: 80, good: 120 } });
    const t = 1000;
    expect(j.grade(0)).toBe('perfect');
    expect(j.grade(40)).toBe('perfect');
    expect(j.grade(41)).toBe('great');
    expect(j.grade(80)).toBe('great');
    expect(j.grade(81)).toBe('good');
    expect(j.grade(120)).toBe('good');
    expect(j.grade(121)).toBe('miss');
    expect(j.grade(-80)).toBe('great'); // 早按同样按时间差判定
  });

  test('时间窗口可配置且严格嵌套, 非法配置直接拒绝', () => {
    const j = new Judge({ windows: { perfect: 20, great: 60, good: 100 } });
    expect(j.hit(new Note(0, 0), 15)).toBe('perfect');
    expect(j.hit(new Note(0, 0), 55)).toBe('great');
    expect(j.hit(new Note(0, 0), 95)).toBe('good');
    expect(() => new Judge({ windows: { perfect: 100, great: 50, good: 200 } })).toThrow();
    expect(() => new Judge({ windows: { perfect: 0, great: 50, good: 200 } })).toThrow();
    expect(() => new Judge({ windows: { perfect: 50, great: 50, good: 200 } })).toThrow();
  });

  test('输入记录精确到毫秒的时间戳而非帧序号', () => {
    let clock = 1000.25;
    const input = new InputTiming(() => clock);
    const entry = input.record(2);
    expect(entry.timeMs).toBe(1000.25);
    expect(entry.frame).toBeUndefined();
    expect(entry.lane).toBe(2);
    clock = 1016.5;
    input.record(0, { action: 'release' });
    expect(input.inputs[1].timeMs).toBe(1016.5);
    // 两次输入时间戳不同, 不再由数组下标伪造
    expect(input.inputs[1].timeMs - input.inputs[0].timeMs).toBeCloseTo(16.25, 5);
  });

  test('音符位置基于当前音频时间, 不依赖历史累积位移', () => {
    const note = new Note(2.0, 0);
    const speed = 300;
    expect(note.getPosition(2.0, speed)).toBe(0);
    expect(note.getPosition(1.5, speed)).toBeCloseTo(-150, 6);
    expect(note.getPosition(2.5, speed)).toBeCloseTo(150, 6);
    // 任意顺序/任意重复次数查询同一时间, 结果恒定(无累积)
    expect(note.getPosition(1.8, speed)).toBe(note.getPosition(1.8, speed));
    expect(note.getPosition(1.8, speed)).toBeCloseTo(-60, 6);
  });

  test('暂停时音符冻结, 恢复后从暂停位置继续且不跳变、不漏判', () => {
    const notes = [new Note(2.0, 0)];
    const j = new Judge({ notes });
    j.pause();
    expect(j.update(3.0)).toEqual([]); // 暂停期间即使墙上时间过线也不判 Miss
    expect(notes[0].judged).toBe(false);
    j.resume();
    expect(j.update(1.0)).toEqual([]); // 恢复后从音频时间 1.0 继续, 音符尚未到达
    expect(j.update(2.1)).toEqual([]); // 仍在 Good 窗口内, 不补判
    const missed = j.update(2.16); // 超过 Good 窗口才补判 Miss
    expect(missed).toHaveLength(1);
    expect(missed[0].grade).toBe('miss');

    let wall = 0;
    const clock = new AudioClock(() => wall);
    const note = new Note(1.0, 0);
    wall = 500;
    expect(clock.getTime()).toBeCloseTo(0.5, 6);
    clock.pause();
    wall = 5000; // 暂停期间墙上时间流逝
    expect(clock.getTime()).toBeCloseTo(0.5, 6);
    clock.resume();
    expect(clock.getTime()).toBeCloseTo(0.5, 6); // 恢复瞬间不跳变
    wall = 5600;
    expect(clock.getTime()).toBeCloseTo(1.1, 6);
    expect(note.getPosition(clock.getTime(), 400)).toBeCloseTo(40, 6);
  });

  test('同时到达的多个音符分别判定, 不合并不丢失', () => {
    const j = new Judge();
    const chord = [new Note(1.0, 0), new Note(1.0, 1), new Note(1.0, 2)];
    expect(j.hit(chord[0], 1.0)).toBe('perfect');
    expect(j.hit(chord[1], 1.09)).toBe('great');
    expect(j.hit(chord[2], 3.0)).toBe('miss');
    expect(j.results).toHaveLength(3);
    expect(j.results.map((r) => r.note.lane)).toEqual([0, 1, 2]);
    expect(chord.map((n) => n.judged)).toEqual([true, true, true]);

    // 通过 hitInput 按轨道匹配时也互不干扰
    const j2 = new Judge({ notes: [new Note(1.0, 0), new Note(1.0, 1)] });
    expect(j2.hitInput({ lane: 0 }, 1.0)).toBe('perfect');
    expect(j2.hitInput({ lane: 1 }, 1.0)).toBe('perfect');
    expect(j2.combo).toBe(2);
  });

  test('长键必须持续按住: 中途松开 Miss, 按满松开正常判定', () => {
    const j = new Judge();
    const hold = new Note(1.0, 0, { type: 'hold', endTime: 2.0 });
    expect(j.hit(hold, 1.0, { action: 'press' })).toBeNull();
    expect(hold.holding).toBe(true);
    expect(j.hit(hold, 1.5, { action: 'release' })).toBe('miss');
    expect(j.combo).toBe(0);

    const j2 = new Judge();
    const hold2 = new Note(1.0, 0, { type: 'hold', endTime: 2.0 });
    j2.hit(hold2, 1.0, { action: 'press' });
    expect(j2.hit(hold2, 2.0, { action: 'release' })).toBe('perfect');
    expect(j2.combo).toBe(1);

    // 跟踪到手指松开(heldLanes 移除)也立即 Miss
    const j3 = new Judge({
      notes: [new Note(1.0, 0, { type: 'hold', endTime: 2.0 })],
    });
    const h3 = j3.notes[0];
    j3.hit(h3, 1.0, { action: 'press' });
    const released = j3.update(1.4, new Set());
    expect(released).toHaveLength(1);
    expect(released[0].grade).toBe('miss');
  });

  test('长键提前按下判 Early Miss', () => {
    const j = new Judge();
    const hold = new Note(1.0, 0, { type: 'hold', endTime: 2.0 });
    expect(j.hit(hold, 0.5, { action: 'press' })).toBe('miss');
    expect(j.lastResult.earlyOrLate).toBe('early');
    expect(j.lastResult.reason).toBe('early');
    expect(hold.missed).toBe(true);
    expect(j.combo).toBe(0);
  });

  test('滑动音符跟踪位置, 偏离轨道超过阈值判 Miss', () => {
    const j = new Judge({ slideLaneThreshold: 0.6 });
    const slide = new Note(1.0, 2, { type: 'slide' });
    expect(j.hit(slide, 0.8, { position: { lane: 2 } })).toBeNull(); // 窗口外贴轨只跟踪
    expect(j.hit(slide, 1.0, { position: { lane: 2 } })).toBe('perfect');

    const j2 = new Judge({ slideLaneThreshold: 0.6 });
    const off = new Note(1.0, 2, { type: 'slide' });
    expect(j2.hit(off, 1.0, { position: { lane: 3 } })).toBe('miss');
    expect(j2.lastResult.reason).toBe('slide-off-track');

    const j3 = new Judge({ slideLaneThreshold: 0.6 });
    const edge = new Note(1.0, 2, { type: 'slide' });
    expect(j3.hit(edge, 1.0, { position: { lane: 2.6 } })).toBe('perfect');
  });

  test('判定结果立即反馈, 不延迟到下一帧', () => {
    const j = new Judge();
    const grade = j.hit(new Note(1.0, 0), 1.0);
    expect(grade).toBe('perfect');
    expect(j.results).toHaveLength(1); // 调用返回时结果已入账
    expect(j.score).toBe(300);
    expect(j.lastResult.hitTime).toBe(1.0);
  });

  test('自动演奏模式 100% Perfect', () => {
    const notes = [];
    for (let i = 0; i < 14; i++) {
      if (i % 5 === 1) notes.push(new Note(i * 0.1, 0, { type: 'hold', endTime: i * 0.1 + 0.12 }));
      else if (i % 4 === 3) notes.push(new Note(i * 0.1, 0, { type: 'slide' }));
      else notes.push(new Note(i * 0.1, 0));
    }
    const j = new Judge({ notes, auto: true });
    for (let t = 0; t <= 1.6; t += 0.01) j.update(Math.round(t * 100) / 100);
    expect(notes.every((n) => n.judged && n.judgement === 'perfect')).toBe(true);
    expect(j.counts.perfect).toBe(14);
    expect(j.counts.miss).toBe(0);
    expect(j.maxCombo).toBe(14);
  });

  test('Early/Late 判定方向正确', () => {
    const lateJudge = new Judge();
    lateJudge.hit(new Note(1.0, 0), 1.5);
    expect(lateJudge.lastResult.earlyOrLate).toBe('late');
    const earlyJudge = new Judge();
    earlyJudge.hit(new Note(1.0, 0), 0.5);
    expect(earlyJudge.lastResult.earlyOrLate).toBe('early');
  });

  test('连击计数递增且 Miss 后归零, getScore 返回完整计分', () => {
    const j = new Judge();
    j.hit(new Note(0, 0), 0);
    j.hit(new Note(1, 0), 1.06);
    j.hit(new Note(2, 0), 2.12);
    expect(j.combo).toBe(3);
    j.hit(new Note(3, 0), 5);
    expect(j.combo).toBe(0);
    j.hit(new Note(4, 0), 4);
    expect(j.combo).toBe(1);
    expect(j.maxCombo).toBe(3);
    const score = j.getScore();
    expect(score.score).toBe(900);
    expect(score.maxCombo).toBe(3);
    expect(score.counts).toEqual({ perfect: 2, great: 1, good: 1, miss: 1 });
    expect(score.totalJudged).toBe(5);
    expect(+score).toBe(900);
  });

  test('未按到的音符在窗口结束后由 update 补判 Miss', () => {
    const j = new Judge({ notes: [new Note(1.0, 0)] });
    expect(j.update(1.1)).toEqual([]);
    const missed = j.update(1.16);
    expect(missed).toHaveLength(1);
    expect(missed[0].grade).toBe('miss');
    expect(j.combo).toBe(0);
  });
});
