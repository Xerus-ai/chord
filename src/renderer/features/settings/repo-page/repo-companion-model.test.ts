import { describe, expect, it } from 'vitest';
import { describeCompanionRefusal, suggestAppFolder } from './repo-companion-model';

describe('suggestAppFolder', () => {
  it('names the folder a repository sits at inside its companion', () => {
    expect(suggestAppFolder('D:\\work\\tools', 'D:\\work\\tools\\app')).toBe('app');
    expect(suggestAppFolder('d:/work/tools', 'D:\\Work\\Tools\\apps\\web')).toBe('apps/web');
    expect(suggestAppFolder('/home/u/tools/', '/home/u/tools/app')).toBe('app');
  });

  it('suggests nothing for a repository outside the companion, or the companion itself', () => {
    expect(suggestAppFolder('/home/u/tools', '/home/u/app')).toBeNull();
    expect(suggestAppFolder('/home/u/tools', '/home/u/tools')).toBeNull();
    expect(suggestAppFolder('/home/u/tools', '/home/u/toolsx/app')).toBeNull();
    // POSIX paths are case-sensitive.
    expect(suggestAppFolder('/home/u/Tools', '/home/u/tools/app')).toBeNull();
  });
});

describe('describeCompanionRefusal', () => {
  it('names each refused field as the row does, and leaves anything else as it is', () => {
    expect(
      describeCompanionRefusal(
        'companionRepo.appFolder: must be a folder inside the companion, without ..'
      )
    ).toBe('The folder must be a folder inside the companion, without ..');
    expect(
      describeCompanionRefusal(
        'companionRepo.path: must be an absolute path; companionRepo.appFolder: Required'
      )
    ).toBe('The companion repository must be an absolute path; The folder Required');
    expect(describeCompanionRefusal('No repository with id x')).toBe('No repository with id x');
  });
});
