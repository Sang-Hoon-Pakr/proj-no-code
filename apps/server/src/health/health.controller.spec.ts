import { describe, it, expect } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController();

  it('returns ok status', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
  });

  it('returns ISO 8601 UTC timestamp', () => {
    const result = controller.check();
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
