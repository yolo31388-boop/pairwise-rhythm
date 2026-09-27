
class Judge {
  constructor() { this.windows = {perfect: 0.05, great: 0.1, good: 0.15}; this.score=0; this.combo=0; }
  judge(note, hitTime) {
    // BUG: 用像素距离而非时间差
    const diff = Math.abs(hitTime - note.time);
    if (diff < this.windows.perfect) { this.score += 300; this.combo++; return 'perfect'; }
    if (diff < this.windows.great) { this.score += 200; this.combo++; return 'great'; }
    if (diff < this.windows.good) { this.score += 100; this.combo++; return 'good'; }
    this.combo = 0;
    return 'miss';
  }
}

module.exports = { Judge };
