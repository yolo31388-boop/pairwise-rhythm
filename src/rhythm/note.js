class Note {
  // time 为音符到达判定线的音频时间(秒); type: tap | hold | slide
  constructor(time, lane, options = {}) {
    this.time = time;
    this.lane = lane;
    this.type = options.type || 'tap';
    this.endTime = options.endTime != null ? options.endTime : time;
    this.hit = false;
    this.missed = false;
    this.judged = false;
    this.judgement = null;
    this.holding = false;
  }

  // 位置直接由当前音频时间计算(判定线处为 0, 线上为负、过线为正),
  // 不做帧间累积, 因此任何时刻重算结果一致, 暂停/恢复也不会跳变
  getPosition(currentTime, speed) {
    return (currentTime - this.time) * speed;
  }
}

module.exports = { Note };
