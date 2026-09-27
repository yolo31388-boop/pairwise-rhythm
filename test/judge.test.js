const { Judge } = require('../src/rhythm/judge.js');
const { Note } = require('../src/rhythm/note.js');
const { InputTiming } = require('../src/input/timing.js');

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
});

describe('引擎边界不变量', () => {
  const makeJudge = (notes, options = {}) => {
    let t = options.startTime || 0;
    const j = new Judge(Object.assign({ getAudioTime: () => t }, options));
    j.setNotes(notes);
    return { j, setTime: (v) => { t = v; }, getTime: () => t };
  };

  test('判定基于时间差而非像素：高速音符在同时间差下结果一致', () => {
    const slow = makeJudge([new Note(2, 0)]).j;
    const fast = makeJudge([new Note(2, 0)]).j;
    const n1 = new Note(2, 0);
    const n2 = new Note(2, 0);
    // 速度差 10 倍 => 像素位置差 10 倍，但判定完全相同
    expect(n1.getPosition(2.04, 300)).toBeCloseTo(12, 5);
    expect(n2.getPosition(2.04, 3000)).toBeCloseTo(120, 5);
    expect(slow.judge(n1, 2.04)).toBe('perfect');
    expect(fast.judge(n2, 2.04)).toBe('perfect');
    const n3 = new Note(2, 0);
    const n4 = new Note(2, 0);
    expect(slow.judge(n3, 2.12)).toBe('good');
    expect(fast.judge(n4, 2.12)).toBe('good');
  });

  test('时间窗口可配置且必须严格嵌套（perfect最小）', () => {
    const custom = new Judge({ windows: { perfect: 0.02, great: 0.06, good: 0.12 } });
    expect(custom.judge(new Note(1, 0), 1.015)).toBe('perfect');
    expect(custom.judge(new Note(1, 0), 1.03)).toBe('great');
    expect(custom.judge(new Note(1, 0), 1.08)).toBe('good');
    expect(custom.judge(new Note(1, 0), 1.2)).toBe('miss');
    expect(() => new Judge({ windows: { perfect: 0.2, great: 0.1, good: 0.15 } })).toThrow();
    expect(() => new Judge({ windows: { perfect: 0.05, great: 0.05, good: 0.15 } })).toThrow();
  });

  test('输入记录毫秒时间戳而非帧序号，并可换算谱面时间', () => {
    let now = 5000;
    const input = new InputTiming(() => now);
    const a = input.record(0);
    now = 5033;
    const b = input.record(1);
    expect(a.ms).toBe(5000);
    expect(b.ms).toBe(5033);
    expect(b.ms - a.ms).toBe(33);
    expect(a.frame).toBeUndefined();
    input.setOrigin(5000);
    expect(input.record(0).timeSec).toBeCloseTo(0.033, 3);
  });

  test('音符位置以当前音频时间为唯一基准（无累积位移）', () => {
    const note = new Note(2, 0);
    // 跳过中间帧、倒退音频时间都不会污染位置
    expect(note.getPosition(2, 500)).toBeCloseTo(0, 6);
    expect(note.getPosition(1.5, 500)).toBeCloseTo(-250, 6);
    expect(note.getPosition(2.2, 500)).toBeCloseTo(100, 6);
    expect(note.getPosition(1.5, 500)).toBeCloseTo(-250, 6);
  });

  test('暂停时音符冻结，恢复后从暂停位置继续且不跳变', () => {
    const note = new Note(5, 0);
    const { j, setTime } = makeJudge([note]);
    setTime(4.9);
    expect(j.notePosition(note, 400)).toBeCloseTo(-40, 6);
    j.pause();
    const frozenPos = j.notePosition(note, 400);
    setTime(5.05); // 墙上/音频时钟继续走
    expect(j.notePosition(note, 400)).toBeCloseTo(frozenPos, 6);
    expect(j.update(5.05)).toEqual([]); // 暂停期间不产生 Miss
    j.resume();
    setTime(5.08);
    expect(j.notePosition(note, 400)).toBeCloseTo(-28, 6); // 4.9 + 0.03，暂停的0.15s被扣除
    setTime(5.2);
    const feedbacks = j.update(5.2);
    expect(feedbacks.map((f) => f.result)).toEqual(['miss']);
  });

  test('同时到达的多个音符分别判定，不合并不丢失', () => {
    const notes = [new Note(1, 0), new Note(1, 1), new Note(1, 2)];
    const { j, setTime } = makeJudge(notes);
    setTime(1);
    const f0 = j.hit(0, 1);
    const f1 = j.hit(1, 1.07);
    const f2 = j.hit(2, 1.12);
    expect(f0.result).toBe('perfect');
    expect(f1.result).toBe('great');
    expect(f2.result).toBe('good');
    expect(notes.map((n) => n.result)).toEqual(['perfect', 'great', 'good']);
    expect(j.combo).toBe(3);
    expect(j.getScore()).toBe(600);
  });

  test('长键必须持续按住：提前按下Early，中途松开Miss，按满完成', () => {
    const early = new Note(1, 0, 'hold', { duration: 0.5 });
    const { j: je, setTime: te } = makeJudge([early]);
    te(0.8);
    expect(je.hit(0, 0.8).result).toBe('early');
    expect(early.result).toBeNull();

    const released = new Note(1, 0, 'hold', { duration: 0.5 });
    const { j: jr, setTime: tr } = makeJudge([released]);
    tr(1);
    expect(jr.hit(0, 1).result).toBe('perfect');
    tr(1.2);
    expect(jr.releaseHold(0, 1.2).result).toBe('miss');
    expect(jr.combo).toBe(0);

    const full = new Note(1, 0, 'hold', { duration: 0.5 });
    const { j: jf, setTime: tf } = makeJudge([full]);
    tf(1);
    jf.hit(0, 1);
    tf(1.5);
    expect(jf.update(1.5).map((f) => f.result)).toEqual(['hold-complete']);
  });

  test('滑动音符跟踪手指位置，偏离轨道超过阈值判Miss', () => {
    const slide = new Note(1, 0, 'slide', {
      duration: 0.5,
      path: [{ t: 1, lane: 0 }, { t: 1.5, lane: 2 }],
    });
    const { j, setTime } = makeJudge([slide], { slideThreshold: 0.6 });
    setTime(1);
    expect(j.hit(0, 1).result).toBe('perfect');
    setTime(1.25);
    expect(j.trackSlide(0, slide.expectedLane(1.25), 1.25).result).toBe('tracking');
    setTime(1.3);
    const off = j.trackSlide(0, slide.expectedLane(1.3) + 1, 1.3);
    expect(off.result).toBe('miss');
    expect(j.combo).toBe(0);
  });

  test('滑动音符沿轨道跟踪可完成', () => {
    const slide = new Note(1, 0, 'slide', {
      duration: 0.5,
      path: [{ t: 1, lane: 0 }, { t: 1.5, lane: 2 }],
    });
    const { j, setTime } = makeJudge([slide], { slideThreshold: 0.6 });
    setTime(1);
    j.hit(0, 1);
    for (let t = 1.05; t <= 1.5; t += 0.05) {
      setTime(t);
      const r = j.trackSlide(0, slide.expectedLane(t), t);
      expect(r.result).toBe('tracking');
    }
    expect(j.update(1.5).map((f) => f.result)).toEqual(['slide-complete']);
  });

  test('判定结果立即反馈，不延迟到下一帧（含回调与过期Miss）', () => {
    const calls = [];
    const note = new Note(1, 0);
    const { j, setTime } = makeJudge([note], { onJudgment: (f) => calls.push(f) });
    setTime(1);
    const feedback = j.hit(0, 1);
    expect(feedback.result).toBe('perfect');
    expect(j.lastFeedback).toBe(feedback);
    expect(calls).toHaveLength(1); // 同一次调用内同步回调
    expect(calls[0]).toBe(feedback);

    const calls2 = [];
    const n2 = new Note(2, 0);
    const ctx2 = makeJudge([n2], { onJudgment: (f) => calls2.push(f) });
    ctx2.setTime(2.2);
    const expired = ctx2.j.update(2.2);
    expect(expired.map((f) => f.result)).toEqual(['miss']); // 当拍即反馈
    expect(calls2).toHaveLength(1);
  });

  test('自动演奏模式100% Perfect（含长键与滑键，跨任意帧步进）', () => {
    const notes = [
      new Note(0.5, 0),
      new Note(1.37, 1),
      new Note(2.0, 0, 'hold', { duration: 0.5 }),
      new Note(2.0, 1, 'slide', { duration: 0.5, path: [{ t: 2, lane: 1 }, { t: 2.5, lane: 2 }] }),
    ];
    const { j, setTime } = makeJudge(notes, { autoPlay: true });
    // 故意用不规则大步进，验证不依赖逐帧采样
    [0.2, 0.9, 1.4, 2.0, 2.6].forEach((t) => { setTime(t); j.update(t); });
    expect(notes.every((n) => n.result === 'perfect')).toBe(true);
    const stats = j.getStats();
    expect(stats.counts.perfect).toBe(4);
    expect(stats.counts.miss + stats.counts.great + stats.counts.good).toBe(0);
    expect(stats.maxCombo).toBe(4);
  });

  test('Early/Late方向正确', () => {
    const note = new Note(1, 0);
    const { j, setTime } = makeJudge([note]);
    setTime(0.97);
    const early = j.hit(0, 0.97);
    expect(early.timing).toBe('early');
    const note2 = new Note(1, 1);
    j.notes.push(note2);
    const late = j.hit(1, 1.03);
    expect(late.timing).toBe('late');
    const note3 = new Note(1, 2);
    j.notes.push(note3);
    expect(j.hit(2, 1).timing).toBe('exact');
  });

  test('连击计数：命中累加，Miss清零，最大连击保留', () => {
    const notes = [0, 0.5, 1.0, 1.5, 2.0].map((t, i) => new Note(t, i % 2));
    const { j, setTime } = makeJudge(notes);
    setTime(0); j.hit(0, 0);
    setTime(0.5); j.hit(1, 0.5);
    setTime(1.0); j.hit(0, 1.0);
    expect(j.combo).toBe(3);
    setTime(1.7); j.update(1.7); // 1.5 的音符过期
    expect(j.combo).toBe(0);
    setTime(2.0); j.hit(0, 2.0);
    expect(j.combo).toBe(1);
    expect(j.getStats().maxCombo).toBe(3);
  });

  test('毫秒时间戳直接驱动判定（高BPM不漏判）', () => {
    let nowMs = 0;
    const input = new InputTiming(() => nowMs);
    const notes = [];
    for (let i = 0; i < 16; i++) notes.push(new Note(i * 0.125, i % 4)); // ~480 BPM 十六分
    const { j } = makeJudge(notes);
    notes.forEach((n) => {
      nowMs = Math.round(n.time * 1000) + 4; // 4ms 误差
      const entry = input.record(n.lane);
      const fb = j.hitFromInput(entry);
      expect(fb.result).toBe('perfect');
    });
    expect(j.getStats().counts.perfect).toBe(16);
    expect(j.combo).toBe(16);
  });
});
