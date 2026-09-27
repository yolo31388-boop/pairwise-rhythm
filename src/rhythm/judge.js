const DEFAULT_WINDOWS = { perfect: 0.05, great: 0.1, good: 0.15 };
const DEFAULT_SCORES = { perfect: 300, great: 200, good: 100, miss: 0 };
const EPS = 1e-6;

class Judge {
  constructor(options = {}) {
    this.windows = { ...DEFAULT_WINDOWS, ...(options.windows || {}) };
    this.scores = { ...DEFAULT_SCORES, ...(options.scores || {}) };
    this.slideLaneThreshold =
      options.slideLaneThreshold != null ? options.slideLaneThreshold : 0.6;
    this.auto = !!options.auto;
    this.notes = options.notes ? options.notes.slice() : [];
    this._validateWindows();

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.results = [];
    this.lastResult = null;
    this.paused = false;
  }

  setChart(notes) {
    this.notes = notes.slice();
    return this;
  }

  _validateWindows() {
    const w = this.windows;
    if (!(w.perfect > 0) || !(w.great > w.perfect) || !(w.good > w.great)) {
      throw new Error('判定窗口必须为正数且严格嵌套: perfect < great < good');
    }
  }

  grade(delta) {
    const d = Math.abs(delta);
    if (d <= this.windows.perfect + EPS) return 'perfect';
    if (d <= this.windows.great + EPS) return 'great';
    if (d <= this.windows.good + EPS) return 'good';
    return 'miss';
  }

  _apply(note, grade, hitTime, extra = {}) {
    if (note) {
      note.hit = grade !== 'miss';
      note.missed = grade === 'miss';
      note.judged = true;
      note.judgement = grade;
      note.holding = false;
    }
    if (grade === 'miss') {
      this.combo = 0;
    } else {
      this.combo += 1;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += this.scores[grade];
    }
    this.counts[grade] += 1;
    const delta = note ? hitTime - note.time : null;
    const result = {
      note: note || null,
      grade,
      hitTime,
      delta,
      earlyOrLate:
        grade === 'miss' ? (delta < -EPS ? 'early' : 'late') : null,
      ...extra,
    };
    this.results.push(result);
    this.lastResult = result;
    return result;
  }

  // 公开入口: 基于“输入时间 - 音符到达时间”的时间差判定, 与像素/速度无关
  hit(note, hitTime, options = {}) {
    const result = this._route(note, hitTime, options);
    return result ? result.grade : null;
  }

  judge(note, hitTime) {
    return this.hit(note, hitTime);
  }

  // 按轨道匹配的输入入口, 同时到达的多个音符各自独立调用、分别判定
  hitInput(input, audioTime) {
    const action = input.action || 'press';
    let candidates = this.notes.filter((n) => !n.judged && n.lane === input.lane);
    if (action === 'release') {
      candidates = candidates.filter((n) => n.type === 'hold' && n.holding);
    }
    let note = null;
    let best = Infinity;
    for (const candidate of candidates) {
      const ref =
        action === 'release' && candidate.type === 'hold'
          ? candidate.endTime
          : candidate.time;
      const distance = Math.abs(ref - audioTime);
      if (distance < best) {
        best = distance;
        note = candidate;
      }
    }
    if (!note) return null;
    if (note.type !== 'hold' && audioTime < note.time - this.windows.good - EPS) {
      // 普通音符过早的输入忽略, 留给后续音符
      return null;
    }
    const result = this._route(note, audioTime, {
      action,
      position: input.position,
    });
    return result ? result.grade : null;
  }

  _route(note, hitTime, options) {
    // 显式 hit() 是直接判定调用, 允许重判(旧公开行为);
    // 自动匹配(hitInput/update)在候选过滤阶段已排除已判定音符
    if (!note) return null;
    if (note.type === 'hold') return this._hitHold(note, hitTime, options.action);
    if (note.type === 'slide') {
      return this._hitSlide(
        note,
        hitTime,
        options.position != null ? options.position : note.lane,
      );
    }
    return this._hitTap(note, hitTime);
  }

  _hitTap(note, hitTime) {
    const delta = hitTime - note.time;
    return this._apply(note, this.grade(delta), hitTime);
  }

  _hitHold(note, hitTime, action = 'press') {
    if (action === 'release') {
      if (!note.holding) return null;
      note.holding = false;
      // 必须持续按住: 未到长键尾部就松开 => Miss
      if (hitTime + EPS < note.endTime) {
        return this._apply(note, 'miss', hitTime, { reason: 'released-early' });
      }
      return this._apply(note, this.grade(hitTime - note.endTime), hitTime, {
        part: 'tail',
      });
    }

    const delta = hitTime - note.time;
    // 提前按下 => Early Miss
    if (delta < -this.windows.good - EPS) {
      return this._apply(note, 'miss', hitTime, { reason: 'early' });
    }
    const grade = this.grade(delta);
    if (grade === 'miss') {
      return this._apply(note, 'miss', hitTime, { reason: 'late' });
    }
    // 头部通过, 进入持续按住跟踪, 最终判定等松开/自动补全时给出
    note.holding = true;
    return null;
  }

  _hitSlide(note, hitTime, position) {
    const lane =
      position && typeof position === 'object' ? position.lane : position;
    if (lane == null) return null;
    const deviation = Math.abs(lane - note.lane);
    // 偏离轨道超过阈值 => Miss
    if (deviation > this.slideLaneThreshold + EPS) {
      return this._apply(note, 'miss', hitTime, {
        reason: 'slide-off-track',
        deviation,
      });
    }
    const delta = hitTime - note.time;
    if (Math.abs(delta) <= this.windows.good + EPS) {
      return this._apply(note, this.grade(delta), hitTime, { deviation });
    }
    // 窗口外的贴轨滑动只做跟踪, 不出判定
    return null;
  }

  // 每帧推进: 自动演奏、漏判补判; 暂停时直接冻结, 不产生任何判定
  update(audioTime, heldLanes) {
    if (this.paused) return [];
    const out = [];

    if (this.auto) {
      for (const note of this.notes) {
        if (note.judged) continue;
        if (note.type === 'hold') {
          if (!note.holding && audioTime + EPS >= note.time) note.holding = true;
          if (note.holding && audioTime + EPS >= note.endTime) {
            note.holding = false;
            out.push(
              this._apply(note, 'perfect', note.endTime, {
                part: 'tail',
                auto: true,
              }),
            );
          }
        } else if (audioTime + EPS >= note.time) {
          out.push(this._apply(note, 'perfect', note.time, { auto: true }));
        }
      }
      return out;
    }

    const held =
      heldLanes instanceof Set
        ? heldLanes
        : Array.isArray(heldLanes)
          ? new Set(heldLanes)
          : null;
    if (held) {
      for (const note of this.notes) {
        if (note.holding && !held.has(note.lane)) {
          note.holding = false;
          out.push(
            this._apply(note, 'miss', audioTime, { reason: 'released-early' }),
          );
        }
      }
    }

    for (const note of this.notes) {
      if (note.judged) continue;
      if (note.type === 'hold') {
        if (note.holding) {
          if (audioTime > note.endTime + this.windows.good + EPS) {
            out.push(
              this._apply(note, 'miss', audioTime, { reason: 'incomplete' }),
            );
          }
        } else if (audioTime > note.time + this.windows.good + EPS) {
          out.push(this._apply(note, 'miss', audioTime, { reason: 'late' }));
        }
      } else if (audioTime > note.time + this.windows.good + EPS) {
        out.push(this._apply(note, 'miss', audioTime, { reason: 'late' }));
      }
    }
    return out;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  getScore() {
    return {
      score: this.score,
      combo: this.combo,
      maxCombo: this.maxCombo,
      counts: { ...this.counts },
      totalJudged: this.results.length,
      valueOf() {
        return this.score;
      },
      toString() {
        return String(this.score);
      },
    };
  }
}

module.exports = { Judge, DEFAULT_WINDOWS, DEFAULT_SCORES };
