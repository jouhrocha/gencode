#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

TREE = Path(sys.argv[1])
APPLY = '--apply' in sys.argv
KEY = re.compile(r'%([A-Za-z0-9_.\-]+)%')
CANDIDATES = (('gencode', 'vscode'), ('GenCode', 'VSCode'), ('Gencode', 'Vscode'), ('vscode', 'gencode'), ('VSCode', 'GenCode'), ('Vscode', 'Gencode'))


def candidates(key: str):
    out = []
    for old, new in CANDIDATES:
        if old in key:
            out.append(key.replace(old, new))
    return out


def main() -> int:
    files = 0
    fixed = 0
    for package in TREE.rglob('package.json'):
        if 'node_modules' in package.parts or '.git' in package.parts:
            continue
        nls_files = sorted(package.parent.glob('package.nls*.json'))
        if not nls_files:
            continue
        defined = set()
        for nls in nls_files:
            try:
                defined.update(json.loads(nls.read_text()).keys())
            except (json.JSONDecodeError, OSError):
                continue
        text = package.read_text()
        replaced = 0
        for match in list(KEY.finditer(text)):
            key = match.group(1)
            if key in defined:
                continue
            for candidate in candidates(key):
                if candidate in defined:
                    text = text.replace(f'%{key}%', f'%{candidate}%')
                    replaced += 1
                    break
        if replaced:
            files += 1
            fixed += replaced
            print(f'{package.relative_to(TREE)}: {replaced} claves')
            if APPLY:
                package.write_text(text)
    print()
    print(f'extensiones corregidas: {files}')
    print(f'claves ajustadas: {fixed}')
    if not APPLY:
        print('dry-run: usa --apply')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
