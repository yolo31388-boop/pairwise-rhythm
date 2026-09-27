// 音符：位置由"当前音频时间"直接推导，不做任何帧间累积位移。
// 同一音频时间 + 同一速度永远得到同一位置，天然支持暂停冻结与恢复。

class Note {
  constructor(time, lane, type = 'tap', options = {}) {
    this.time = time;                 // 到达判定线的音频时间（秒）
    this.lane = lane;
    this.type = type;                 // 'tap' | 'hold' | 'slide'
    this.duration = options.duration || 0;
    this.endTime = type === 'hold' ? time + this.duration : (options.endTime || time);

    this.path = options.path || null; // slide 路径: [{t, lane}], 缺省为直线到目标 lane

    this.hit = false;
    this.missed = false;
    this.result = null;
    this.timing = null;
    this.judgedAt = null;
    this.holding = false;
    this.tracking = false;
    this.completed = false;
    this.lastDeviation = null;
  }

  // 相对判定线的位置（像素，speed = 像素/秒）。纯函数：只依赖 currentTime。
  getPosition(currentTime, speed) {
    return (currentTime - this.time) * speed;
  }

  // slide 在给定音频时间应在的轨道位置（分段线性插值）。
  expectedLane(atTime) {
    const endT = this.endTime || this.time;
    if (!this.path) {
      const endLane = this.duration ? this.lane : this.lane;
      return endLane;
    }
    const points = this.path.slice().sort((a, b) => a.t - b.t);
    if (atTime <= points[0].t) return points[0].lane;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (atTime >= a.t && atTime <= b.t) {
        const ratio = b.t === a.t ? 0 : (atTime - a.t) / (b.t - a.t);
        return a.lane + (b.lane - a.lane) * ratio;
      }
    }
    return points[points.length - 1].lane;
  }
}

module.exports = { Note };
