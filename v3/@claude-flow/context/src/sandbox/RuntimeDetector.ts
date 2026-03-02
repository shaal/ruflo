/**
 * RuntimeDetector — Auto-detects the appropriate runtime for code snippets.
 *
 * Detection priority:
 *   1. Explicit hint
 *   2. Shebang line (#!/usr/bin/env python → python)
 *   3. Syntax heuristics (keyword patterns)
 *   4. Default: shell
 */
import { execFileSync } from 'node:child_process';

export type RuntimeType =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'shell'
  | 'ruby'
  | 'go'
  | 'rust'
  | 'php'
  | 'perl'
  | 'r'
  | 'elixir';

const RUNTIME_COMMANDS: Record<RuntimeType, string[]> = {
  javascript: ['node'],
  typescript: ['npx', 'tsx'],
  python: ['python3', 'python'],
  shell: ['sh'],
  ruby: ['ruby'],
  go: ['go', 'run'],
  rust: ['rustc'],
  php: ['php'],
  perl: ['perl'],
  r: ['Rscript'],
  elixir: ['elixir'],
};

const VALID_RUNTIMES = new Set<RuntimeType>([
  'javascript', 'typescript', 'python', 'shell', 'ruby',
  'go', 'rust', 'php', 'perl', 'r', 'elixir',
]);

const SHEBANG_MAP: Array<[pattern: RegExp, runtime: RuntimeType]> = [
  [/\bpython/, 'python'],
  [/\bnode/, 'javascript'],
  [/\bbun/, 'javascript'],
  [/\bdeno/, 'typescript'],
  [/\btsx/, 'typescript'],
  [/\bruby/, 'ruby'],
  [/\bperl/, 'perl'],
  [/\bphp/, 'php'],
  [/\belixir/, 'elixir'],
  [/\bbash/, 'shell'],
  [/\bzsh/, 'shell'],
  [/\bsh/, 'shell'],
];

/**
 * Heuristic rules: each rule is a pair of (test function, runtime).
 * First match wins. Order matters — more specific patterns first.
 */
const SYNTAX_HEURISTICS: Array<
  [test: (code: string) => boolean, runtime: RuntimeType]
> = [
  // TypeScript — interface with colon type annotations
  [
    (c) => /\binterface\s+\w+/.test(c) && /:\s*\w+/.test(c),
    'typescript',
  ],
  // Go — func keyword with package declaration
  [(c) => /\bfunc\s+/.test(c) && /\bpackage\s+/.test(c), 'go'],
  // Rust — fn keyword with let mut
  [(c) => /\bfn\s+/.test(c) && /\blet\s+mut\b/.test(c), 'rust'],
  // Ruby — class ... end pattern
  [(c) => /\bclass\s+/.test(c) && /\bend\b/.test(c), 'ruby'],
  // Elixir — defmodule
  [(c) => /\bdefmodule\s+/.test(c), 'elixir'],
  // PHP — <?php
  [(c) => /<\?php/.test(c), 'php'],
  // Perl — use strict or $variable
  [(c) => /\buse\s+strict\b/.test(c) || /\$\w+\s*=/.test(c), 'perl'],
  // R — <- assignment
  [(c) => /\w+\s*<-\s*/.test(c), 'r'],
  // Python — import + def, or print()
  [
    (c) =>
      (/\bimport\s+/.test(c) && /\bdef\s+/.test(c)) ||
      /\bprint\s*\(/.test(c),
    'python',
  ],
  // JavaScript — const, let, async, arrow functions
  [
    (c) =>
      /\bconst\s+/.test(c) ||
      /\basync\s+/.test(c) ||
      /=>\s*[{(]/.test(c),
    'javascript',
  ],
];

export class RuntimeDetector {
  /**
   * Detect the runtime for a code snippet.
   * @param code  The source code to analyze.
   * @param hint  Optional explicit runtime hint — used directly if provided.
   */
  detect(code: string, hint?: string): RuntimeType {
    if (hint) {
      if (VALID_RUNTIMES.has(hint as RuntimeType)) {
        return hint as RuntimeType;
      }
      // Invalid hint — fall through to auto-detection
    }

    // Shebang detection (first line only)
    const firstLine = code.split('\n', 1)[0] ?? '';
    if (firstLine.startsWith('#!')) {
      for (const [pattern, runtime] of SHEBANG_MAP) {
        if (pattern.test(firstLine)) {
          return runtime;
        }
      }
    }

    // Syntax heuristics
    for (const [test, runtime] of SYNTAX_HEURISTICS) {
      if (test(code)) {
        return runtime;
      }
    }

    // Default to shell
    return 'shell';
  }

  /**
   * Check whether a given runtime's interpreter is available on the system.
   */
  isAvailable(runtime: RuntimeType): boolean {
    const cmd = this.getCommand(runtime);
    try {
      execFileSync('which', [cmd], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Return the primary CLI command used to invoke the given runtime.
   */
  getCommand(runtime: RuntimeType): string {
    return RUNTIME_COMMANDS[runtime]?.[0] ?? runtime;
  }
}
