import subprocess, re, json, sys

URL = re.compile(r'https?://[^\s"\'<>)\]|,;]+')

def run(*a):
    return subprocess.run(a, cwd='/media/user/d48e5428-e66b-4a12-902d-02f018700477/vs/gencode', capture_output=True, text=True).stdout

files = [f for f in run('git','diff','--name-only','d38230c^','d38230c').split('\n') if f]
pairs = {}
detail = []
for f in files:
    d = run('git','diff','-U0','d38230c^','d38230c','--',f)
    minus, plus = [], []
    for line in d.split('\n'):
        if line.startswith('---') or line.startswith('+++'):
            continue
        if line.startswith('-'):
            minus.append(line[1:])
        elif line.startswith('+'):
            plus.append(line[1:])
        else:
            if minus or plus:
                for a, b in zip(minus, plus):
                    if 'gencode' not in b.lower():
                        continue
                    ua, ub = URL.findall(a), URL.findall(b)
                    if len(ua) == 1 and len(ub) == 1 and ua[0] != ub[0]:
                        pairs[ub[0]] = ua[0]
                        detail.append((f, ub[0], ua[0]))
                minus, plus = [], []

print('FICHEROS:', len(files))
print('PARES:', len(pairs))
for k, v in sorted(pairs.items()):
    print(f'{k}\n  -> {v}')
