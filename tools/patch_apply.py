#!/usr/bin/env python3
import re
import subprocess
import sys
import tempfile
from pathlib import Path

TABLES = {
    'standard': (('gencode', 'vscode'), ('Gencode', 'Vscode'), ('GenCode', 'VSCode'), ('GENCODE', 'VSCODE')),
    'camel': (('gencode', 'vscode'), ('Gencode', 'Vscode'), ('GenCode', 'VsCode'), ('GENCODE', 'VSCODE')),
}
HUNK = re.compile(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@')
BRAND = re.compile(r'gencode|vscode', re.IGNORECASE)


def revert(text: str, table: str) -> str:
    for old, new in TABLES[table]:
        text = text.replace(old, new)
    return text


def transform(hunk: str, mode: str) -> str:
    if mode == 'asis':
        return hunk
    kind, _, table = mode.partition(':')
    table = table or 'standard'
    out = []
    for line in hunk.splitlines(keepends=True):
        first = line[:1]
        if kind == 'context' and first in (' ', '-'):
            line = revert(line, table)
        elif kind == 'full':
            line = revert(line, table)
        out.append(line)
    return ''.join(out)


def parse(text: str):
    files = []
    current = None
    for line in text.splitlines(keepends=True):
        if line.startswith('diff --git '):
            if current:
                files.append(current)
            current = {'path': None, 'new': False, 'hunks': []}
        elif current is not None:
            if line.startswith('+++ '):
                target = line[4:].strip()
                current['new'] = target == '/dev/null'
                current['path'] = target[2:] if target.startswith('b/') else None
            if HUNK.match(line):
                current['hunks'].append([line])
            elif current['hunks']:
                current['hunks'][-1].append(line)
    if current:
        files.append(current)
    return files


def apply_hunk(path: str, hunk: str, is_new: bool) -> bool:
    with tempfile.NamedTemporaryFile('w', suffix='.patch', delete=False) as handle:
        if is_new:
            handle.write(f'--- /dev/null\n+++ b/{path}\n')
        else:
            handle.write(f'--- a/{path}\n+++ b/{path}\n')
        handle.write(hunk)
        patch_file = handle.name
    result = subprocess.run(
        ['git', 'apply', '--recount', '--ignore-whitespace', patch_file],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    Path(patch_file).unlink()
    return result.returncode == 0


def norm(line: str) -> str:
    return BRAND.sub('@BRAND@', line.strip())


def apply_at(lines, begin, seq):
    cursor = begin
    result = []
    for sig, text in seq:
        if sig in (' ', '-'):
            if cursor >= len(lines) or norm(lines[cursor]) != norm(text):
                return None
            if sig == ' ':
                result.append(lines[cursor])
            cursor += 1
        else:
            result.append(text.rstrip('\n') + '\n')
    return result, cursor


def fuzzy_apply(path: str, hunk: str) -> bool:
    target = Path(path)
    if not target.exists():
        return False
    match = HUNK.match(hunk.splitlines()[0])
    if not match:
        return False
    start = max(1, int(match.group(1)))
    lines = target.read_text().splitlines(keepends=True)
    body = hunk.splitlines(keepends=True)[1:]
    seq = [(line[0], line[1:]) for line in body if line[:1] in (' ', '+', '-')]
    first_ctx = next((text for sig, text in seq if sig == ' '), None)
    if first_ctx is None:
        return False
    candidates = [i for i, line in enumerate(lines) if norm(line) == norm(first_ctx)]
    candidates.sort(key=lambda i: abs(i - start))
    for begin in candidates:
        outcome = apply_at(lines, begin, seq)
        if outcome:
            result, cursor = outcome
            target.write_text(''.join(lines[:begin] + result + lines[cursor:]))
            return True
    return False


def main() -> int:
    patch = Path(sys.argv[1])
    files = parse(patch.read_text())
    ok = 0
    fuzzy = 0
    failed = []
    for entry in files:
        path = entry['path']
        if not path:
            continue
        for hunk in entry['hunks']:
            text = ''.join(hunk)
            applied = False
            for mode in ('asis', 'context:standard', 'context:camel', 'full:standard'):
                if apply_hunk(path, transform(text, mode), entry['new']):
                    applied = True
                    break
            if applied:
                ok += 1
            elif fuzzy_apply(path, text):
                fuzzy += 1
            else:
                failed.append((path, text.splitlines()[0][:60]))
    print(f'  hunks: {ok} exactos, {fuzzy} difusos, {len(failed)} fallidos')
    for path, head in failed[:5]:
        print(f'    FALLO {path} {head}')
    if failed:
        return 1
    print(f'  applied {patch.name}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
