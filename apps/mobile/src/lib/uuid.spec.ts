import { uuidv7 } from './uuid';

const FIXED_RANDOM = new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa]);

describe('uuidv7', () => {
  it('version 7과 variant 10xx 비트가 설정된다', () => {
    const id = uuidv7(Date.now(), FIXED_RANDOM);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('앞 48비트에 unix ms 타임스탬프가 big-endian으로 인코딩된다', () => {
    const id = uuidv7(0x0123456789ab, FIXED_RANDOM);
    expect(id.startsWith('01234567-89ab')).toBe(true);
  });

  it('시간이 증가하면 문자열 정렬 순서도 증가한다 (time-ordered)', () => {
    const earlier = uuidv7(1_000_000, FIXED_RANDOM);
    const later = uuidv7(2_000_000, FIXED_RANDOM);
    expect(earlier < later).toBe(true);
  });

  it('UUID 포맷 (8-4-4-4-12)을 만족한다', () => {
    const id = uuidv7(Date.now(), FIXED_RANDOM);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
