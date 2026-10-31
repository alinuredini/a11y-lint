import type { IRDocument, IRElement } from './ir.js';
import type { Level } from './wcag.js';

/** `fail`: a definite violation. `unknown`: depends on runtime values or human judgement. */
export type Status = 'fail' | 'unknown';

export interface Finding {
  ruleId: string;
  criteria: string[];
  level: Level;
  status: Status;
  message: string;
  file: string;
  line: number;
  column: number;
  source: 'static' | 'contrast' | 'runtime';
}

export interface RuleContext {
  doc: IRDocument;
  target: Level;
  /** `criteria` overrides the rule's own list for this one finding. */
  report(el: IRElement, status: Status, message: string, criteria?: string[]): void;
}

export interface Rule {
  id: string;
  description: string;
  criteria: string[];
  /** Called once per non-component element. */
  check?(el: IRElement, ctx: RuleContext): void;
  /** Called once per document, for checks that need the whole tree. */
  checkDocument?(ctx: RuleContext): void;
}
