import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CredentialPassthrough } from '../../src/sandbox/CredentialPassthrough.js';

describe('CredentialPassthrough', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('default allowlist', () => {
    it('should include HOME and PATH', () => {
      const cp = new CredentialPassthrough();
      expect(cp.isAllowed('HOME')).toBe(true);
      expect(cp.isAllowed('PATH')).toBe(true);
    });

    it('should include GITHUB_TOKEN', () => {
      const cp = new CredentialPassthrough();
      expect(cp.isAllowed('GITHUB_TOKEN')).toBe(true);
      expect(cp.isAllowed('GH_TOKEN')).toBe(true);
    });

    it('should include AWS credentials', () => {
      const cp = new CredentialPassthrough();
      expect(cp.isAllowed('AWS_ACCESS_KEY_ID')).toBe(true);
      expect(cp.isAllowed('AWS_SECRET_ACCESS_KEY')).toBe(true);
      expect(cp.isAllowed('AWS_REGION')).toBe(true);
    });

    it('should include Claude Flow config vars', () => {
      const cp = new CredentialPassthrough();
      expect(cp.isAllowed('CLAUDE_FLOW_CONFIG')).toBe(true);
      expect(cp.isAllowed('CLAUDE_FLOW_MEMORY_PATH')).toBe(true);
    });
  });

  describe('isAllowed', () => {
    it('should reject non-allowlisted variables', () => {
      const cp = new CredentialPassthrough();
      expect(cp.isAllowed('MY_SECRET_KEY')).toBe(false);
      expect(cp.isAllowed('DATABASE_PASSWORD')).toBe(false);
      expect(cp.isAllowed('PRIVATE_TOKEN')).toBe(false);
    });
  });

  describe('getPassthroughEnv', () => {
    it('should only include allowlisted vars that exist in process.env', () => {
      process.env = {
        HOME: '/home/test',
        PATH: '/usr/bin',
        MY_SECRET: 'should-not-appear',
        DATABASE_URL: 'postgres://secret',
      };

      const cp = new CredentialPassthrough();
      const env = cp.getPassthroughEnv();

      expect(env.HOME).toBe('/home/test');
      expect(env.PATH).toBe('/usr/bin');
      expect(env.MY_SECRET).toBeUndefined();
      expect(env.DATABASE_URL).toBeUndefined();
    });

    it('should return empty env when no allowlisted vars exist in process.env', () => {
      process.env = {
        RANDOM_VAR: 'value',
        ANOTHER_SECRET: 'hidden',
      };

      const cp = new CredentialPassthrough();
      const env = cp.getPassthroughEnv();

      expect(Object.keys(env)).toHaveLength(0);
    });

    it('should merge additional env vars', () => {
      process.env = { HOME: '/home/test' };

      const cp = new CredentialPassthrough();
      const env = cp.getPassthroughEnv({ CUSTOM_VAR: 'custom-value' });

      expect(env.HOME).toBe('/home/test');
      expect(env.CUSTOM_VAR).toBe('custom-value');
    });

    it('should let additional vars override allowlisted ones', () => {
      process.env = { HOME: '/home/original' };

      const cp = new CredentialPassthrough();
      const env = cp.getPassthroughEnv({ HOME: '/home/override' });

      expect(env.HOME).toBe('/home/override');
    });
  });

  describe('custom allowlist', () => {
    it('should merge custom allowlist with defaults', () => {
      const cp = new CredentialPassthrough(['MY_CUSTOM_VAR', 'ANOTHER_VAR']);

      expect(cp.isAllowed('MY_CUSTOM_VAR')).toBe(true);
      expect(cp.isAllowed('ANOTHER_VAR')).toBe(true);
      // Defaults still present
      expect(cp.isAllowed('HOME')).toBe(true);
      expect(cp.isAllowed('PATH')).toBe(true);
    });

    it('should pass custom vars through getPassthroughEnv', () => {
      process.env = {
        MY_CUSTOM_VAR: 'custom-value',
        HOME: '/home/test',
      };

      const cp = new CredentialPassthrough(['MY_CUSTOM_VAR']);
      const env = cp.getPassthroughEnv();

      expect(env.MY_CUSTOM_VAR).toBe('custom-value');
      expect(env.HOME).toBe('/home/test');
    });
  });

  describe('getAllowlist', () => {
    it('should return all allowlisted keys', () => {
      const cp = new CredentialPassthrough(['EXTRA']);
      const list = cp.getAllowlist();

      expect(list).toContain('HOME');
      expect(list).toContain('PATH');
      expect(list).toContain('EXTRA');
      expect(list).toContain('GITHUB_TOKEN');
    });
  });
});
