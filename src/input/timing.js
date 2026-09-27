class InputTiming {
  constructor(clock) {
    this.inputs = [];
    this._clock =
      clock ||
      (() =>
        typeof performance !== 'undefined' && performance.now
          ? performance.now()
          : Date.now());
  }

  // 记录精确到毫秒的时间戳(浮点毫秒), 不再使用帧序号
  record(lane, options = {}) {
    const entry = {
      lane,
      timeMs: this._clock(),
      action: options.action || 'press',
      position: options.position,
    };
    this.inputs.push(entry);
    return entry;
  }

  latest() {
    return this.inputs[this.inputs.length - 1] || null;
  }

  clear() {
    this.inputs = [];
  }
}

// 单一音频时间基准: 暂停区间被扣除, 恢复后从暂停位置继续, 不跳变
class AudioClock {
  constructor(now) {
    this._now =
      now ||
      (() =>
        typeof performance !== 'undefined' && performance.now
          ? performance.now()
          : Date.now());
    this._startWall = this._now();
    this._pausedAt = null;
    this._pausedTotal = 0;
    this.paused = false;
  }

  // 当前音频时间(秒)
  getTime() {
    const wall = this.paused ? this._pausedAt : this._now();
    return Math.max(0, (wall - this._startWall - this._pausedTotal) / 1000);
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this._pausedAt = this._now();
  }

  resume() {
    if (!this.paused) return;
    this._pausedTotal += this._now() - this._pausedAt;
    this.paused = false;
    this._pausedAt = null;
  }
}

module.exports = { InputTiming, AudioClock };
