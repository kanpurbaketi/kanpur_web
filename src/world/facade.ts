import * as THREE from 'three';
import { noiseTexture, signAtlas } from './textures';
import { nightUniform } from './night';

/**
 * Procedural Kanpur facade on top of MeshStandardMaterial (keeps lights, shadows, fog).
 * Port of kanpur/game/shaders/building.gdshader.
 *   uv       = (meters along perimeter, meters above base)
 *   facade   = (shop, wall, seed, front)  shop: ground floor shutters on this wall; wall: 0 = roof, 1 = wall,
 *              2 = plain trim (parapet, chajja);
 *              front: wall faces a road (gets door / gate)
 *   signColor= signboard colour for shop rows
 *   fx       = (window bay width, balcony first cell + 1 (0 = none), balcony cells, -)
 *   wall modes (facade.y): 3 balcony railing (bars, rest discarded), 4 striped awning, 5 AC unit, 6 blade sign board
 */
export function makeFacadeMaterial(floorH: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.floorH = { value: floorH };
    sh.uniforms.noiseTex = { value: noiseTexture() };
    sh.uniforms.signTex = { value: signAtlas() };
    sh.uniforms.uNight = nightUniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 facade;
attribute vec3 signColor;
attribute vec4 fx;
flat varying vec4 vFx;
flat varying vec4 vFacade;
flat varying vec3 vSign;
varying vec2 vFUv;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
vFacade = facade;
vFx = fx;
vSign = signColor;
vFUv = uv;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float floorH;
uniform sampler2D noiseTex;
uniform sampler2D signTex;
uniform float uNight;
flat varying vec4 vFx;
flat varying vec4 vFacade;
flat varying vec3 vSign;
varying vec2 vFUv;
float fhash(float n) { return fract(sin(n) * 43758.5453); }
float fRough = 0.92;
vec3 fEmit = vec3(0.0);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 col = diffuseColor.rgb;
  float seed = vFacade.z * 97.0;
  vec2 so = vec2(fhash(seed), fhash(seed + 1.0)) * 7.0;          // per-building noise offset
  vec4 pn = texture2D(noiseTex, vFUv / 2.3 + so);                 // plaster grain / blotches
  vec4 bn = texture2D(noiseTex, vFUv / 13.0 + so);                // large discolouration
  // every texture read happens out here, in uniform control flow, so mip selection stays correct
  float bayU = vFx.x > 1.0 ? vFx.x : 3.0;
  float cellU = floor(vFUv.x / bayU);
  float streakN = texture2D(noiseTex, vec2(vFUv.x / 1.7, vFUv.y / 40.0) + so).g;
  float rustN = texture2D(noiseTex, vFUv / 0.6 + cellU).b;
  float peelN = texture2D(noiseTex, vFUv / 5.0 + so * 1.3).b;
  vec4 rn = texture2D(noiseTex, vFUv / 4.0 + so);
  float segU = floor(vFUv.x / 7.0);
  float tileU = floor(fhash(segU + seed * 3.0) * 32.0);
  float suU = (fract(vFUv.x / 7.0) - 0.04) / 0.92;
  float svU = (fract(vFUv.y / floorH) - 0.74) / 0.23;
  // the tile index jumps between frontages, so give the sampler explicit gradients (from the continuous uv)
  vec2 gx = vec2(dFdx(vFUv.x) / (7.0 * 0.92 * 2.0), -dFdx(vFUv.y) / (floorH * 0.23 * 16.0));
  vec2 gy = vec2(dFdy(vFUv.x) / (7.0 * 0.92 * 2.0), -dFdy(vFUv.y) / (floorH * 0.23 * 16.0));
  vec3 signTexel = textureGrad(signTex, vec2((mod(tileU, 2.0) + clamp(suU, 0.0, 1.0)) / 2.0,
                                             (floor(tileU / 2.0) + 1.0 - clamp(svU, 0.0, 1.0)) / 16.0), gx, gy).rgb;
  float fwx = fwidth(vFUv.x), fwy = fwidth(vFUv.y);
  float fine = 1.0 - smoothstep(0.012, 0.035, fwy);     // fade fine patterns (shutter ribs, grilles) with distance
  float fineX = 1.0 - smoothstep(0.03, 0.09, fwx);
  if (vFacade.y > 0.5) {
    // Painted plaster: uneven paint, faded patches, fine grain.
    // years of dust and monsoon: paint loses its saturation and darkens toward grey-beige
    float luma = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(col, vec3(luma) * vec3(1.04, 0.98, 0.88), 0.3 + 0.2 * bn.r);
    col *= 0.9 + 0.2 * pn.r;
    col *= mix(0.78, 1.04, bn.g);
    col = mix(col, col * vec3(1.05, 1.0, 0.9) + 0.03, smoothstep(0.65, 0.85, bn.b) * 0.5); // sun-faded
    // monsoon streaks running down from the roof and from every chajja
    float streak = streakN;
    float fvAll = fract(vFUv.y / floorH);
    float under = smoothstep(0.8, 0.2, fvAll) * 0.5 + 0.5;
    col *= 1.0 - 0.22 * smoothstep(0.55, 0.85, streak) * under;
    // ground splash: dust and damp up to ~1 m
    float splash = smoothstep(1.1 + pn.g * 0.6, 0.0, vFUv.y);
    col = mix(col, col * vec3(0.62, 0.56, 0.48), splash * 0.75);
    // plaster fallen off: exposed brick, mostly on side and back walls, and low on every wall
    float peel = smoothstep(0.7, 0.78, peelN) * (vFacade.w > 0.5 ? 0.25 : 1.0)
               * step(0.55, fhash(seed + 5.0));
    peel = max(peel, smoothstep(0.55, 0.9, splash * pn.g + splash * 0.3) * 0.6);
    if (peel > 0.01 && vFacade.y < 1.5) {
      vec2 bu = vec2(vFUv.x / 0.23, vFUv.y / 0.075);
      float rowi = floor(bu.y);
      bu.x += 0.5 * mod(rowi, 2.0);
      vec2 bf = fract(bu);
      float mortar = clamp(step(bf.x, 0.07) + step(bf.y, 0.14), 0.0, 1.0);
      vec3 brick = mix(vec3(0.42, 0.2, 0.12) * (0.65 + 0.6 * fhash(floor(bu.x) + rowi * 31.0 + seed)), vec3(0.5, 0.47, 0.42), mortar);
      col = mix(col, brick * (0.8 + 0.3 * pn.r), smoothstep(0.35, 0.6, peel));
    }
  }
  int mode = int(vFacade.y + 0.5);
  if (mode >= 3) {
    if (mode == 3) {
      // balcony railing: flat bar, upright bars; everything between is open
      float v = fract((vFUv.y + 0.01) / floorH) * floorH;
      bool bars = fract(vFUv.x * 7.0) < 0.2;
      if (!(v < 0.1 || (v > 0.96 && v < 1.08) || bars)) discard;
      col = mix(vec3(0.07, 0.07, 0.08), vec3(0.2, 0.12, 0.07), smoothstep(0.45, 0.8, pn.g)); // iron, rust
      fRough = 0.55;
    } else if (mode == 4) {
      // canvas awning in stripes
      float st = step(0.5, fract(vFUv.x * 1.6));
      col = mix(vSign * 0.9, vec3(0.78, 0.74, 0.65), st) * (0.8 + 0.25 * pn.r);
      col *= 1.0 - 0.25 * smoothstep(0.6, 0.9, pn.b);
    } else if (mode == 5) {
      // split AC outdoor unit: dirty white box, louvres, dark grille
      col = vec3(0.62, 0.62, 0.6) * (0.8 + 0.3 * pn.r);
      float v = fract(vFUv.y * 16.0), u = fract(vFUv.x * 1.45);
      if (u > 0.12 && u < 0.88 && v < 0.55) col = vec3(0.12);
      col = mix(col, col * vec3(0.7, 0.6, 0.5), smoothstep(0.5, 0.8, pn.b) * 0.6); // rain streaks
      fRough = 0.6;
    } else {
      // hanging blade sign: coloured flex with lettering rows
      col = vSign * (0.8 + 0.25 * pn.r);
      float rowId = floor(vFUv.y * 3.4);
      float row = fract(vFUv.y * 3.4);
      if (row > 0.22 && row < 0.7 && fhash(rowId * 7.0 + floor(vFUv.x * 6.0) + seed) > 0.3) col = vec3(0.92, 0.9, 0.84);
    }
  } else if (vFacade.y > 1.5) {
    // trim: parapet / chajja concrete, edges darker
    col *= 0.92 + 0.12 * pn.a;
  } else if (vFacade.y > 0.5) {
    float bay = vFx.x > 1.0 ? vFx.x : 3.0;                   // window bay width varies per building
    float fu = fract(vFUv.x / bay);
    float cell = floor(vFUv.x / bay);
    float fv = fract(vFUv.y / floorH);
    float fl = floor(vFUv.y / floorH);
    // floor band (slab edge)
    if (fv < 0.05 && fl > 0.0) col *= 0.82;
    bool groundShop = vFacade.x > 0.5 && fl < 0.5;
    bool inBalc = vFx.y > 0.5 && cell >= vFx.y - 1.0 && cell < vFx.y - 1.0 + vFx.z && fl > 0.5;
    if (groundShop) {
      if (fu > 0.04 && fu < 0.96 && fv < 0.70) {
        float rib = mix(0.5, fract(vFUv.y * 14.0), fine);
        float open = step(0.55, fhash(cell * 3.1 + seed));    // some shutters up, showing dark interior
        vec3 shut = mix(vec3(0.24, 0.26, 0.28), vec3(0.36, 0.38, 0.40), smoothstep(0.2, 0.5, rib) * smoothstep(0.9, 0.6, rib));
        shut *= 0.8 + 0.3 * pn.r;                              // dusty, dented steel
        float rust = smoothstep(0.72, 0.9, rustN) * smoothstep(0.5, 0.0, fv);
        shut = mix(shut, vec3(0.22, 0.13, 0.07), rust * 0.35);   // rust creeping up from the bottom
        // open: dark interior with a lit back wall and shelf lines
        vec3 inside = vec3(0.05, 0.045, 0.04) + vec3(0.12, 0.09, 0.05) * smoothstep(0.1, 0.6, fv) * mix(0.5, step(0.5, fract(fv * 6.0)), fine);
        col = mix(shut, inside, open);
        fEmit = vec3(1.0, 0.7, 0.35) * 0.7 * open * step(0.45, fhash(cell * 5.0 + seed)) * (0.5 + fv);   // lit shop interior
        fRough = mix(0.5, 0.95, open);
      } else if (fv > 0.74 && fv < 0.97) {
        // flex signboard: one of the printed strips per 7 m of frontage
        if (suU > 0.0 && suU < 1.0) { col = signTexel * (0.8 + 0.22 * pn.r); fEmit = signTexel * 0.85; }
        else col = vSign * 0.5;
      }
    } else if (vFacade.w > 0.5 && fl < 0.5) {
      // house facing the road: one door / gate per frontage
      float dpos = fract(vFUv.x / 9.0);
      if (dpos > 0.1 && dpos < 0.24 && fv < 0.72) {
        col = vec3(0.22, 0.13, 0.07) * (0.8 + 0.4 * pn.r);
        if (dpos < 0.11 || dpos > 0.23 || fv > 0.71) col *= 0.5;  // frame shadow
      } else if (fu > 0.3 && fu < 0.7 && fv > 0.3 && fv < 0.72) {
        col = vec3(0.07, 0.08, 0.09);
        if (fract(fu * 10.0) < 0.12 || fract(fv * 8.0) < 0.1) col = mix(col, vec3(0.2, 0.2, 0.19), fineX); // grille
      }
    } else if (inBalc && fu > 0.18 && fu < 0.82 && fv > 0.03 && fv < 0.82) {
      // balcony door: painted frame, two glass leaves, grille
      bool frame = fu < 0.22 || fu > 0.78 || fv > 0.78 || abs(fu - 0.5) < 0.014;
      col = frame ? vec3(0.28, 0.2, 0.12) : mix(vec3(0.03, 0.035, 0.04), vec3(0.22, 0.26, 0.3), smoothstep(0.1, 0.78, fv) * 0.55);
      if (!frame) fRough = 0.15;
      if (!frame && fract(fv * 9.0) < 0.07) col = mix(col, vec3(0.16, 0.14, 0.12), fine);
      col *= 1.0 - 0.4 * smoothstep(0.7, 0.78, fv);
    } else if (fu > 0.28 && fu < 0.72 && fv > 0.3 && fv < 0.76) {
      float h = fhash(cell * 7.0 + fl * 13.0 + seed);
      // window recess: reveal shadow on top and one side (sun from the south-west)
      float reveal = max(smoothstep(0.7, 0.76, fv), smoothstep(0.32, 0.28, fu) * 0.6);
      bool frame = fu < 0.31 || fu > 0.69 || fv < 0.33 || fv > 0.73;
      if (frame) col = vec3(0.2, 0.17, 0.14);
      else if (h < 0.25) col = vec3(0.17, 0.25, 0.17) * (0.8 + 0.3 * pn.r); // green wooden shutters
      else if (h < 0.35) col = vec3(0.46, 0.34, 0.2) * (0.65 + 0.35 * sin(fu * 90.0)) * smoothstep(0.3, 0.5, fv); // curtain folds, glass above
      else {
        // glass: dim interior, faint sky reflection toward the top of the pane
        col = mix(vec3(0.03, 0.035, 0.04), vec3(0.22, 0.26, 0.3), smoothstep(0.35, 0.73, fv) * 0.5);
        fRough = 0.15;
        // evening: some rooms lit (warm bulbs, a few blue tube lights / TVs)
        float lit = fhash(cell * 11.0 + fl * 5.0 + seed * 9.0);
        if (lit < 0.42) {
          vec3 room = lit < 0.05 ? vec3(0.55, 0.7, 1.0) : mix(vec3(1.0, 0.62, 0.28), vec3(1.0, 0.82, 0.5), fract(lit * 40.0));
          fEmit = room * (0.25 + 0.35 * smoothstep(0.35, 0.73, fv));
        }
        if (abs(fu - 0.5) < 0.012 || (h > 0.6 && abs(fv - 0.6) < 0.012)) col = vec3(0.2, 0.17, 0.14); // mullion, transom
      }
      if (!frame && h >= 0.35 && fract(fu * 12.0) < 0.12) col = mix(col, vec3(0.08), fineX);   // window grille
      col *= 1.0 - 0.55 * reveal;
    } else if (fu > 0.26 && fu < 0.74 && fv > 0.27 && fv < 0.3) {
      col *= 1.15;                                              // sill
    } else if (fu > 0.3 && fu < 0.7 && fv > 0.12 && fv < 0.27) {
      col *= 1.0 - 0.12 * smoothstep(0.27, 0.12, fv) * smoothstep(0.3, 0.7, pn.g); // drip stain below sill
    }
  } else {
    // roof: stained concrete with dark damp patches and moss toward the edges
    col = mix(vec3(dot(col, vec3(0.3, 0.59, 0.11))) * vec3(1.0, 0.97, 0.92), col, 0.12);   // bare concrete, not painted
    col *= 0.62 * (0.85 + 0.3 * rn.r);
    col = mix(col, vec3(0.08, 0.08, 0.07), smoothstep(0.6, 0.85, rn.b) * 0.5);
    col = mix(col, vec3(0.1, 0.12, 0.06), smoothstep(0.75, 0.9, rn.g) * 0.4);
  }
  diffuseColor.rgb = col;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = fRough;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += fEmit * uNight;`);
  };
  return mat;
}
