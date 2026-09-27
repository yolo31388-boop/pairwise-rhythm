
class Note {
  constructor(time, lane) { this.time=time; this.lane=lane; this.hit=false; this.missed=false; }
  getPosition(currentTime, speed) {
    // BUG: 累积位移而非基于音频时间
    return (currentTime - this.time) * speed;
  }
}

module.exports = { Note };
