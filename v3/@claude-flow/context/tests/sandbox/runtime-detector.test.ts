import { describe, it, expect } from 'vitest';
import { RuntimeDetector } from '../../src/sandbox/RuntimeDetector.js';

describe('RuntimeDetector', () => {
  const detector = new RuntimeDetector();

  describe('detect — hint override', () => {
    it('should use hint directly when provided', () => {
      expect(detector.detect('anything here', 'python')).toBe('python');
      expect(detector.detect('const x = 1', 'ruby')).toBe('ruby');
    });
  });

  describe('detect — shebang detection', () => {
    it('should detect python from shebang', () => {
      const code = '#!/usr/bin/env python3\nprint("hello")';
      expect(detector.detect(code)).toBe('python');
    });

    it('should detect node/javascript from shebang', () => {
      const code = '#!/usr/bin/env node\nconsole.log("hi")';
      expect(detector.detect(code)).toBe('javascript');
    });

    it('should detect bash as shell from shebang', () => {
      const code = '#!/bin/bash\necho "hello"';
      expect(detector.detect(code)).toBe('shell');
    });

    it('should detect ruby from shebang', () => {
      const code = '#!/usr/bin/env ruby\nputs "hello"';
      expect(detector.detect(code)).toBe('ruby');
    });

    it('should detect perl from shebang', () => {
      const code = '#!/usr/bin/perl\nprint "hello\\n";';
      expect(detector.detect(code)).toBe('perl');
    });

    it('should detect typescript from deno shebang', () => {
      const code = '#!/usr/bin/env deno\nconst x: number = 1;';
      expect(detector.detect(code)).toBe('typescript');
    });
  });

  describe('detect — syntax heuristics', () => {
    it('should detect python from import + def pattern', () => {
      const code = 'import os\n\ndef main():\n    pass';
      expect(detector.detect(code)).toBe('python');
    });

    it('should detect python from print()', () => {
      const code = 'print("hello world")';
      expect(detector.detect(code)).toBe('python');
    });

    it('should detect javascript from const keyword', () => {
      const code = 'const greeting = "hello";\nconsole.log(greeting);';
      expect(detector.detect(code)).toBe('javascript');
    });

    it('should detect javascript from async keyword', () => {
      const code = 'async function fetchData() { return 42; }';
      expect(detector.detect(code)).toBe('javascript');
    });

    it('should detect javascript from arrow function', () => {
      const code = 'const add = (a, b) => { return a + b; };';
      expect(detector.detect(code)).toBe('javascript');
    });

    it('should detect typescript from interface with type annotations', () => {
      const code = 'interface User {\n  name: string;\n  age: number;\n}';
      expect(detector.detect(code)).toBe('typescript');
    });

    it('should detect go from func + package keywords', () => {
      const code =
        'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hello")\n}';
      expect(detector.detect(code)).toBe('go');
    });

    it('should detect rust from fn + let mut', () => {
      const code = 'fn main() {\n    let mut x = 5;\n    x += 1;\n}';
      expect(detector.detect(code)).toBe('rust');
    });

    it('should detect ruby from class + end', () => {
      const code = 'class Dog\n  def bark\n    "woof"\n  end\nend';
      expect(detector.detect(code)).toBe('ruby');
    });

    it('should detect PHP from <?php', () => {
      const code = '<?php echo "Hello"; ?>';
      expect(detector.detect(code)).toBe('php');
    });

    it('should detect elixir from defmodule', () => {
      const code = 'defmodule Hello do\n  def greet, do: "hi"\nend';
      expect(detector.detect(code)).toBe('elixir');
    });

    it('should detect R from <- assignment', () => {
      const code = 'x <- c(1, 2, 3)\nmean(x)';
      expect(detector.detect(code)).toBe('r');
    });
  });

  describe('detect — default to shell', () => {
    it('should default to shell for unrecognized code', () => {
      expect(detector.detect('echo hello')).toBe('shell');
      expect(detector.detect('ls -la')).toBe('shell');
      expect(detector.detect('cat /etc/hosts')).toBe('shell');
    });

    it('should default to shell for empty string', () => {
      expect(detector.detect('')).toBe('shell');
    });
  });

  describe('isAvailable', () => {
    it('should return true for node', () => {
      expect(detector.isAvailable('javascript')).toBe(true);
    });

    it('should return true for python3', () => {
      // python3 is typically available on macOS/Linux
      expect(detector.isAvailable('python')).toBe(true);
    });

    it('should return true for sh', () => {
      expect(detector.isAvailable('shell')).toBe(true);
    });
  });

  describe('getCommand', () => {
    it('should return node for javascript', () => {
      expect(detector.getCommand('javascript')).toBe('node');
    });

    it('should return python3 for python', () => {
      expect(detector.getCommand('python')).toBe('python3');
    });

    it('should return sh for shell', () => {
      expect(detector.getCommand('shell')).toBe('sh');
    });

    it('should return ruby for ruby', () => {
      expect(detector.getCommand('ruby')).toBe('ruby');
    });
  });
});
