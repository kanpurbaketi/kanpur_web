"""
More people from the ones we have: each rigged character (uncle, college_girl, college_boy, aunty) gets a few "looks" that reuse its mesh,
skeleton and clips and differ only in the texture: no moustache, a beard, darker skin, grey hair, other clothes. The security guard has no looks: he keeps his blue uniform.
Output: public/models/looks/<look>.jpg, picked up by src/world/actors.ts (LOOKS there lists the same names).

  tools/triposr/.venv/bin/python tools/people/make_variants.py [--preview DIR] [--only NAME]

(any Python with numpy, scipy and Pillow will do). --preview writes a sheet of every look, front and face, to DIR.

Everything is painted by where a texel sits on the body (texmap.py), then narrowed by colour: "the shirt" is the pale
neutral cloth above the belt, "the moustache" is the dark patch under the nose.
"""
import os, sys
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texmap import Body

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(ROOT, 'public', 'models')
OUT = os.path.join(MODELS, 'looks')
argv = sys.argv[1:]
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
ONLY = argv[argv.index('--only') + 1] if '--only' in argv else None

ramp = lambda v, a, b: np.clip((v - a) / (b - a), 0, 1)        # 0 at a, 1 at b (a > b gives a falling ramp)
luma = lambda c: c @ np.array([0.30, 0.59, 0.11])
col = lambda r, g, b: np.array([r, g, b]) / 255


class Painter:
    """One character and the regions of its texture. Colours are 0..1, sRGB as stored."""

    def __init__(self, name, face):
        self.name = name
        self.b = b = Body(os.path.join(MODELS, name + '_rig.glb'))
        self.src = np.asarray(b.image).astype(np.float64) / 255
        self.rng = np.random.default_rng(7)
        self.grain = self.rng.random(b.on.shape)
        c = self.src
        r, g, bl = c[..., 0], c[..., 1], c[..., 2]
        self.lum = luma(c)
        self.warm = r - bl                                        # skin, lips, leather: red well above blue
        self.chroma = c.max(axis=2) - c.min(axis=2)
        x, y, z = b.pos[..., 0], b.pos[..., 1], b.pos[..., 2]
        self.x, self.y, self.z = x, y, z
        self.d = b.hi[1] - y                                      # metres below the top of the head
        self.head = b.on & b.bone_mask('Head', 'Neck')
        self.limb = b.bone_mask('LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand')
        self.foot = b.bone_mask('LeftFoot', 'RightFoot', 'LeftToe', 'RightToe')
        self.f = face
        # skin: warm, red > green > blue, on the head, the arms and the feet (not the belt, not a brass badge)
        bare = self.head | self.limb | self.foot | b.bone_mask('LeftArm', 'RightArm') | ((self.d < 0.36) & (np.abs(x) < 0.08))     # and the open collar
        self.skin = b.on * bare * ramp(self.warm, 0.07, 0.15) * (r > g) * (g > bl) * ramp(self.lum, 0.12, 0.22)
        # hair of every kind: dark and nearly colourless, on the head, below the cap if there is one
        self.hair = self.head * ramp(self.lum, 0.36, 0.24) * ramp(self.warm, 0.11, 0.07) * ramp(self.d, face['hair_from'] - 0.006, face['hair_from'] + 0.004)
        eyes = (np.abs(x) < 0.062) & (np.abs(self.d - face['eyes']) < 0.011) & (z > 0.03)
        self.hair = self.hair * ~eyes
        hc = c[self.hair > 0.8]
        self.hair_col = np.median(hc[luma(hc) < np.median(luma(hc))], axis=0)      # its darker half: the true colour, not the shine

    # ---- clothes ----------------------------------------------------------------------------------------
    def cloth(self, out, w, target, gamma=1.0, lo=0.25, hi=1.5):
        """Dye the cloth `w` (0..1 per texel) to `target`, keeping its folds, weave and shading."""
        ref = np.median(self.lum[w > 0.6])
        shade = np.clip((self.lum / ref) ** gamma, lo, hi)[..., None]
        new = target * shade
        new = np.where(new > 0.8, 0.8 + 0.2 * np.tanh((new - 0.8) / 0.2), new)      # squeeze the highlights rather than clip them flat
        out += (new - out) * w[..., None]

    # ---- skin and hair ----------------------------------------------------------------------------------
    def tan(self, out, k):
        """Darker skin (k < 1) or fairer (k > 1): a gamma on the skin, a touch more on blue so dark skin stays warm."""
        e = np.array([1.0, 1.04, 1.10]) / k if k < 1 else np.array([1.0, 1.0, 1.0]) / k
        out += (np.power(np.clip(out, 1e-4, 1), e) - out) * self.skin[..., None]

    def grey(self, out, amount=1.0, w=None):
        """Hair, moustache and beard gone grey."""
        w = self.hair if w is None else w
        l = luma(out)
        g = (0.30 + 1.5 * l + 0.10 * (self.grain - 0.5))[..., None] * col(236, 234, 230)
        out += (np.clip(g, 0.0, 0.92) - out) * (w * amount)[..., None]

    def dye(self, out, colour, w=None):
        """Hair of another colour (brown, henna), keeping what shine it has."""
        w = self.hair if w is None else w
        ref = np.median(self.lum[w > 0.6])
        shade = np.clip((self.lum / ref) ** 0.6, 0.6, 1.6)[..., None]
        out += (np.clip(colour * shade, 0, 1) - out) * w[..., None]

    def skin_at(self, where, exclude, bright=0.38):
        """The skin colour the face would have at the texels `where`: taken from the bare skin around them."""
        src = (self.skin > 0.9) & self.head & (exclude < 0.02) & (self.lum > bright) & (self.z > 0)
        tree = cKDTree(self.b.pos[src])
        dist, idx = tree.query(self.b.pos[where], k=48)
        wt = 1 / (dist + 0.004) ** 2
        return (self.src[src][idx] * wt[..., None]).sum(axis=1) / wt.sum(axis=1, keepdims=True)

    def face_hair(self, lo, hi, half):
        """The dark hair on the front of the face between `lo` and `hi` metres below the crown, within `half` of the middle."""
        f = self.head * (self.z > 0.02) * ramp(np.abs(self.x), half, half - 0.008) * ramp(self.d, lo - 0.004, lo + 0.004) * ramp(self.d, hi + 0.004, hi - 0.004)
        return f * ramp(self.lum, 0.50, 0.40) * ramp(self.warm, 0.17, 0.12)

    def shave(self, out, w, bright=0.38):
        """Paint skin over the hair `w` (the skin is copied from around it, where it is lighter than `bright`: not from stubble)."""
        m = w > 0.02
        fill = self.skin_at(m, w, bright) * (1 - 0.05 * (self.grain[m][:, None] - 0.5))
        a = w[m][:, None]
        out[m] = out[m] * (1 - a) + fill * a

    def beard(self, out, density=0.82):
        """Grow a full beard on a shaven face: jaw, chin, under the chin and up the cheeks to the sideburns."""
        f = self.f
        ax = np.abs(self.x)
        # the upper edge: under the nose in the middle, climbing over the cheek to the ear
        side = ramp(ax, 0.030, 0.050)
        edge = f['nose'] + 0.014 * side - 0.80 * np.clip(ax - 0.050, 0, 1)
        w = self.head * (self.z > -0.02) * ramp((self.d - edge) / (0.006 + 0.008 * side), -0.6, 1.0) * ramp(self.d, f['neck'] + 0.035, f['neck'])
        lips = ((self.x / f['lip_w']) ** 2 + ((self.d - f['lips']) / f['lip_h']) ** 2)
        w = w * ramp(lips, 0.8, 1.25) * np.maximum(ramp(self.warm, 0.05, 0.10), ramp(self.lum, 0.50, 0.42))      # skin (or hair already): never the collar
        a = (w * density * (0.72 + 0.28 * self.grain))[..., None]
        shade = (1.1 + 1.0 * self.lum)[..., None]                # the face's own light and shade shows through
        out += (np.clip(self.hair_col * shade, 0, 1) - out) * a

    def save(self, out, look):
        img = self.b.image.copy()
        px = np.asarray(img).copy()
        on = self.b.on
        px[on] = np.clip(out[on] * 255 + 0.5, 0, 255).astype(np.uint8)
        os.makedirs(OUT, exist_ok=True)
        path = os.path.join(OUT, look + '.jpg')
        Image.fromarray(px).save(path, quality=88, subsampling=0)
        print('wrote', os.path.relpath(path, ROOT), os.path.getsize(path) // 1024, 'kB')
        return px


def sheet(p, looks, path):
    b = p.b
    top = b.hi[1]
    tiles = []
    for label, px in looks:
        body = b.render(px, 560, 0, (-0.47, b.lo[1] - 0.02, 0.47, top + 0.02))
        face = b.render(px, 560, 0, (-0.15, top - 0.33, 0.15, top + 0.01))
        side = b.render(px, 560, 1.0, (-0.15, top - 0.33, 0.15, top + 0.01))
        tiles.append((body, face, side))
    w = sum(t.width for t in tiles[0])
    im = Image.new('RGB', (w, 560 * len(tiles)))
    for i, t in enumerate(tiles):
        x = 0
        for part in t:
            im.paste(part, (x, 560 * i))
            x += part.width
    im.save(path)
    print('preview', path)


# ---- the uncle: a moustache, a pale checked shirt, grey trousers ------------------------------------------------
def uncle():
    p = Painter('uncle', dict(hair_from=0.0, eyes=0.126, nose=0.166, lips=0.196, lip_w=0.030, lip_h=0.0085, neck=0.262))
    neutral = ramp(p.chroma, 0.13, 0.07)
    face = p.head & (p.z > 0) & (p.d < 0.255) & (np.abs(p.x) < 0.085)
    shirt = p.b.on * ~p.limb * ~p.foot * ~face * neutral * ramp(p.y, 0.890, 0.900) * ramp(p.y, 1.47, 1.45) * ramp(p.lum, 0.24, 0.32)
    trousers = p.b.on * ~p.limb * neutral * ramp(p.y, 0.880, 0.868) * ramp(p.y, 0.025, 0.04)      # down to the turn-ups (the sandals are brown)
    moustache = p.face_hair(0.160, 0.206, 0.068)
    looks = [('uncle', np.asarray(p.b.image))]

    o = p.src.copy()                    # the neighbour: clean-shaven, a blue shirt, dark trousers
    p.shave(o, moustache)
    p.cloth(o, shirt, col(132, 162, 200))
    p.cloth(o, trousers, col(52, 58, 76))
    looks.append(('uncle_b', p.save(o, 'uncle_b')))

    o = p.src.copy()                    # darker, bearded, a mustard shirt and brown trousers
    p.beard(o)
    p.tan(o, 0.66)
    p.cloth(o, shirt, col(196, 160, 84))
    p.cloth(o, trousers, col(84, 66, 54))
    looks.append(('uncle_c', p.save(o, 'uncle_c')))

    o = p.src.copy()                    # the elder: grey hair and moustache, a green shirt, khaki trousers
    p.grey(o)
    p.tan(o, 0.86)
    p.cloth(o, shirt, col(150, 184, 158))
    p.cloth(o, trousers, col(158, 138, 104))
    looks.append(('uncle_d', p.save(o, 'uncle_d')))

    def look(name, shirt_col, legs, shave=False, beard=False, grey=0.0, tone=1.0):
        o = p.src.copy()
        if shave:
            p.shave(o, moustache)
        if beard:
            p.beard(o)
        if grey:
            p.grey(o, grey)
        if tone != 1.0:
            p.tan(o, tone)
        p.cloth(o, shirt, shirt_col)
        p.cloth(o, trousers, legs)
        looks.append((name, p.save(o, name)))

    look('uncle_e', col(190, 176, 140), col(58, 70, 58), tone=0.92)                          # cream shirt, bottle-green trousers
    look('uncle_f', col(192, 140, 150), col(70, 72, 80), shave=True, tone=1.05)              # pink shirt, clean-shaven
    look('uncle_g', col(52, 64, 104), col(150, 132, 100), beard=True, grey=0.8, tone=0.84)   # navy shirt, khaki, a grey beard
    look('uncle_h', col(176, 108, 60), col(34, 34, 40), shave=True, tone=0.70)               # rust shirt, black trousers, dark

    # the goons (the 'goon' rig in actors.ts): the same man in dark clothes
    o = p.src.copy()                    # bearded, all in black
    p.beard(o)
    p.tan(o, 0.80)
    p.cloth(o, shirt, col(34, 34, 38), gamma=0.8)
    p.cloth(o, trousers, col(30, 32, 38))
    looks.append(('goon_a', p.save(o, 'goon_a')))

    o = p.src.copy()                    # dark, a blood-red shirt
    p.tan(o, 0.70)
    p.cloth(o, shirt, col(104, 28, 28), gamma=0.9)
    p.cloth(o, trousers, col(28, 28, 32))
    looks.append(('goon_b', p.save(o, 'goon_b')))
    return p, looks


# ---- the college girl: a mustard kurta with long sleeves, blue jeans, a black plait over the shoulder -----------
def college_girl():
    p = Painter('college_girl', dict(hair_from=0.0, eyes=0.122, nose=0.17, lips=0.2, lip_w=0.03, lip_h=0.009, neck=0.25))
    c = p.src
    r, bl = c[..., 0], c[..., 2]
    yellow = ramp(bl / np.maximum(r, 1e-3), 0.50, 0.40)              # the kurta: hardly any blue in it (skin has more)
    throat = p.head | ((np.abs(p.x) < 0.075) & (p.d < 0.295))        # her face, ears and the gold chain are warm too
    kurta = p.b.on * ~throat * yellow * ramp(p.lum, 0.22, 0.30) * ramp(p.y, 0.44, 0.47)
    jeans = p.b.on * ramp(bl - r, 0.05, 0.11) * ramp(p.y, 0.62, 0.58) * ramp(p.y, 0.05, 0.08)
    p.skin = p.skin * (1 - yellow)                                    # the sleeves are not her arms
    eyes = (np.abs(p.x) < 0.062) & (np.abs(p.d - 0.122) < 0.011) & (p.z > 0.03)
    p.hair = p.b.on * ramp(p.lum, 0.27, 0.19) * ramp(p.y, 1.0, 1.03) * ~eyes      # the head and the plait down her front
    looks = [('college_girl', np.asarray(p.b.image))]

    def look(name, kurta_col, legs=None, legs_gamma=0.8, hair=None, tone=1.0):
        o = p.src.copy()
        if tone != 1.0:
            p.tan(o, tone)
        if hair is not None:
            p.dye(o, hair)
        if kurta_col is not None:
            p.cloth(o, kurta, kurta_col)
        if legs is not None:
            p.cloth(o, jeans, legs, gamma=legs_gamma)
        looks.append((name, p.save(o, name)))

    look('college_girl_b', col(206, 92, 128), legs=col(30, 30, 36), hair=col(52, 34, 24), tone=1.06)        # pink, black leggings, brown hair
    look('college_girl_c', col(36, 132, 128), legs=col(196, 192, 184), legs_gamma=0.45, tone=0.72)            # teal, a white salwar, darker
    look('college_girl_d', col(132, 96, 182), hair=col(86, 42, 26), tone=0.88)                               # lilac, jeans, henna in her hair
    look('college_girl_e', col(200, 198, 192), tone=0.80)                                                     # a white chikan kurta, jeans
    look('college_girl_f', col(176, 38, 44), legs=col(186, 166, 134), legs_gamma=0.45, hair=col(40, 28, 22))  # red, beige leggings
    look('college_girl_g', col(96, 158, 208), legs=col(196, 192, 184), legs_gamma=0.45)                       # sky blue, white salwar
    look('college_girl_h', col(58, 146, 80), legs=col(30, 30, 36), tone=0.82)                                 # green, black leggings
    look('college_girl_i', col(222, 118, 42), hair=col(60, 38, 26), tone=0.94)                                # orange, jeans, brown hair
    look('college_girl_j', col(122, 30, 52), legs=col(186, 166, 134), legs_gamma=0.45, tone=0.74)             # maroon, beige leggings, darker
    return p, looks


# ---- the college boy: a blue checked shirt worn out, blue jeans, a light moustache, white trainers ---------------
def college_boy():
    p = Painter('college_boy', dict(hair_from=0.0, eyes=0.130, nose=0.172, lips=0.200, lip_w=0.030, lip_h=0.009, neck=0.25))
    c = p.src
    cool = ramp(c[..., 0] - c[..., 2], 0.05, -0.02)                  # cloth: no warmer than grey (skin is far warmer)
    # shirt and jeans are both blue: the shirt is the paler one, and its hem hangs over the jeans
    lit = np.maximum(ramp(p.lum, 0.18, 0.26), ramp(p.y, 0.93, 0.97) * ramp(p.lum, 0.06, 0.12))       # up by the collar its shadows are nearly black
    below = np.maximum(ramp(p.d, 0.235, 0.25), ramp(p.d, 0.19, 0.21) * ramp(p.lum, 0.30, 0.38))        # the collar stands up beside the neck (the hair there is dark)
    shirt = p.b.on * ~p.limb * cool * lit * below * ramp(p.y, 0.83, 0.85) * np.maximum(ramp(p.y, 0.88, 0.90), ramp(p.lum, 0.40, 0.46))
    jeans = p.b.on * (1 - shirt) * ramp(c[..., 2] - c[..., 0], 0.06, 0.12) * ramp(p.y, 0.91, 0.89) * ramp(p.y, 0.04, 0.07)
    lips = (p.x / 0.030) ** 2 + ((p.d - 0.201) / 0.007) ** 2
    moustache = p.head * (p.z > 0.02) * ramp(np.abs(p.x), 0.066, 0.056) * ramp(p.d, 0.166, 0.171) * ramp(p.d, 0.212, 0.206) * ramp(p.lum, 0.66, 0.58) * ramp(lips, 0.9, 1.3)
    looks = [('college_boy', np.asarray(p.b.image))]

    def look(name, shirt_col, legs=None, legs_gamma=0.8, hair=None, tone=1.0, shave=False, beard=False):
        o = p.src.copy()
        if shave:
            p.shave(o, moustache, bright=0.60)
        if beard:
            p.beard(o, 0.7)
        if tone != 1.0:
            p.tan(o, tone)
        if hair is not None:
            p.dye(o, hair)
        p.cloth(o, shirt, shirt_col)
        if legs is not None:
            p.cloth(o, jeans, legs, gamma=legs_gamma)
        looks.append((name, p.save(o, name)))

    look('college_boy_b', col(150, 52, 58), legs=col(36, 36, 42), shave=True)                                 # clean-shaven, a red check, black jeans
    look('college_boy_c', col(98, 122, 80), tone=0.70, beard=True)                                            # darker, bearded, an olive shirt
    look('college_boy_d', col(196, 196, 190), legs=col(168, 148, 112), legs_gamma=0.5, hair=col(58, 38, 26), tone=1.06)   # white shirt, khaki chinos, brown hair
    look('college_boy_e', col(204, 148, 62), legs=col(88, 92, 98), tone=0.85)                                 # a mustard check, grey jeans
    look('college_boy_f', col(30, 86, 94), tone=0.78, shave=True)                                             # clean-shaven, dark teal
    look('college_boy_g', col(208, 182, 72), legs=col(36, 36, 42), tone=0.92)                                 # a yellow check, black jeans
    look('college_boy_h', col(202, 130, 150), legs=col(88, 92, 98), shave=True, tone=1.04)                    # a pink check, grey jeans
    look('college_boy_i', col(46, 46, 52), beard=True, tone=0.86)                                             # bearded, a black shirt
    look('college_boy_j', col(210, 110, 46), legs=col(168, 148, 112), legs_gamma=0.5, tone=0.74, hair=col(50, 34, 24))    # orange, khaki chinos
    return p, looks


# ---- the aunty: a magenta sari and blouse with a yellow border, her hair in a bun ----------------------------------
def aunty():
    p = Painter('aunty', dict(hair_from=0.0, eyes=0.107, nose=0.15, lips=0.18, lip_w=0.03, lip_h=0.009, neck=0.23))
    c = p.src
    r, g, bl = c[..., 0], c[..., 1], c[..., 2]
    rr = np.maximum(r, 1e-3)
    throat = p.head | ((np.abs(p.x) < 0.065) & (p.d < 0.262))          # her face, and the gold chain at her neck
    sari = p.b.on * ~p.head * ramp(g / rr, 0.42, 0.30) * ramp(p.lum, 0.08, 0.14)        # magenta: hardly any green in it
    yellow = ramp(bl / rr, 0.44, 0.34) * ramp(g / rr, 0.48, 0.56)
    border = p.b.on * ~throat * yellow * ramp(p.lum, 0.30, 0.40)
    # her skin shows at the waist and the back too, not only on the head and arms
    p.skin = p.b.on * ramp(p.warm, 0.07, 0.15) * (r > g) * (g > bl) * (1 - yellow) * ramp(g / rr, 0.52, 0.62) * ramp(p.lum, 0.12, 0.22)
    looks = [('aunty', np.asarray(p.b.image))]

    def look(name, sari_col, border_col=None, gamma=0.8, hair=None, grey=0.0, tone=1.0):
        o = p.src.copy()
        if tone != 1.0:
            p.tan(o, tone)
        if grey:
            p.grey(o, grey)
        if hair is not None:
            p.dye(o, hair)
        p.cloth(o, sari, sari_col, gamma=gamma)
        if border_col is not None:
            p.cloth(o, border, border_col)
        looks.append((name, p.save(o, name)))

    look('aunty_b', col(30, 116, 70))                                                         # green, the gold border kept
    look('aunty_c', col(38, 72, 150), border_col=col(206, 202, 190), tone=0.74)              # blue with a silver border, darker
    look('aunty_d', col(214, 108, 34), border_col=col(120, 26, 42), grey=0.7, tone=0.9)      # saffron with a maroon border, greying
    look('aunty_e', col(204, 194, 170), border_col=col(176, 32, 40), gamma=0.55, tone=0.84)  # cream with a red border
    look('aunty_f', col(98, 44, 132), hair=col(60, 36, 24), tone=1.05)                        # purple, brown hair
    look('aunty_g', col(172, 26, 36), tone=0.9)                                               # red, the gold border kept
    look('aunty_h', col(210, 168, 44), border_col=col(30, 108, 60), tone=0.8)                 # yellow with a green border
    look('aunty_i', col(22, 118, 118), border_col=col(198, 62, 120), grey=0.45)               # teal with a pink border, greying
    look('aunty_j', col(210, 122, 160), border_col=col(206, 202, 190), gamma=0.6, tone=0.76)  # rose with a silver border, darker
    return p, looks


for make in (uncle, college_girl, college_boy, aunty):
    if ONLY and make.__name__ != ONLY:
        continue
    p, looks = make()
    if PREVIEW:
        sheet(p, looks, os.path.join(PREVIEW, p.name + '_looks.png'))
