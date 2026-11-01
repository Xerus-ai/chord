"""scan.py - the leak guard's public rules over this repository (devstation-y74s.1).

  python3 scripts/leak-guard/scan.py tree [--repo DIR]             every tracked file
  python3 scripts/leak-guard/scan.py range BASE HEAD [--repo DIR]  the lines the commits of
                                                                   BASE..HEAD add, their
                                                                   messages and new files

BASE of forty zeros (a push that created the branch) means every commit HEAD reaches. Merge
commits are skipped in range mode: what a merge adds is in the tree, which tree mode scans. Rules and
allowlists: public_rules.py and config.json beside this file. A finding names the rule and where,
never the value. Exit 0 clean, 1 findings, 2 the scan could not run.
"""
import argparse
import os
import sys

# The scan leaves the tree it scans as it found it: no __pycache__ beside public_rules.py.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from public_rules import Rules, added_lines, git_out, load_config  # noqa: E402

ZERO = "0" * 40


def scan_file_lines(rules, path, text):
    return ["%s %s:%d" % (rule, path, n) for n, line in enumerate(text.split("\n"), 1) for rule, _ in rules.scan_text(line)]


def scan_tree(rules, repo):
    findings = []
    for path in git_out(repo, "ls-files", "-z").split("\0"):
        if not path or rules.is_allowed_path(path):
            continue
        if rules.is_data_file(path):
            findings.append("data-file %s" % path)
            continue
        with open(os.path.join(repo, path), "rb") as f:
            body = f.read()
        if b"\0" not in body:
            findings += scan_file_lines(rules, path, body.decode("utf-8", "replace"))
    return findings


def scan_range(rules, repo, base, head):
    span = [head] if base == ZERO else ["%s..%s" % (base, head)]
    findings = []
    for sha in git_out(repo, "rev-list", "--no-merges", *span).split():
        message = git_out(repo, "log", "-1", "--format=%B", sha)
        hit = {rule for line in message.splitlines() for rule, _ in rules.scan_text(line)}
        findings += ["%s message %s" % (rule, sha[:12]) for rule in sorted(hit)]
        # No rename detection: a rename is a delete plus an add, so a file renamed to a data-file
        # extension is an added path, and one moved out of an allowlisted folder has every line added.
        patch = git_out(repo, "show", "--format=", "-U0", "--no-color", "--no-ext-diff", "--no-renames", sha)
        for path, n, text in added_lines(patch):
            if not rules.is_allowed_path(path):
                findings += ["%s %s:%d" % (rule, path, n) for rule, _ in rules.scan_text(text)]
        for path in git_out(repo, "show", "--format=", "--name-only", "-z", "--no-renames", "--diff-filter=A", sha).split("\0"):
            if path and not rules.is_allowed_path(path) and rules.is_data_file(path):
                findings.append("data-file %s" % path)
    return sorted(set(findings))


def main():
    # Paths are UTF-8 whatever the console's code page (Windows pipes default to cp1252).
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="the leak guard's public rules over this repository")
    ap.add_argument("mode", choices=["tree", "range"])
    ap.add_argument("base", nargs="?")
    ap.add_argument("head", nargs="?")
    ap.add_argument("--repo", default=".")
    a = ap.parse_args()
    try:
        repo = os.path.abspath(a.repo)
        rules = Rules([repo], load_config())
        if a.mode == "tree":
            findings = scan_tree(rules, repo)
        else:
            if not (a.base and a.head):
                raise RuntimeError("range needs BASE and HEAD")
            findings = scan_range(rules, repo, a.base, a.head)
    except (RuntimeError, OSError) as e:
        print("leak-guard: could not scan: %s" % e, file=sys.stderr)
        sys.exit(2)
    for finding in findings:
        print("leak-guard: %s" % finding)
    if findings:
        print("leak-guard: %d finding(s). Values are never printed; fix the places named." % len(findings), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
