"""The leak guard's public rules (devstation-y74s, devstation-y74s.1).

What must never land in this public repository: connection strings with a real password, real
people's emails, internal hosts and IPs, and data files. CI runs these rules (scan.py); the
maintainer's local guard imports this module and adds the rules that cannot be public (the
values of the local .env files, the maintainer's machine paths). Allowlists: config.json beside
this file. A finding names the rule and where it is, never the matched value.
"""
import codecs
import json
import os
import re
import subprocess

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")

CONN = re.compile(
    r"(?i)\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?)://([^\s/:@'\"`]+):([^\s@'\"`]+)@"
)
EMAIL = re.compile(r"\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b")
IP = re.compile(
    r"\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}"
    r"|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b"
)
HOST = re.compile(r"(?i)\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:internal|corp|lan|intranet)\b")
DATA_FILE = re.compile(r"(?i)\.(?:db|sqlite3?|jsonl|log)$")
PLACEHOLDER_SHAPE = re.compile(r"^(?:<.*>|\$\{.*\}|\{.*\}|\*+|x+)$", re.I)


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def git_out(repo, *args):
    r = subprocess.run(["git", "-C", repo, *args], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError("git %s failed in %s: %s" % (" ".join(args), repo, r.stderr.decode("utf-8", "replace").strip()))
    return r.stdout.decode("utf-8", "replace")


def is_reserved_email(email, config):
    domain = email.rsplit("@", 1)[-1].lower()
    if "noreply" in email.lower():
        return True
    if domain in config["reserved_email_domains"]:
        return True
    return domain.rsplit(".", 1)[-1] in config["reserved_tlds"]


def committer_emails(repos, config):
    """The committers' real addresses: git config and every author and committer in the logs
    of the repos, minus noreply and reserved domains."""
    found = set()
    for repo in repos:
        # `git config` exits 1 when user.email is unset: no address, not a failure.
        r = subprocess.run(["git", "-C", repo, "config", "user.email"], capture_output=True)
        if r.returncode not in (0, 1):
            raise RuntimeError("git config user.email failed in %s" % repo)
        found.update(r.stdout.decode("utf-8", "replace").splitlines())
        found.update(git_out(repo, "log", "--all", "--format=%ae%n%ce").splitlines())
    found = {e.strip().lower() for e in found}
    return {e for e in found if "@" in e and not is_reserved_email(e, config)}


class Rules:
    """`extra`: callables (text) -> [(rule, detail)], the rules a caller adds to these."""

    def __init__(self, repos, config, extra=()):
        self.config = config
        self.emails = committer_emails(repos, config)
        self.extra = list(extra)

    def scan_text(self, text):
        """[(rule, detail)] for one line of text; detail never holds the matched value."""
        hits = []
        for m in CONN.finditer(text):
            password = m.group(2)
            if password.lower() not in self.config["placeholder_passwords"] and not PLACEHOLDER_SHAPE.match(password):
                hits.append(("connection-string", ""))
        for rule in self.extra:
            hits.extend(rule(text))
        for m in EMAIL.finditer(text):
            local, domain = m.group(1).lower(), m.group(2).lower()
            personal = domain in self.config["personal_email_domains"] and local not in self.config["placeholder_email_locals"]
            if m.group(0).lower() in self.emails or personal:
                hits.append(("email", ""))
        allowed = self.config["allowed_hosts"]
        hosts = [m.group(0).lower() for m in HOST.finditer(text)]
        if IP.search(text) or any(not any(h == a or h.endswith("." + a) for a in allowed) for h in hosts):
            hits.append(("internal-host", ""))
        return hits

    def is_allowed_path(self, path):
        """An entry ending in '/' allows that folder; any other entry allows that file only."""
        return any(path.startswith(p) if p.endswith("/") else path == p for p in self.config["allowed_paths"])

    def is_data_file(self, path):
        if not DATA_FILE.search(path):
            return False
        norm = "/" + path.replace("\\", "/")
        return not any("/" + d in norm for d in self.config["fixture_dirs"])


def _header_path(raw):
    """The path a '+++ ' file header names: b/<path>, C-quoted when git escapes it (a quote, a
    tab, non-ASCII), or None for /dev/null."""
    name = raw[4:]
    if len(name) >= 2 and name.startswith('"') and name.endswith('"'):
        name = codecs.escape_decode(name[1:-1].encode("utf-8"))[0].decode("utf-8", "replace")
    return name[2:] if name.startswith("b/") else None


def added_lines(patch):
    """(path, line number, text) for every added line of a unified diff with -U0. A '+++ ' line
    is a file header only before its file's first hunk; inside a hunk it is an added line."""
    path, line, in_header = None, 0, True
    for raw in patch.splitlines():
        if raw.startswith("diff --git "):
            path, in_header = None, True
        elif in_header and raw.startswith("+++ "):
            path = _header_path(raw)
        elif raw.startswith("@@"):
            in_header = False
            m = re.match(r"^@@ -\d+(?:,\d+)? \+(\d+)", raw)
            line = int(m.group(1)) if m else 0
        elif not in_header and raw.startswith("+") and path is not None:
            yield path, line, raw[1:]
            line += 1
