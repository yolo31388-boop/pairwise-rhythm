// 输入采样：记录精确到毫秒的时间戳（clock 可注入，默认 performance.now/Date.now）。
// 判定只认时间戳，不认帧序号。

class InputTiming {
  constructor(clock) {
    if (typeof clock === 'function') {
      this.clock = clock;
    } else if (clock && typeof clock.now === 'function') {
      this.clock = () => clock.now();
    } else {
      this.clock = () => Date.now();
    }
    this.inputs = [];
    this.originMs = 0; // 音频起点对应的墙上时间（毫秒），用于换算谱面时间
  }

  setOrigin(originMs) {
    this.originMs = originMs;
  }

  // 返回毫秒时间戳条目（四舍五入到整毫秒）。
  record(lane, type = 'tap', posLane) {
    const ms = Math.round(this.clock());
    const entry = {
      lane,
      type,
      posLane: posLane != null ? posLane : lane,
      ms,
      timeSec: (ms - this.originMs) / 1000,
    };
    this.inputs.push(entry);
    return entry;
  }

  move(lane, posLane) {
    return this.record(lane, 'move', posLane);
  }

  release(lane) {
    return this.record(lane, 'release', lane);
  }

  since(ms) {
    return this.inputs.filter((i) => i.ms >= ms);
  }

  clear() {
    this.inputs = [];
  }
}

module.exports = { InputTiming };
