import { describe, expect, it } from 'vitest';
import { describeTypingLine } from './typing-line';

const roster = [
  { user_id: 'u-maya', name: 'Maya Chen', email: 'maya@example.com' },
  { user_id: 'u-asha', name: 'Asha Rao', email: 'asha@example.com' },
  { user_id: 'u-noname', name: null, email: 'noname@example.com' },
];

/**
 * The line above the composer names people the way the People list does
 * (devstation typing name): by their name, never by an email.
 */
describe('describeTypingLine', () => {
  it('is null when nobody is typing', () => {
    expect(describeTypingLine([], roster)).toBeNull();
  });

  it('names one person by the name the roster has for them', () => {
    expect(describeTypingLine([{ userId: 'u-asha', email: 'asha@example.com' }], roster)).toBe(
      'Asha Rao is typing...'
    );
  });

  it('uses the email’s local part only for someone the roster has no name for', () => {
    expect(describeTypingLine([{ userId: 'u-noname', email: 'noname@example.com' }], roster)).toBe(
      'noname is typing...'
    );
  });

  it('uses the email’s local part for someone not in the roster yet', () => {
    expect(describeTypingLine([{ userId: 'u-new', email: 'new.person@example.com' }], [])).toBe(
      'new.person is typing...'
    );
  });

  it('joins two names', () => {
    expect(
      describeTypingLine(
        [
          { userId: 'u-maya', email: 'maya@example.com' },
          { userId: 'u-asha', email: 'asha@example.com' },
        ],
        roster
      )
    ).toBe('Maya Chen and Asha Rao are typing...');
  });

  it('counts the rest past two', () => {
    expect(
      describeTypingLine(
        [
          { userId: 'u-maya', email: 'maya@example.com' },
          { userId: 'u-asha', email: 'asha@example.com' },
          { userId: 'u-noname', email: 'noname@example.com' },
        ],
        roster
      )
    ).toBe('Maya Chen and 2 others are typing...');
  });
});
