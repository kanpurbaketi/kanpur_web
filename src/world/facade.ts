import * as THREE from 'three';
import { noiseTexture } from './textures';

/**
 * Procedural Kanpur facade on top of MeshStandardMaterial (keeps lights, shadows, fog).
 * Port of kanpur/game/shaders/building.gdshader.
 *   uv       = (meters along perimeter, meters above base)
 *   facade   = (shop, wall, seed, front)  shop: ground floor shutters on this wall; wall: 0 = roof, 1 = wall,
 *              2 = plain trim (parapet, chajja);
 *              front: wall faces a road (gets door / gate)
 *   signColor= signboard colour for shop rows
 */
export function makeFacadeMaterial(floorH: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.floorH = { value: floorH };
    sh.uniforms.noiseTex = { value: noiseTexture() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 facade;
attribute vec3 signColor;
varying vec4 vFacade;
varying vec3 vSign;
varying vec2 vFUv;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
vFacade = facade;
vSign = signColor;
vFUv = uv;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float floorH;
uniform sampler2D noiseTex;
varying vec4 vFacade;
varying vec3 vSign;
varying vec2 vFUv;
float fhash(float n) { return fract(sin(n) * 43758.5453); }
float fRough = 0.92;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 col = diffuseColor.rgb;
  float seed = vFacade.z * 97.0;
  vec2 so = vec2(fhash(seed), fhash(seed + 1.0)) * 7.0;          // per-building noise offset
  vec4 pn = texture2D(noiseTex, vFUv / 2.3 + so);                 // plaster grain / blotches
  vec4 bn = texture2D(noiseTex, vFUv / 13.0 + so);                // large discolouration
  if (vFacade.y > 0.5) {
    // Painted plaster: uneven paint, faded patches, fine grain.
    col *= 0.9 + 0.2 * pn.r;
    col *= mix(0.86, 1.06, bn.g);
    col = mix(col, col * vec3(1.05, 1.0, 0.9) + 0.03, smoothstep(0.65, 0.85, bn.b) * 0.5); // sun-faded
    // monsoon streaks running down from the roof and from every chajja
    float streak = texture2D(noiseTex, vec2(vFUv.x / 1.7, vFUv.y / 40.0) + so).g;
    float fvAll = fract(vFUv.y / floorH);
    float under = smoothstep(0.8, 0.2, fvAll) * 0.5 + 0.5;
    col *= 1.0 - 0.22 * smoothstep(0.55, 0.85, streak) * under;
    // ground splash: dust and damp up to ~1 m
    float splash = smoothstep(1.1 + pn.g * 0.6, 0.0, vFUv.y);
    col = mix(col, col * vec3(0.62, 0.56, 0.48), splash * 0.75);
  }
  if (vFacade.y > 1.5) {
    // trim: parapet / chajja concrete, edges darker
    col *= 0.92 + 0.12 * pn.a;
  } else if (vFacade.y > 0.5) {
    float bay = 3.0 + floor(fhash(seed) * 2.0) * 0.6;       // window bay width varies per building
    float fu = fract(vFUv.x / bay);
    float cell = floor(vFUv.x / bay);
    float fv = fract(vFUv.y / floorH);
    float fl = floor(vFUv.y / floorH);
    // floor band (slab edge)
    if (fv < 0.05 && fl > 0.0) col *= 0.82;
    bool groundShop = vFacade.x > 0.5 && fl < 0.5;
    if (groundShop) {
      if (fu > 0.04 && fu < 0.96 && fv < 0.70) {
        float rib = fract(vFUv.y * 14.0);
        float open = step(0.55, fhash(cell * 3.1 + seed));    // some shutters up, showing dark interior
        vec3 shut = mix(vec3(0.24, 0.26, 0.28), vec3(0.36, 0.38, 0.40), smoothstep(0.2, 0.5, rib) * smoothstep(0.9, 0.6, rib));
        shut *= 0.8 + 0.3 * pn.r;                              // dusty, dented steel
        float rust = smoothstep(0.72, 0.9, texture2D(noiseTex, vFUv / 0.6 + cell).b) * smoothstep(0.5, 0.0, fv);
        shut = mix(shut, vec3(0.22, 0.13, 0.07), rust * 0.35);   // rust creeping up from the bottom
        // open: dark interior with a lit back wall and shelf lines
        vec3 inside = vec3(0.05, 0.045, 0.04) + vec3(0.12, 0.09, 0.05) * smoothstep(0.1, 0.6, fv) * step(0.5, fract(fv * 6.0));
        col = mix(shut, inside, open);
        fRough = mix(0.5, 0.95, open);
      } else if (fv > 0.74 && fv < 0.97) {
        float h = fhash(floor(vFUv.x / 7.0) + seed);
        vec3 sc = mix(vSign, vSign.bgr, step(0.7, h));
        sc *= 0.82 + 0.25 * pn.r;                              // faded flex print
        col = sc;
        if (fv > 0.83 && fv < 0.88 && fract(vFUv.x * 1.7) < 0.6) col = vec3(0.85);  // lettering band
      }
    } else if (vFacade.w > 0.5 && fl < 0.5) {
      // house facing the road: one door / gate per frontage
      float dpos = fract(vFUv.x / 9.0);
      if (dpos > 0.1 && dpos < 0.24 && fv < 0.72) {
        col = vec3(0.22, 0.13, 0.07) * (0.8 + 0.4 * pn.r);
        if (dpos < 0.11 || dpos > 0.23 || fv > 0.71) col *= 0.5;  // frame shadow
      } else if (fu > 0.3 && fu < 0.7 && fv > 0.3 && fv < 0.72) {
        col = vec3(0.07, 0.08, 0.09);
        if (fract(fu * 10.0) < 0.12 || fract(fv * 8.0) < 0.1) col = vec3(0.2, 0.2, 0.19); // grille
      }
    } else if (fu > 0.28 && fu < 0.72 && fv > 0.3 && fv < 0.76) {
      float h = fhash(cell * 7.0 + fl * 13.0 + seed);
      // window recess: reveal shadow on top and one side (sun from the south-west)
      float reveal = max(smoothstep(0.7, 0.76, fv), smoothstep(0.32, 0.28, fu) * 0.6);
      bool frame = fu < 0.31 || fu > 0.69 || fv < 0.33 || fv > 0.73;
      if (frame) col = vec3(0.2, 0.17, 0.14);
      else if (h < 0.25) col = vec3(0.17, 0.25, 0.17) * (0.8 + 0.3 * pn.r); // green wooden shutters
      else if (h < 0.35) col = vec3(0.4, 0.27, 0.14);          // curtain
      else {
        // glass: dim interior, faint sky reflection toward the top of the pane
        col = mix(vec3(0.03, 0.035, 0.04), vec3(0.22, 0.26, 0.3), smoothstep(0.35, 0.73, fv) * 0.5);
        fRough = 0.15;
      }
      if (!frame && h >= 0.35 && fract(fu * 12.0) < 0.12) col = vec3(0.08);   // window grille
      col *= 1.0 - 0.55 * reveal;
    } else if (fu > 0.26 && fu < 0.74 && fv > 0.27 && fv < 0.3) {
      col *= 1.15;                                              // sill
    } else if (fu > 0.3 && fu < 0.7 && fv > 0.12 && fv < 0.27) {
      col *= 1.0 - 0.12 * smoothstep(0.27, 0.12, fv) * smoothstep(0.3, 0.7, pn.g); // drip stain below sill
    }
  } else {
    // roof: stained concrete with dark damp patches and moss toward the edges
    vec4 rn = texture2D(noiseTex, vFUv / 4.0 + so);
    col *= 0.7 * (0.85 + 0.3 * rn.r);
    col = mix(col, vec3(0.08, 0.08, 0.07), smoothstep(0.6, 0.85, rn.b) * 0.5);
    col = mix(col, vec3(0.1, 0.12, 0.06), smoothstep(0.75, 0.9, rn.g) * 0.4);
  }
  diffuseColor.rgb = col;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = fRough;`);
  };
  return mat;
}
