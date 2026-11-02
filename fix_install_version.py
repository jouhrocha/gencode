#!/usr/bin/env python3
import base64
import json
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
INST = os.path.expanduser('~/.local/opt/gencode2')
VERSION = '1.140.0'
TARGETS = {'dark': '.3', 'light': '.3', 'hcDark': None, 'hcLight': None}


def make_svg(png, opacity, name):
    op = ' opacity="%s"' % opacity if opacity else ''
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        'width="40" height="40" viewBox="0 0 40 40"><g id="gencode_letterpress_%s">'
        '<image x="0" y="0" width="40" height="40"%s xlink:href="data:image/png;base64,%s"/>'
        '</g></svg>\n' % (name, op, base64.b64encode(png).decode())
    )


def main():
    png = open(os.path.join(ROOT, 'tmp', 'icono.png'), 'rb').read()

    for rel in ('resources/app/product.json', 'resources/app/package.json'):
        p = os.path.join(INST, rel)
        s = open(p, encoding='utf-8').read()
        s = re.sub(r'("version"\s*:\s*)"[^"]*"', r'\1"%s"' % VERSION, s, count=1)
        open(p, 'w', encoding='utf-8').write(s)
        print('version:', rel, '->', json.loads(s)['version'])

    n = 0
    for dp, _dns, fns in os.walk(os.path.join(INST, 'resources/app')):
        for fn in fns:
            m = re.fullmatch(r'letterpress-(dark|light|hcDark|hcLight)\.svg', fn)
            if m:
                p = os.path.join(dp, fn)
                open(p, 'w', encoding='utf-8').write(make_svg(png, TARGETS[m.group(1)], m.group(1)))
                n += 1
    print('watermarks sustituidos:', n)


if __name__ == '__main__':
    main()
