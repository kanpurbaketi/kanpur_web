"""2D geometry helpers (x, z meters) shared by the converters."""
import math


def signed_area(poly):
    a = 0.0
    for i in range(len(poly)):
        x1, z1 = poly[i]
        x2, z2 = poly[(i + 1) % len(poly)]
        a += x1 * z2 - x2 * z1
    return a / 2.0


def centroid(poly):
    xs = sum(p[0] for p in poly) / len(poly)
    zs = sum(p[1] for p in poly) / len(poly)
    return xs, zs


def point_in_poly(pt, poly):
    x, z = pt
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def seg_point_dist(a, b, p):
    ax, az = a
    bx, bz = b
    px, pz = p
    dx, dz = bx - ax, bz - az
    l2 = dx * dx + dz * dz
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / l2))
    cx, cz = ax + t * dx, az + t * dz
    return math.hypot(px - cx, pz - cz)


def segs_intersect(p1, p2, p3, p4):
    def orient(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    d1, d2 = orient(p3, p4, p1), orient(p3, p4, p2)
    d3, d4 = orient(p1, p2, p3), orient(p1, p2, p4)
    return (d1 > 0) != (d2 > 0) and (d3 > 0) != (d4 > 0)


def seg_poly_dist(a, b, poly):
    """Distance from segment ab to polygon (0 if they touch/overlap)."""
    if point_in_poly(a, poly) or point_in_poly(b, poly):
        return 0.0
    best = 1e9
    n = len(poly)
    for i in range(n):
        c, d = poly[i], poly[(i + 1) % n]
        if segs_intersect(a, b, c, d):
            return 0.0
        best = min(best, seg_point_dist(a, b, c), seg_point_dist(c, d, a), seg_point_dist(c, d, b))
    return best


def polys_overlap(p, q):
    """Polygon overlap test (works for simple polygons via edge crossing + containment)."""
    for i in range(len(p)):
        a, b = p[i], p[(i + 1) % len(p)]
        for j in range(len(q)):
            if segs_intersect(a, b, q[j], q[(j + 1) % len(q)]):
                return True
    return point_in_poly(p[0], q) or point_in_poly(q[0], p)


def bbox_of(poly, pad=0.0):
    xs = [p[0] for p in poly]
    zs = [p[1] for p in poly]
    return (min(xs) - pad, min(zs) - pad, max(xs) + pad, max(zs) + pad)


class Grid:
    """Uniform spatial hash of items keyed by bbox."""

    def __init__(self, cell=40.0):
        self.cell = cell
        self.cells = {}

    def _keys(self, bb):
        c = self.cell
        for gx in range(int(math.floor(bb[0] / c)), int(math.floor(bb[2] / c)) + 1):
            for gz in range(int(math.floor(bb[1] / c)), int(math.floor(bb[3] / c)) + 1):
                yield gx, gz

    def add(self, bb, item):
        for k in self._keys(bb):
            self.cells.setdefault(k, []).append(item)

    def query(self, bb):
        seen = set()
        for k in self._keys(bb):
            for it in self.cells.get(k, ()):
                if id(it) not in seen:
                    seen.add(id(it))
                    yield it


