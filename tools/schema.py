"""Extract table -> columns from the Pan-Furnitures migrations (create table + alter table add column).
Usage: python schema.py [table ...]  -> prints columns; writes schema.json next to this script."""
import re, os, sys, json, glob
ROOT = r"C:/Users/techj/Documents/GitHub/Pan-Furnitures/supabase/migrations"
tables = {}
def strip_comments(s):
    s = re.sub(r'--[^\n]*', '', s)
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    return s
def split_top(s):
    out, depth, cur = [], 0, ''
    for ch in s:
        if ch == '(': depth += 1
        if ch == ')': depth -= 1
        if ch == ',' and depth == 0: out.append(cur); cur = ''
        else: cur += ch
    if cur.strip(): out.append(cur)
    return out
for f in sorted(glob.glob(os.path.join(ROOT, '*.sql'))):
    sql = strip_comments(open(f, encoding='utf-8', errors='ignore').read())
    for m in re.finditer(r'create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s*\((.*?)\)\s*;', sql, re.S | re.I):
        t, body = m.group(1).lower(), m.group(2)
        cols = tables.setdefault(t, {})
        for part in split_top(body):
            p = part.strip()
            if not p or re.match(r'(?i)^(primary key|unique|constraint|foreign key|check|exclude)\b', p): continue
            mm = re.match(r'"?([a-z_0-9]+)"?\s+(.+)', p, re.S)
            if mm:
                name, rest = mm.group(1).lower(), ' '.join(mm.group(2).split())
                typ = re.split(r'\s+(not null|null|default|references|primary|unique|check|generated)\b', rest, 1, flags=re.I)[0].strip()
                dflt = re.search(r'default\s+(.+?)(?:\s+(?:not null|null|references|check|unique|primary)|$)', rest, re.I)
                cols[name] = {'type': typ, 'default': dflt.group(1).strip() if dflt else None, 'file': os.path.basename(f)}
    for m in re.finditer(r'alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s+((?:add\s+column.*?)(?:;|$))', sql, re.S | re.I):
        t, body = m.group(1).lower(), m.group(2)
        cols = tables.setdefault(t, {})
        for part in re.split(r',\s*add\s+column\s+', 'add column ' + re.sub(r'(?i)^add\s+column\s+', '', body.strip().rstrip(';')), flags=re.I):
            p = re.sub(r'(?i)^add\s+column\s+', '', part.strip()); p = re.sub(r'(?i)^if\s+not\s+exists\s+', '', p)
            mm = re.match(r'"?([a-z_0-9]+)"?\s+(.+)', p, re.S)
            if mm:
                name, rest = mm.group(1).lower(), ' '.join(mm.group(2).split())
                typ = re.split(r'\s+(not null|null|default|references|primary|unique|check|generated)\b', rest, 1, flags=re.I)[0].strip()
                dflt = re.search(r'default\s+(.+?)(?:\s+(?:not null|null|references|check|unique|primary)|$)', rest, re.I)
                cols[name] = {'type': typ, 'default': dflt.group(1).strip() if dflt else None, 'file': os.path.basename(f)}
    for m in re.finditer(r'alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s+drop\s+column\s+(?:if\s+exists\s+)?"?([a-z_0-9]+)"?', sql, re.I):
        tables.get(m.group(1).lower(), {}).pop(m.group(2).lower(), None)
    for m in re.finditer(r'alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s+rename\s+column\s+"?([a-z_0-9]+)"?\s+to\s+"?([a-z_0-9]+)"?', sql, re.I):
        t = tables.get(m.group(1).lower(), {})
        if m.group(2).lower() in t: t[m.group(3).lower()] = t.pop(m.group(2).lower())
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'schema.json')
json.dump(tables, open(out, 'w'), indent=1)
want = sys.argv[1:] or sorted(tables)
for t in want:
    if t not in tables: print(f'## {t}: NOT FOUND'); continue
    print(f'## {t} ({len(tables[t])} cols)')
    print('   ' + ', '.join(f"{c}:{v['type']}" + (f"={v['default']}" if v['default'] else '') for c, v in tables[t].items()))
print('TABLES', len(tables))
