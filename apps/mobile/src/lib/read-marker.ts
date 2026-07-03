// realtime-rules.md: read receipt는 batch — 1초 디바운스 후 전송.
const READ_MARK_DEBOUNCE_MS = 1000;

type SendReadMark = (seq: number) => Promise<void>;

// 전송 함수 주입식 — 유닛 테스트는 fake timers + mock 함수로 소켓 없이 검증.
export class ReadMarker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastMarkedSeq = 0;
  private pendingSeq = 0;

  constructor(
    private readonly sendMark: SendReadMark,
    private readonly debounceMs: number = READ_MARK_DEBOUNCE_MS,
  ) {}

  // 화면에서 본 최신 seq 알림. 디바운스 후 최대 seq 1건만 전송.
  notify(seq: number): void {
    if (seq <= this.lastMarkedSeq) return;
    this.pendingSeq = Math.max(this.pendingSeq, seq);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fire();
    }, this.debounceMs);
  }

  // 방 이탈 등 — 디바운스 대기 없이 즉시 전송.
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.fire();
  }

  private fire(): void {
    const seq = this.pendingSeq;
    if (seq <= this.lastMarkedSeq) return;
    void this.sendMark(seq)
      .then(() => {
        this.lastMarkedSeq = Math.max(this.lastMarkedSeq, seq);
      })
      .catch((e: unknown) => {
        // 전송 실패 시 lastMarkedSeq를 안 올림 — 다음 notify가 자연 재시도.
        if (__DEV__) console.warn('[ReadMarker] send failed', e);
      });
  }
}
