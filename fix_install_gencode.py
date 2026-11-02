#!/usr/bin/env python3
import base64
import io
import json
import os
import re
import sys

LOGO = os.environ.get('GENCODE_LOGO', '/home/user/Downloads/gencode.png')
VERSION = os.environ.get('GENCODE_VERSION', '1.140.0')
WIDTH = int(os.environ.get('GENCODE_LOGO_WIDTH', '200'))
TARGETS = {'dark': '.3', 'light': '.3', 'hcDark': None, 'hcLight': None}
DEFAULT_ROOTS = ['~/.local/opt/gencode2']
SKIP = {'.git', 'node_modules', 'tmp'}


def load_logo():
    path = os.path.expanduser(LOGO)
    if not os.path.isfile(path):
        sys.exit('no existe el logo: %s' % path)
    data = open(path, 'rb').read()
    try:
        from PIL import Image
    except ImportError:
        return data
    im = Image.open(io.BytesIO(data)).convert('RGBA')
    if im.width > WIDTH:
        im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, 'PNG', optimize=True)
    return out.getvalue()


def make_svg(png, opacity, name):
    op = ' opacity="%s"' % opacity if opacity else ''
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        'width="40" height="40" viewBox="0 0 40 40"><g id="gencode_letterpress_%s">'
        '<image x="0" y="0" width="40" height="40"%s xlink:href="data:image/png;base64,%s"/>'
        '</g></svg>\n' % (name, op, base64.b64encode(png).decode())
    )


def fix_versions(root):
    for rel in ('resources/app/product.json', 'resources/app/package.json'):
        p = os.path.join(root, rel)
        if not os.path.isfile(p):
            continue
        s = open(p, encoding='utf-8').read()
        m = re.search(r'"version"\s*:\s*"([^"]*)"', s)
        if m and re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', m.group(1)):
            print('version ya valida:', p, '->', m.group(1))
            continue
        s2 = re.sub(r'("version"\s*:\s*)"[^"]*"', r'\1"%s"' % VERSION, s, count=1)
        open(p, 'w', encoding='utf-8').write(s2)
        print('version:', p, '->', json.loads(s2)['version'])


def fix_watermarks(root, png):
    n = 0
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d not in SKIP]
        for fn in fns:
            m = re.fullmatch(r'letterpress-(dark|light|hcDark|hcLight)\.svg', fn)
            if m:
                open(os.path.join(dp, fn), 'w', encoding='utf-8').write(
                    make_svg(png, TARGETS[m.group(1)], m.group(1)))
                n += 1
    return n


def main():
    roots = [os.path.expanduser(r) for r in (sys.argv[1:] or DEFAULT_ROOTS)]
    png = load_logo()
    print('logo:', os.path.expanduser(LOGO), len(png), 'bytes')
    for root in roots:
        if not os.path.isdir(root):
            print('omitido (no existe):', root)
            continue
        fix_versions(root)
        print('watermarks sustituidos:', fix_watermarks(root, png), 'en', root)


if __name__ == '__main__':
    main()
