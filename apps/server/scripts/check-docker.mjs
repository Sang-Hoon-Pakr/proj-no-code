#!/usr/bin/env node
// Pre-flight: 통합 테스트 진입 전 Docker daemon 가용성 검사.
// 정책: .claude/environment-rules.md (Docker 절) 참조.
import { execSync } from 'node:child_process';

try {
  execSync('docker info --format "{{.ServerVersion}}"', { stdio: 'pipe' });
  process.exit(0);
} catch {
  process.stderr.write(
    [
      '',
      '[check-docker] Docker daemon이 응답하지 않습니다.',
      '',
      '통합 테스트는 Testcontainers로 PostgreSQL/Redis 컨테이너를 띄웁니다.',
      'macOS:   open -a Docker      (Docker Desktop)',
      '         orb start            (OrbStack)',
      '         colima start         (Colima)',
      'Linux:   sudo systemctl start docker',
      '',
      'daemon이 뜬 뒤 다시 시도하세요.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
