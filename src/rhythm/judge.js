// 判定引擎：所有判定均基于"音符到达判定线的时间差"（秒），与像素、帧率无关。
// 时间基准来自音频时钟（getAudioTime），暂停时通过暂停补偿冻结谱面时间。

const DEFAULT_WINDOWS = { perfect: 0.05, great: 0.1, good: 0.15 };
const SCORES = { perfect: 300, great: 200, good: 100, miss: 0 };
const EPS = 1e-9;

class Judge {
  constructor(options = {}) {
    this.windows = Object.assign({}, DEFAULT_WINDOWS, options.windows);
    if (!(this.windows.perfect < this.windows.great) ||
        !(this.windows.great < this.windows.good)) {
      throw new Error('判定窗口必须严格嵌套: perfect < great < good');
    }
    this.slideThreshold = options.slideThreshold != null ? options.slideThreshold : 0.6;
    this.autoPlay = options.autoPlay === true;

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };

    this.notes = [];
    this.audioClock = options.getAudioTime || (() => 0);
    this.paused = false;
    this.pauseStartAudio = null;
    this.pausedOffset = 0;

    this.lastFeedback = null;
    this.onJudgment = options.onJudgment || null;
  }

  setNotes(notes) {
    this.notes = notes.slice();
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.paused = false;
    this.pauseStartAudio = null;
    this.pausedOffset = 0;
  }

  getAudioTime() {
    if (this.paused && this.pauseStartAudio != null) {
      return this.pauseStartAudio - this.pausedOffset;
    }
    return this.audioClock() - this.pausedOffset;
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.pauseStartAudio = this.audioClock();
  }

  resume() {
    if (!this.paused) return;
    // 把暂停段从音频时间里扣除，谱面时间继续，音符不跳变。
    this.pausedOffset += this.audioClock() - this.pauseStartAudio;
    this.paused = false;
    this.pauseStartAudio = null;
  }

  notePosition(note, speed) {
    return note.getPosition(this.getAudioTime(), speed);
  }

  // 纯时间差分级（公开兼容接口）：返回小写结果并更新分数/连击。
  judge(note, hitTime) {
    const { result } = this._resolve(hitTime - note.time);
    this._register(result);
    return result;
  }

  _resolve(delta) {
    const ad = Math.abs(delta);
    let result;
    if (ad <= this.windows.perfect + EPS) result = 'perfect';
    else if (ad <= this.windows.great + EPS) result = 'great';
    else if (ad <= this.windows.good + EPS) result = 'good';
    else result = 'miss';
    const timing = result === 'miss' ? null
      : (delta < -EPS ? 'early' : (delta > EPS ? 'late' : 'exact'));
    return { result, delta, timing };
  }

  _register(result) {
    if (result === 'miss') {
      this.combo = 0;
    } else {
      this.combo += 1;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    }
    this.score += SCORES[result] || 0;
    this.counts[result] = (this.counts[result] || 0) + 1;
  }

  _commit(note, result, delta, timing) {
    note.result = result;
    note.timing = timing;
    note.judgedAt = this.getAudioTime();
    note.hit = result !== 'miss';
    if (result === 'miss') note.missed = true;

    this._register(result);
    const feedback = {
      note,
      lane: note.lane,
      result,
      timing,
      delta,
      combo: this.combo,
      score: this.score,
    };
    this.lastFeedback = feedback;
    if (this.onJudgment) this.onJudgment(feedback);
    return feedback;
  }

  // 输入判定：lane + 毫秒时间戳（InputTiming.record 的返回/条目）。立即返回判定反馈。
  hitFromInput(input) {
    return this.hit(input.lane, input.timeSec != null ? input.timeSec : input.ms / 1000);
  }

  // 立即判定，不等待下一帧。
  hit(lane, hitTime) {
    if (this.paused) return null;
    if (hitTime == null) hitTime = this.getAudioTime();

    const pending = this.notes.filter((n) =>
      n.lane === lane && !n.result && n.endTime - hitTime > -this.windows.good - EPS);

    if (pending.length === 0) return { result: 'none', lane, delta: null, timing: null };

    pending.sort((a, b) =>
      Math.abs(hitTime - a.time) - Math.abs(hitTime - b.time));
    const note = pending[0];
    const delta = hitTime - note.time;

    // 提前按下：音符还远未进入判定窗口
    if (delta < -this.windows.good - EPS) {
      return { result: 'early', note, lane, delta, timing: 'early' };
    }

    if (note.type === 'hold') note.holding = true;
    if (note.type === 'slide') note.tracking = true;
    return this._commit(note, this._resolve(delta).result, delta, this._resolve(delta).timing);
  }

  releaseHold(lane, releaseTime) {
    if (releaseTime == null) releaseTime = this.getAudioTime();
    const hold = this.notes.find((n) =>
      n.type === 'hold' && n.lane === lane && n.holding && !n.completed);
    if (!hold) return { result: 'none' };

    hold.holding = false;
    if (releaseTime + EPS < hold.endTime - this.windows.good) {
      // 中途松开 -> Miss
      return this._commit(hold, 'miss', releaseTime - hold.endTime, null);
    }
    hold.completed = true;
    return this._notify(hold, 'hold-complete', releaseTime - hold.endTime, 'late');
  }

  // 滑动音符：持续跟踪手指/鼠标位置，偏离轨道超过阈值即 Miss。
  trackSlide(lane, posLane, trackTime) {
    if (trackTime == null) trackTime = this.getAudioTime();
    const slide = this.notes.find((n) =>
      n.type === 'slide' && n.lane === lane && n.tracking && !n.completed);
    if (!slide) return { result: 'none' };

    const expected = slide.expectedLane(trackTime);
    const deviation = Math.abs(posLane - expected);
    if (deviation > this.slideThreshold + EPS) {
      slide.tracking = false;
      return this._commit(slide, 'miss', deviation, null);
    }
    slide.lastDeviation = deviation;
    return { result: 'tracking', deviation };
  }

  _notify(note, kind, delta, timing) {
    const feedback = {
      note,
      lane: note.lane,
      result: kind,
      timing,
      delta,
      combo: this.combo,
      score: this.score,
    };
    this.lastFeedback = feedback;
    if (this.onJudgment) this.onJudgment(feedback);
    return feedback;
  }

  // 基于当前音频时间推进：过期未击 -> Miss；自动演奏 -> Perfect；长键/滑键到期收尾。
  // 当拍产生的判定当拍返回（立即反馈，不延迟到下一帧）。
  update(now) {
    if (this.paused) return [];
    if (now == null) now = this.getAudioTime();
    const feedbacks = [];

    if (this.autoPlay) this._autoplay(now, feedbacks);

    for (const note of this.notes) {
      if (note.result && !note.holding && !note.tracking) continue;

      if (note.type === 'hold' && note.holding) {
        if (now + EPS >= note.endTime - this.windows.good) {
          note.holding = false;
          note.completed = true;
          feedbacks.push(this._notify(note, 'hold-complete', now - note.endTime, 'late'));
        }
        continue;
      }

      if (note.type === 'slide' && note.tracking) {
        if (now + EPS >= note.endTime) {
          note.tracking = false;
          note.completed = true;
          feedbacks.push(this._notify(note, 'slide-complete', now - note.endTime, 'late'));
        }
        continue;
      }

      if (!note.result && now - note.time > this.windows.good + EPS) {
        const delta = now - note.time;
        feedbacks.push(this._commit(note, 'miss', delta, null));
      }
    }
    return feedbacks;
  }

  _autoplay(now, feedbacks) {
    for (const note of this.notes) {
      if (!note.result && now + EPS >= note.time) {
        if (note.type === 'hold') {
          note.holding = true;
          feedbacks.push(this._commit(note, 'perfect', 0, 'exact'));
        } else if (note.type === 'slide') {
          note.tracking = true;
          feedbacks.push(this._commit(note, 'perfect', 0, 'exact'));
        } else {
          feedbacks.push(this._commit(note, 'perfect', 0, 'exact'));
        }
      }
      if (note.result && !note.completed && (note.type === 'hold' || note.type === 'slide')) {
        if (now + EPS >= note.endTime) {
          note.holding = false;
          note.tracking = false;
          note.completed = true;
          feedbacks.push(this._notify(
            note, note.type === 'hold' ? 'hold-complete' : 'slide-complete', 0, 'exact'));
        }
      }
    }
  }

  getScore() {
    return this.score;
  }

  getStats() {
    return {
      score: this.score,
      combo: this.combo,
      maxCombo: this.maxCombo,
      counts: Object.assign({}, this.counts),
    };
  }
}

module.exports = { Judge, DEFAULT_WINDOWS };
