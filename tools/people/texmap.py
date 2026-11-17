"""
Reads a rigged character (public/models/<name>_rig.glb) and works out, for every texel of its texture, where on the body
that texel sits: its position in the rest pose, which way the surface faces, and which bone carries it. The textures of
these photo-built models are a jumble of small islands, so anything that has to be painted "on the upper lip" or
"on the shirt" has to be found on the body and not in the picture.

Used by make_variants.py. Metres, glTF axes: y up, the character faces +z, x to their left.
"""
import io, json, struct
import numpy as np
from PIL import Image

CTYPE = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


class Glb:
    def __init__(self, path):
        d = open(path, 'rb').read()
        n = struct.unpack('<I', d[12:16])[0]
        self.json = json.loads(d[20:20 + n])
        self.bin = d[20 + n + 8:]

    def view(self, i):
        bv = self.json['bufferViews'][i]
        o = bv.get('byteOffset', 0)
        return self.bin[o:o + bv['byteLength']]

    def accessor(self, i):
        a = self.json['accessors'][i]
        bv = self.json['bufferViews'][a['bufferView']]
        t, k = CTYPE[a['componentType']], NCOMP[a['type']]
        o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride') or np.dtype(t).itemsize * k
        raw = np.frombuffer(self.bin, dtype=np.uint8, count=stride * (a['count'] - 1) + np.dtype(t).itemsize * k, offset=o)
        if stride == np.dtype(t).itemsize * k:
            out = raw.view(t).reshape(a['count'], k)
        else:
            out = np.stack([raw[j * stride: j * stride + np.dtype(t).itemsize * k].view(t) for j in range(a['count'])])
        if a.get('normalized'):
            out = out.astype(np.float32) / np.iinfo(t).max
        return out

    def texture(self):
        return Image.open(io.BytesIO(self.view(self.json['images'][0]['bufferView']))).convert('RGB')


class Body:
    """pos / nrm / bone per texel (H x W), `on` where a texel belongs to the mesh at all; `bones` are the joint names."""

    def __init__(self, path, pad=4):
        g = Glb(path)
        j = g.json
        prim = j['meshes'][0]['primitives'][0]
        at = prim['attributes']
        P = g.accessor(at['POSITION']).astype(np.float64)
        N = g.accessor(at['NORMAL']).astype(np.float64)
        UV = g.accessor(at['TEXCOORD_0']).astype(np.float64)
        J = g.accessor(at['JOINTS_0'])
        Wt = g.accessor(at['WEIGHTS_0']).astype(np.float64)
        F = g.accessor(prim['indices']).reshape(-1, 3).astype(np.int64)
        skin = j['skins'][0]
        self.bones = [j['nodes'][n]['name'].split(':')[-1] for n in skin['joints']]
        top = J[np.arange(len(J)), Wt.argmax(axis=1)].astype(np.int32)          # the bone that carries each vertex most
        self.image = g.texture()
        W, H = self.image.size
        self.W, self.H = W, H
        pos = np.zeros((H, W, 3), np.float32)
        nrm = np.zeros((H, W, 3), np.float32)
        bone = np.full((H, W), -1, np.int32)
        uv = UV * [W, H] - 0.5                      # texel centres
        for f in F:
            a, b, c = uv[f]
            x0, x1 = int(np.floor(min(a[0], b[0], c[0]))) - pad, int(np.ceil(max(a[0], b[0], c[0]))) + pad
            y0, y1 = int(np.floor(min(a[1], b[1], c[1]))) - pad, int(np.ceil(max(a[1], b[1], c[1]))) + pad
            x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, W - 1), min(y1, H - 1)
            if x1 < x0 or y1 < y0:
                continue
            den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(den) < 1e-9:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
            l0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
            l1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
            l2 = 1 - l0 - l1
            # a little outside the triangle too (the island's bleed), but never over a texel another triangle really covers
            e = pad / max(np.sqrt(abs(den)), 1.0)
            inside = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
            near = (l0 >= -e) & (l1 >= -e) & (l2 >= -e) & (bone[ys, xs] < 0)
            m = inside | near
            if not m.any():
                continue
            l = np.stack([l0[m], l1[m], l2[m]], axis=1)
            lc = np.clip(l, 0, 1)
            lc /= lc.sum(axis=1, keepdims=True)
            pos[ys[m], xs[m]] = lc @ P[f]
            nrm[ys[m], xs[m]] = lc @ N[f]
            bone[ys[m], xs[m]] = top[f][lc.argmax(axis=1)]
        self.pos, self.nrm, self.bone = pos, nrm, bone
        self.on = bone >= 0
        self.lo, self.hi = P.min(axis=0), P.max(axis=0)

    def bone_mask(self, *names):
        """Texels carried by a bone whose name starts with any of `names`."""
        ids = [i for i, b in enumerate(self.bones) if any(b.startswith(n) for n in names)]
        return np.isin(self.bone, ids)

    def render(self, rgb, size=640, yaw=0.0, box=None):
        """A quick look at the body wearing `rgb` (H x W x 3 uint8): texels splatted as points, orthographic, turned by `yaw`.
        `box` = (x0, y0, x1, y1) in metres frames a part of it."""
        c, s = np.cos(yaw), np.sin(yaw)
        p = self.pos[self.on]
        col = rgb[self.on]
        x = p[:, 0] * c + p[:, 2] * s
        z = -p[:, 0] * s + p[:, 2] * c
        y = p[:, 1]
        nz = -self.nrm[self.on][:, 0] * s + self.nrm[self.on][:, 2] * c
        x0, y0, x1, y1 = box or (self.lo[0] - 0.05, self.lo[1] - 0.02, self.hi[0] + 0.05, self.hi[1] + 0.02)
        k = size / (y1 - y0)
        w = int((x1 - x0) * k)
        px, py = ((x - x0) * k).astype(int), ((y1 - y) * k).astype(int)
        ok = (px >= 0) & (px < w) & (py >= 0) & (py < size) & (nz > 0.05)
        px, py, z, col = px[ok], py[ok], z[ok], col[ok]
        out = np.full((size, w, 3), 40, np.uint8)
        order = np.argsort(z)                         # nearest last
        r = max(1, int(np.ceil(k * 1.7 / self.W)))    # a texel covers about this many pixels
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                qx, qy = np.clip(px[order] + dx, 0, w - 1), np.clip(py[order] + dy, 0, size - 1)
                out[qy, qx] = col[order]
        return Image.fromarray(out)
