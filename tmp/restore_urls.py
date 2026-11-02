import subprocess, re, json, sys, os

ROOT = '/media/user/d48e5428-e66b-4a12-902d-02f018700477/vs/gencode'
URL = re.compile(r'https?://[^\s"\'<>)\]|,;]+')

def git(*a):
    r = subprocess.run(('git',) + a, cwd=ROOT, capture_output=True)
    return r.stdout.decode('utf-8', 'replace')

files = [f for f in git('diff', '--name-only', 'd38230c^', 'd38230c').split('\n') if f.strip()]
pairs = {}

def add(new, old):
    if new == old or 'gencode' not in new.lower():
        return
    if '${' in new or '${' in old:
        return
    pairs.setdefault(new, old)

for f in files:
    orig = subprocess.run(('git', 'show', 'd38230c^:' + f), cwd=ROOT, capture_output=True)
    if orig.returncode != 0:
        continue
    try:
        cur = open(os.path.join(ROOT, f), encoding='utf-8', errors='replace').read()
    except OSError:
        continue
    o_urls = URL.findall(orig.stdout.decode('utf-8', 'replace'))
    c_urls = URL.findall(cur)
    o_sorted = sorted(set(o_urls))
    c_sorted = sorted(set(c_urls))
    if len(o_urls) == len(c_urls):
        for a, b in zip(o_urls, c_urls):
            add(b, a)
    if len(o_sorted) == len(c_sorted):
        for a, b in zip(o_sorted, c_sorted):
            add(b, a)

# refinamiento por línea: empareja lineas '-' y '+' del diff
for f in files:
    d = git('diff', '-U0', 'd38230c^', 'd38230c', '--', f)
    minus, plus = [], []
    for line in d.split('\n'):
        if line.startswith('---') or line.startswith('+++'):
            continue
        if line.startswith('-'):
            minus.append(line[1:])
        elif line.startswith('+'):
            plus.append(line[1:])
        else:
            for a, b in zip(minus, plus):
                ua, ub = URL.findall(a), URL.findall(b)
                if len(ua) == len(ub):
                    for x, y in zip(ua, ub):
                        add(y, x)
            minus, plus = [], []

json.dump(pairs, open(os.path.join(ROOT, 'tmp/urlmap.json'), 'w'), indent=1, ensure_ascii=False)
print('PARES:', len(pairs))

# aplicar sobre ficheros versionados
tracked = [f for f in git('ls-files').split('\n') if f]
changed = 0
total = 0
report = []
for f in tracked:
    p = os.path.join(ROOT, f)
    if not os.path.isfile(p) or os.path.islink(p):
        continue
    try:
        data = open(p, encoding='utf-8').read()
    except (OSError, UnicodeDecodeError):
        continue
    new = data
    n = 0
    for bad, good in pairs.items():
        if bad in new:
            n += new.count(bad)
            new = new.replace(bad, good)
    if n and new != data:
        open(p, 'w', encoding='utf-8').write(new)
        changed += 1
        total += n
        report.append((n, f))

print('FICHEROS CAMBIADOS:', changed, 'SUSTITUCIONES:', total)
for n, f in sorted(report, reverse=True):
    print(f'{n:4d}  {f}')
