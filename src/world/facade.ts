import * as THREE from 'three';

/**
 * Procedural Kanpur facade on top of MeshStandardMaterial (keeps lights, shadows, fog).
 * Port of kanpur/game/shaders/building.gdshader.
 *   uv       = (meters along perimeter, meters above base)
 *   facade   = (shop, wall, seed, front)  shop: ground floor shutters on this wall; wall: 0 = roof;
 *              front: wall faces a road (gets door / gate)
 *   signColor= signboard colour for shop rows
 */
export function makeFacadeMaterial(floorH: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.floorH = { value: floorH };
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
varying vec4 vFacade;
varying vec3 vSign;
varying vec2 vFUv;
float fhash(float n) { return fract(sin(n) * 43758.5453); }
float fRough = 0.92;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 col = diffuseColor.rgb;
  float seed = vFacade.z * 97.0;
  if (vFacade.y > 0.5) {
    float bay = 3.0 + floor(fhash(seed) * 2.0) * 0.6;       // window bay width varies per building
    float fu = fract(vFUv.x / bay);
    float cell = floor(vFUv.x / bay);
    float fv = fract(vFUv.y / floorH);
    float fl = floor(vFUv.y / floorH);
    // weathering: darker near the ground, monsoon streaks
    col *= mix(0.78, 1.0, smoothstep(0.0, 1.2, vFUv.y));
    col *= 1.0 - 0.07 * step(0.82, fhash(floor(vFUv.x * 1.3) + seed));
    // floor slab / chajja line
    if (fv < 0.06 && fl > 0.0) col *= 0.72;
    bool groundShop = vFacade.x > 0.5 && fl < 0.5;
    if (groundShop) {
      if (fu > 0.04 && fu < 0.96 && fv < 0.70) {
        float stripe = step(0.5, fract(vFUv.y * 7.0));
        float open = step(0.55, fhash(cell * 3.1 + seed));    // some shutters up, showing dark interior
        vec3 shut = mix(vec3(0.42, 0.44, 0.46), vec3(0.56, 0.58, 0.6), stripe);
        col = mix(shut, vec3(0.08, 0.07, 0.06), open);
        fRough = 0.55;
      } else if (fv > 0.74 && fv < 0.97) {
        float h = fhash(floor(vFUv.x / 7.0) + seed);
        col = mix(vSign, vSign.bgr, step(0.7, h));
        if (fv > 0.83 && fv < 0.88 && fract(vFUv.x * 1.7) < 0.6) col = vec3(0.97);  // lettering band
      }
    } else if (vFacade.w > 0.5 && fl < 0.5) {
      // house facing the road: one door / gate per frontage
      float dpos = fract(vFUv.x / 9.0);
      if (dpos > 0.1 && dpos < 0.24 && fv < 0.72) col = vec3(0.30, 0.18, 0.10);
      else if (fu > 0.3 && fu < 0.7 && fv > 0.3 && fv < 0.72) col = vec3(0.16, 0.18, 0.2);
    } else if (fu > 0.28 && fu < 0.72 && fv > 0.3 && fv < 0.76) {
      bool frame = fu < 0.32 || fu > 0.68 || fv < 0.34 || fv > 0.72;
      float h = fhash(cell * 7.0 + fl * 13.0 + seed);
      if (frame) col = vec3(0.32, 0.26, 0.2);
      else if (h < 0.25) col = vec3(0.33, 0.43, 0.3);          // green wooden shutters
      else if (h < 0.35) col = vec3(0.55, 0.42, 0.25);         // curtain
      else { col = vec3(0.10, 0.13, 0.17); fRough = 0.25; }    // glass
      // window grille
      if (!frame && h >= 0.35 && (fract(fu * 12.0) < 0.12)) col = vec3(0.12);
    }
    // parapet band at the top
  } else {
    col *= 0.8;   // roof: same tone, darker (concrete roofs are painted / stained)
  }
  diffuseColor.rgb = col;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = fRough;`);
  };
  return mat;
}
