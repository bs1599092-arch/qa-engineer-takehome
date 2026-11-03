import { test, expect } from '@playwright/test';

type Rule = {
  id: string;
  action: 'flag_silently' | 'reask_once' | 'reask_and_flag' | 'block';
  match: 'all' | 'any';
  logic: Array<{ attr: string; op: '=' | '!=' | '<' | '<=' | '>' | '>='; val: string | number }>;
};

function evaluate(rule: Rule, answers: Record<string, string | number>) {
  const checks = rule.logic.map(({ attr, op, val }) => {
    const actual = answers[attr];
    if (actual === undefined || actual === null || actual === '') return false;
    const left = Number(actual);
    const right = Number(val);
    const numeric = Number.isFinite(left) && Number.isFinite(right);
    switch (op) {
      case '=': return String(actual) === String(val);
      case '!=': return String(actual) !== String(val);
      case '<': return numeric && left < right;
      case '<=': return numeric && left <= right;
      case '>': return numeric && left > right;
      case '>=': return numeric && left >= right;
    }
  });
  return rule.match === 'any' ? checks.some(Boolean) : checks.every(Boolean);
}

test('HFC positive: matching AND conditions trigger the configured action', async () => {
  const rule: Rule = {
    id: 'age-education', action: 'reask_and_flag', match: 'all',
    logic: [{ attr: 'age', op: '<', val: 15 }, { attr: 'education', op: '=', val: 'College' }]
  };
  expect(evaluate(rule, { age: 14, education: 'College' })).toBe(true);
});

test('HFC negative: one false condition means AND rule does not trigger', async () => {
  const rule: Rule = {
    id: 'age-education', action: 'reask_and_flag', match: 'all',
    logic: [{ attr: 'age', op: '<', val: 15 }, { attr: 'education', op: '=', val: 'College' }]
  };
  expect(evaluate(rule, { age: 16, education: 'College' })).toBe(false);
});

test('HFC any: one matching condition triggers OR rule', async () => {
  const rule: Rule = {
    id: 'sleep', action: 'reask_once', match: 'any',
    logic: [{ attr: 'sleepWell', op: '=', val: 'Yes' }, { attr: 'sleepHours', op: '<', val: 6 }]
  };
  expect(evaluate(rule, { sleepWell: 'No', sleepHours: 5 })).toBe(true);
});

test('HFC edge: missing values do not accidentally satisfy numeric comparisons', async () => {
  const rule: Rule = {
    id: 'sleep', action: 'block', match: 'all',
    logic: [{ attr: 'sleepHours', op: '<', val: 6 }]
  };
  expect(evaluate(rule, {})).toBe(false);
});

test('HFC edge: boundary value 6 is not less than 6', async () => {
  const rule: Rule = {
    id: 'sleep', action: 'reask_once', match: 'all',
    logic: [{ attr: 'sleepHours', op: '<', val: 6 }]
  };
  expect(evaluate(rule, { sleepHours: 6 })).toBe(false);
});
