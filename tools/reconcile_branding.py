#!/usr/bin/env python3
import re
import sys
from pathlib import Path

TREE = Path(sys.argv[1])
APPLY = '--apply' in sys.argv

IMPORT_VSCODE = re.compile(r"import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s+['\"]vscode['\"]")
IMPORT_GENCODE = re.compile(r"import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s+['\"]gencode['\"]")
DECL = [
    re.compile(r"\*\s+as\s+(gencode|vscode)\b"),
    re.compile(r"\b(const|let|var|function|class)\s+(gencode|vscode)\b"),
    re.compile(r"\bimport\s+(gencode|vscode)\b"),
]


def declared(text: str, name: str) -> bool:
    for pattern in DECL:
        for match in pattern.finditer(text):
            if name in match.groups():
                return True
    return False


def main() -> int:
    files = 0
    changes = 0
    for path in TREE.rglob('*.ts'):
        if 'node_modules' in path.parts or '.git' in path.parts:
            continue
        try:
            text = path.read_text()
        except (UnicodeDecodeError, OSError):
            continue
        has_use = 'gencode.' in text or 'vscode.' in text
        if not has_use:
            continue
        vscode_alias = IMPORT_VSCODE.search(text)
        gencode_alias = IMPORT_GENCODE.search(text)
        rewritten = text
        touched = []
        if not declared(text, 'gencode') and 'gencode.' in text and vscode_alias:
            rewritten = rewritten.replace('gencode.', 'vscode.')
            touched.append('gencode. -> vscode.')
        if not declared(text, 'vscode') and 'vscode.' in text and gencode_alias:
            rewritten = rewritten.replace('vscode.', 'gencode.')
            touched.append('vscode. -> gencode.')
        if rewritten != text:
            files += 1
            changes += len(touched)
            print(f'{path.relative_to(TREE)}: {", ".join(touched)}')
            if APPLY:
                path.write_text(rewritten)
    print()
    print(f'ficheros corregidos: {files}')
    if not APPLY:
        print('dry-run: usa --apply')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
