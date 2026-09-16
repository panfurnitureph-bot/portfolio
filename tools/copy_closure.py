"""Copy the import closure of given entry files from Pan-Furnitures into the portfolio's src/pan/real,
skipping files that already exist there (so shims are never overwritten). Prints SERVER-flagged
modules that were copied (they need review / shimming) and any modules that could not be resolved."""
import re, sys, os, shutil
ROOT = r"C:/Users/techj/Documents/GitHub/Pan-Furnitures"
DEST = r"c:/Users/techj/Documents/GitHub/Portfolio/src/pan/real"
IMPORT_RE = re.compile(r'''(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]''')
def resolve(spec, frm):
    if spec.startswith('@/'): base = os.path.join(ROOT, spec[2:])
    elif spec.startswith('.'): base = os.path.normpath(os.path.join(os.path.dirname(frm), spec))
    else: return None
    for ext in ['', '.ts', '.tsx', '/index.ts', '/index.tsx']:
        p = base + ext
        if os.path.isfile(p): return p
    return None
seen, copied, skipped, server, external = set(), [], [], [], set()
def walk(p):
    if p in seen: return
    seen.add(p)
    src = open(p, encoding='utf-8', errors='ignore').read()
    rel = os.path.relpath(p, ROOT).replace('\\', '/')
    dest = os.path.join(DEST, rel)
    is_server = bool(re.search(r'^\s*["\']use server["\']|from ["\']server-only["\']|next/headers|next/cache|createServerSupabase|process\.env', src, re.M))
    if os.path.exists(dest): skipped.append(rel)
    else:
        os.makedirs(os.path.dirname(dest), exist_ok=True); shutil.copyfile(p, dest); copied.append(rel)
        if is_server: server.append(rel)
    for m in IMPORT_RE.finditer(src):
        spec = m.group(1)
        r = resolve(spec, p)
        if r: walk(r)
        elif not spec.startswith('.') and not spec.startswith('@/'): external.add(spec)
for e in sys.argv[1:]: walk(os.path.join(ROOT, e))
print('COPIED', len(copied)); [print('  +', c) for c in copied]
print('SKIPPED (exists)', len(skipped)); [print('  =', s) for s in skipped]
print('SERVER-FLAGGED among copied', len(server)); [print('  !', s) for s in server]
print('EXTERNAL', sorted(external))
