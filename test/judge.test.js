
const { Judge } = require('../src/rhythm/judge.js');
const { Note } = require('../src/rhythm/note.js');

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
