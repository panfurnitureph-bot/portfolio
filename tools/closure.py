"""Compute the import closure of given entry files inside the Pan-Furnitures repo.
Prints each reachable module with line count and flags server-only modules."""
import re, sys, os
ROOT = r"C:/Users/techj/Documents/GitHub/Pan-Furnitures"
entries = sys.argv[1:]
seen = {}
IMPORT_RE = re.compile(r'''(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]''')
def resolve(spec, frm):
    if spec.startswith('@/'): base = os.path.join(ROOT, spec[2:])
    elif spec.startswith('.'): base = os.path.normpath(os.path.join(os.path.dirname(frm), spec))
    else: return None
    for ext in ['', '.ts', '.tsx', '/index.ts', '/index.tsx']:
        p = base + ext
        if os.path.isfile(p): return p
    return None
def walk(p):
    if p in seen: return
    src = open(p, encoding='utf-8', errors='ignore').read()
    server = bool(re.search(r'^\s*["\']use server["\']|from ["\']server-only["\']|next/headers|createServerSupabase|SUPABASE_SERVICE_ROLE', src, re.M))
    seen[p] = (src.count('\n') + 1, server, [])
    for m in IMPORT_RE.finditer(src):
        spec = m.group(1)
        is_type = bool(re.match(r'\s*import\s+type', m.group(0)))
        r = resolve(spec, p)
        if r: seen[p][2].append((r, is_type));
        if r and not is_type: walk(r)
        elif r and is_type and r not in seen: seen[r] = (0, False, [])  # type-only: record but do not traverse
for e in entries: walk(os.path.join(ROOT, e))
total = 0
for p, (n, server, _) in sorted(seen.items(), key=lambda x: -x[1][0]):
    rel = os.path.relpath(p, ROOT).replace('\\', '/')
    flag = 'SERVER' if server else ('type-only' if n == 0 else '')
    print(f"{n:6d}  {flag:9s} {rel}")
    total += n
print('TOTAL lines', total, 'files', len(seen))
