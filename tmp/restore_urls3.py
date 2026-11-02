import json, os

ROOT = '/media/user/d48e5428-e66b-4a12-902d-02f018700477/vs/gencode'
pairs = json.load(open(os.path.join(ROOT, 'tmp/urlmap.json')))
pairs.update({
 'https://github.com/GenCode/inno-updater':'https://github.com/VSCodium/inno-updater',
 'https://www.vscodium.com/img/gencode.png':'https://www.vscodium.com/img/vscodium.png',
 'https://open-vsx.org/gencode/gallery':'https://open-vsx.org/vscode/gallery',
 'https://open-vsx.org/gencode/item':'https://open-vsx.org/vscode/item',
 'https://open-vsx.org/gencode/gallery/{publisher}/{name}/latest':'https://open-vsx.org/vscode/gallery/{publisher}/{name}/latest',
 'https://gencode.com/img/gencode.png':'https://vscodium.com/img/vscodium.png',
 'https://gencode.com':'https://vscodium.com',
 'main.gencode-cdn.net':'main.vscode-cdn.net',
 'GenCode/sourcemaps':'VSCodium/sourcemaps',
 'Microsoft/gencode-linux-build-agent':'Microsoft/vscode-linux-build-agent',
 'raw.githubusercontent.com/GenCode/gencode/${branch}/announcements-extra.json':'raw.githubusercontent.com/VSCodium/vscodium/${branch}/announcements-extra.json',
 'raw.githubusercontent.com/GenCode/gencode/${n}/announcements-extra.json':'raw.githubusercontent.com/VSCodium/vscodium/${n}/announcements-extra.json',
 'releases/download//gencode-reh-':'releases/download//codium-reh-',
})
subs = [(k.encode(), v.encode()) for k, v in pairs.items()]
report = []
for base in ('GenCode-linux-x64', 'gencode'):
    for dp, dns, fns in os.walk(os.path.join(ROOT, base)):
        dns[:] = [d for d in dns if d not in ('.git', 'tmp')]
        for fn in fns:
            p = os.path.join(dp, fn)
            if os.path.islink(p) or not os.path.isfile(p):
                continue
            try:
                data = open(p, 'rb').read()
            except OSError:
                continue
            if b'gencode' not in data:
                continue
            new, n = data, 0
            for bad, good in subs:
                if bad in new:
                    n += new.count(bad)
                    new = new.replace(bad, good)
            if n and new != data:
                open(p, 'wb').write(new)
                report.append((n, os.path.relpath(p, ROOT)))
print('FICHEROS:', len(report), 'SUSTITUCIONES:', sum(n for n, _ in report))
for n, f in sorted(report, reverse=True):
    print(f'{n:5d}  {f}')
