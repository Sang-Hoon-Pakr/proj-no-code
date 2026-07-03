import { ReadMarker } from './read-marker';

describe('ReadMarker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('notify 후 1초 디바운스가 지나야 전송한다', () => {
    const send = jest.fn(() => Promise.resolve());
    const marker = new ReadMarker(send);
    marker.notify(5);
    jest.advanceTimersByTime(999);
    expect(send).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledWith(5);
  });

  it('디바운스 내 연속 notify는 최대 seq 1건만 전송한다 (batch)', () => {
    const send = jest.fn(() => Promise.resolve());
    const marker = new ReadMarker(send);
    marker.notify(3);
    marker.notify(7);
    marker.notify(5);
    jest.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(7);
  });

  it('이미 마크한 seq 이하는 다시 전송하지 않는다', async () => {
    const send = jest.fn(() => Promise.resolve());
    const marker = new ReadMarker(send);
    marker.notify(5);
    jest.advanceTimersByTime(1000);
    await Promise.resolve(); // sendMark then 처리
    marker.notify(5);
    marker.notify(4);
    jest.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('flush는 디바운스 대기 없이 즉시 전송한다', () => {
    const send = jest.fn(() => Promise.resolve());
    const marker = new ReadMarker(send);
    marker.notify(9);
    marker.flush();
    expect(send).toHaveBeenCalledWith(9);
  });

  it('전송 실패 시 다음 notify에서 같은 seq를 재시도할 수 있다', async () => {
    const send = jest
      .fn<Promise<void>, [number]>()
      .mockRejectedValueOnce(new Error('DISCONNECTED'))
      .mockResolvedValue(undefined);
    const marker = new ReadMarker(send);
    marker.notify(5);
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve(); // rejection catch 처리
    marker.notify(6);
    jest.advanceTimersByTime(1000);
    expect(send).toHaveBeenLastCalledWith(6);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
