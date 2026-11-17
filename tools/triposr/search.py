"""Find free photos on Wikimedia Commons (through endpoints that are reachable here) and make a contact sheet."""
import json, sys, urllib.parse, subprocess, os, re
UA = 'kanpur-web-game/0.1 (local dev)'
def get(u):
    return subprocess.run(['curl', '-sL', '--max-time', '40', '-A', UA, u], capture_output=True).stdout
def search(term, n=14):
    u = 'https://api.wikimedia.org/core/v1/commons/search/page?' + urllib.parse.urlencode({'q': term + ' filetype:bitmap', 'limit': n})
    try: pages = json.loads(get(u)).get('pages', [])
    except Exception as e: print('ERR', term); return []
    titles = [p['key'] for p in pages if p['key'].startswith('File:')]
    if not titles: return []
    u = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode({'action': 'query', 'format': 'json', 'titles': '|'.join(titles),
        'prop': 'imageinfo', 'iiprop': 'url|size|extmetadata', 'iiurlwidth': 1024})
    res = []
    for p in json.loads(get(u)).get('query', {}).get('pages', {}).values():
        if 'imageinfo' not in p: continue
        ii = p['imageinfo'][0]; m = ii.get('extmetadata', {})
        res.append({'title': p['title'], 'thumb': ii.get('thumburl'), 'w': ii['width'], 'h': ii['height'],
                    'lic': m.get('LicenseShortName', {}).get('value', ''), 'artist': re.sub('<[^>]+>', '', m.get('Artist', {}).get('value', ''))[:80],
                    'page': ii.get('descriptionurl')})
    return res
if __name__ == '__main__':
    from PIL import Image
    tag, terms = sys.argv[1], sys.argv[2:]
    os.makedirs('refs/cand', exist_ok=True)
    items = []
    for t in terms: items += search(t)
    seen, tiles = set(), []
    for k, r in enumerate(items):
        if r['title'] in seen or not r['thumb']: continue
        seen.add(r['title'])
        f = f'refs/cand/{tag}_{len(tiles)}.jpg'
        open(f, 'wb').write(get(r['thumb'].replace('/1024px-', '/330px-')))
        try: im = Image.open(f).convert('RGB')
        except Exception: continue
        im.thumbnail((220, 165)); tiles.append(im); r['file'] = f
        print(len(tiles) - 1, '|', r['title'][:60], '|', r['lic'], '|', r['artist'])
        json.dump(r, open(f'refs/cand/{tag}_{len(tiles)-1}.json', 'w'))
    cols = 6; rows = (len(tiles) + cols - 1) // cols
    s = Image.new('RGB', (cols * 220, rows * 165), '#222')
    for i, im in enumerate(tiles): s.paste(im, ((i % cols) * 220, (i // cols) * 165))
    s.save(f'refs/cand/{tag}_sheet.png')
