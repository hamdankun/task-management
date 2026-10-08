import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('should default to loopback, port 3001 and the local host allowlist', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      HOST: '127.0.0.1',
      PORT: 3001,
      ALLOWED_HOSTS: ['localhost', '127.0.0.1', '[::1]'],
    });
    expect(c.DB_PATH.endsWith('apps/api/data/app.db')).toBe(true);
  });

  it('should read overrides and trim the allowed host list', () => {
    expect(
      loadConfig({ PORT: '4000', ALLOWED_HOSTS: ' a.test , b.test ,', DB_PATH: ':memory:' }),
    ).toMatchObject({
      PORT: 4000,
      ALLOWED_HOSTS: ['a.test', 'b.test'],
      DB_PATH: ':memory:',
    });
  });

  it.each(['0', '70000', 'abc', '3001.5'])(
    'should reject PORT=%s naming the variable but not the value',
    (port) => {
      expect(() => loadConfig({ PORT: port })).toThrow('Invalid configuration: PORT');
      try {
        loadConfig({ PORT: port });
      } catch (e) {
        expect((e as Error).message).not.toContain(port === 'abc' ? 'abc' : `: ${port}`);
      }
    },
  );
});
