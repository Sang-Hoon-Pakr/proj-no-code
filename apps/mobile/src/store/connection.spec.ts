import { useConnection } from './connection';

describe('useConnection store', () => {
  beforeEach(() => {
    useConnection.setState({ status: 'disconnected', consecutiveFailures: 0, showBanner: false });
  });

  it('실패 4회까지는 배너를 띄우지 않는다', () => {
    for (let i = 0; i < 4; i++) useConnection.getState().recordFailure();
    expect(useConnection.getState().showBanner).toBe(false);
  });

  it('연속 5회 실패 시 연결 끊김 배너를 띄운다 (realtime-rules)', () => {
    for (let i = 0; i < 5; i++) useConnection.getState().recordFailure();
    expect(useConnection.getState().showBanner).toBe(true);
  });

  it('연결 성공 시 실패 카운트와 배너가 리셋된다', () => {
    for (let i = 0; i < 5; i++) useConnection.getState().recordFailure();
    useConnection.getState().setConnected();
    expect(useConnection.getState().showBanner).toBe(false);
    expect(useConnection.getState().consecutiveFailures).toBe(0);
  });
});
