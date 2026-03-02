/**
 * CredentialPassthrough — Environment variable allowlisting for sandbox processes.
 *
 * Security model: fail-closed. Only explicitly allowlisted variables from
 * the host process.env are passed to sandbox child processes. Unknown
 * variables are silently dropped.
 */

const DEFAULT_ENV_ALLOWLIST: readonly string[] = [
  // GitHub
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  // AWS
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_PROFILE',
  // Kubernetes
  'KUBECONFIG',
  'KUBECTL_CONTEXT',
  // Docker
  'DOCKER_HOST',
  'DOCKER_CONFIG',
  // General
  'HOME',
  'USER',
  'PATH',
  'SHELL',
  'LANG',
  'LC_ALL',
  // Node.js
  'NODE_PATH',
  'NODE_ENV',
  // Claude Flow
  'CLAUDE_FLOW_CONFIG',
  'CLAUDE_FLOW_MEMORY_PATH',
];

export class CredentialPassthrough {
  private readonly allowlist: Set<string>;

  constructor(customAllowlist?: string[]) {
    this.allowlist = new Set([
      ...DEFAULT_ENV_ALLOWLIST,
      ...(customAllowlist ?? []),
    ]);
  }

  /**
   * Build a filtered env object from process.env.
   * Only allowlisted keys are included. Additional overrides are merged last.
   */
  getPassthroughEnv(
    additional?: Record<string, string>,
  ): Record<string, string> {
    const env: Record<string, string> = {};

    for (const key of this.allowlist) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }

    if (additional) {
      Object.assign(env, additional);
    }

    return env;
  }

  isAllowed(key: string): boolean {
    return this.allowlist.has(key);
  }

  getAllowlist(): readonly string[] {
    return [...this.allowlist];
  }
}
