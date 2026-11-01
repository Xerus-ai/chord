import { describe, expect, it } from 'vitest';
import { WORK_ITEM_STATUS_BUCKETS } from '@shared/work-item-status';
import {
  getStatusDotColor,
  getStatusWord,
  isStatusDotPulsing,
  isStatusSignalPulsing,
  statusDotClass,
  statusSignalForBucket,
  statusTextClass,
} from './status-dot';

const SIGNALS = ['success', 'danger', 'warning', 'running', 'merged', 'neutral'] as const;

describe('status signal classes', () => {
  it('maps every signal to a dot token class and a text token class', () => {
    for (const signal of SIGNALS) {
      expect(statusDotClass(signal)).toMatch(/^bg-/);
      expect(statusTextClass(signal)).toMatch(/^text-/);
    }
  });

  it('gives each signal its own dot colour, so two states never read alike', () => {
    expect(new Set(SIGNALS.map(statusDotClass)).size).toBe(SIGNALS.length);
  });

  it('carries no inline hex', () => {
    for (const signal of SIGNALS) {
      expect(statusDotClass(signal)).not.toMatch(/#[0-9a-f]{3,8}/i);
      expect(statusTextClass(signal)).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });

  it('pulses only the running signal', () => {
    expect(SIGNALS.filter(isStatusSignalPulsing)).toEqual(['running']);
  });
});

describe('statusSignalForBucket', () => {
  it('covers every bucket', () => {
    for (const bucket of WORK_ITEM_STATUS_BUCKETS) {
      expect(SIGNALS).toContain(statusSignalForBucket(bucket));
    }
  });

  it('gives each bucket its own colour', () => {
    const classes = WORK_ITEM_STATUS_BUCKETS.map(getStatusDotColor);
    expect(new Set(classes).size).toBe(WORK_ITEM_STATUS_BUCKETS.length);
  });

  it('pulses only while an agent is working', () => {
    expect(WORK_ITEM_STATUS_BUCKETS.filter(isStatusDotPulsing)).toEqual(['working']);
  });
});

describe('getStatusWord', () => {
  it('gives every bucket a word for the meta line', () => {
    for (const bucket of WORK_ITEM_STATUS_BUCKETS) {
      expect(getStatusWord(bucket).length).toBeGreaterThan(0);
    }
  });

  it('keeps the words lower case — the meta line is facts, not labels', () => {
    for (const bucket of WORK_ITEM_STATUS_BUCKETS) {
      expect(getStatusWord(bucket)).toBe(getStatusWord(bucket).toLowerCase());
    }
  });
});
