
class InputTiming {
  constructor() { this.inputs = []; }
  record(lane) {
    // BUG: 用帧序号而非毫秒时间戳
    this.inputs.push({lane, frame: this.inputs.length});
  }
}

module.exports = { InputTiming };
