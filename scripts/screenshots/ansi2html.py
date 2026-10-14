# ANSI capture of a Claude Code session (tmux capture-pane -e) to a static HTML page for screenshots.
import re, sys, html
PAL16 = ['000000','cd3131','0dbc79','e5e510','2472c8','bc3fbc','11a8cd','e5e5e5','666666','f14c4c','23d18b','f5f543','3b8eea','d670d6','29b8db','ffffff']
def x256(n):
    if n < 16: return '#' + PAL16[n]
    if n < 232:
        n -= 16; c = [0, 95, 135, 175, 215, 255]
        return '#%02x%02x%02x' % (c[n // 36], c[(n // 6) % 6], c[n % 6])
    v = 8 + (n - 232) * 10; return '#%02x%02x%02x' % (v, v, v)
FG, BG = '#e6e6e6', '#0c0d10'
def convert(lines):
    out = []
    st = dict(fg=None, bg=None, b=False, d=False, i=False)
    for line in lines:
        line = re.sub(r'\x1b\]8;[^\x1b\x07]*(\x1b\\|\x07)', '', line)
        parts = re.split(r'(\x1b\[[0-9;]*m)', line); spans = []
        for p in parts:
            if p.startswith('\x1b['):
                codes = [int(c) if c else 0 for c in p[2:-1].split(';')] or [0]; k = 0
                while k < len(codes):
                    c = codes[k]
                    if c == 0: st.update(fg=None, bg=None, b=False, d=False, i=False)
                    elif c == 1: st['b'] = True
                    elif c == 2: st['d'] = True
                    elif c == 3: st['i'] = True
                    elif c == 22: st['b'] = st['d'] = False
                    elif c == 23: st['i'] = False
                    elif c == 39: st['fg'] = None
                    elif c == 49: st['bg'] = None
                    elif 30 <= c <= 37: st['fg'] = x256(c - 30)
                    elif 90 <= c <= 97: st['fg'] = x256(c - 82)
                    elif 40 <= c <= 47: st['bg'] = x256(c - 40)
                    elif c in (38, 48):
                        key = 'fg' if c == 38 else 'bg'
                        if codes[k+1] == 2: st[key] = '#%02x%02x%02x' % tuple(codes[k+2:k+5]); k += 4
                        elif codes[k+1] == 5: st[key] = x256(codes[k+2]); k += 2
                    k += 1
            elif p:
                css = []
                if st['fg']: css.append('color:' + st['fg'])
                if st['bg']: css.append('background:' + st['bg'])
                if st['b']: css.append('font-weight:bold')
                if st['d']: css.append('opacity:.6')
                if st['i']: css.append('font-style:italic')
                txt = ''.join(f'<i class="w">{html.escape(ch)}</i>' if ord(ch) > 127 and ch != '\xa0' and not 0x2500 <= ord(ch) <= 0x257f else html.escape(ch) for ch in p)
                spans.append(f'<span style="{";".join(css)}">{txt}</span>' if css else txt)
        out.append('<div class="l">' + (''.join(spans) or ' ') + '</div>')
    return ''.join(out)
src = open(sys.argv[1], encoding='utf-8', errors='replace').read().split('\n')
plain = [re.sub(r'\x1b\[[0-9;]*m|\x1b\]8;[^\x1b\x07]*(\x1b\\|\x07)', '', l) for l in src]
start = next(i for i, l in enumerate(plain) if 'Box theme:' in l) + 1
end = next(i for i in range(start, len(plain)) if plain[i].lstrip().startswith('✻'))
while end > start and not plain[end-1]: end -= 1
body = convert(src[start:end])
print(f'''<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;background:{BG}}}
#t{{display:inline-block;padding:18px 22px;background:{BG};color:{FG};font:15px/1.18 "JetBrains Mono","SF Mono",Menlo,monospace;white-space:pre}}
.l{{height:1.18em;line-height:1.18em}}
.w{{display:inline-block;width:1ch;font-style:normal;text-align:center;overflow:visible}}
.l span{{display:inline-block;height:1.18em;vertical-align:top}}
</style><div id="t">{body}</div>
<script>const r=document.getElementById('t').getBoundingClientRect();document.title=Math.ceil(r.width)+'x'+Math.ceil(r.height)</script>''')
