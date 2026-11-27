# python3 tools/audio/freesound.py id...: each Freesound sound's hq preview, saved as assets/audio_raw/<id>.mp3, with its
# licence, author and title in assets/audio_raw/<id>.txt (CC0 only is used: check the licence column)
import sys, re, html, urllib.request
for sid in sys.argv[1:]:
    s = urllib.request.urlopen(urllib.request.Request(f'https://freesound.org/s/{sid}/', headers={'User-Agent': 'Mozilla/5.0'})).read().decode()
    mp3 = re.search(r'data-mp3="([^"]+)"', s).group(1).replace('-lq.mp3', '-hq.mp3')
    title = html.unescape(re.search(r'data-title="([^"]*)"', s).group(1)); user = re.search(r'freesound.org/people/([^/"]+)/sounds/' + sid, s).group(1)
    lic = 'CC0' if 'publicdomain/zero' in s else 'OTHER?'
    open(f'assets/audio_raw/{sid}.mp3', 'wb').write(urllib.request.urlopen(urllib.request.Request(mp3, headers={'User-Agent': 'Mozilla/5.0'})).read())
    open(f'assets/audio_raw/{sid}.txt', 'w').write(f'{sid}\t{lic}\t{user}\t{title}\thttps://freesound.org/s/{sid}/\n')
    print(sid, lic, user, title)
