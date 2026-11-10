import * as THREE from 'three';
import { noiseTexture } from './textures';

/** Surface ids, stored in uv.x of flat geometry (uv.y = position across a road ribbon, -1..1). */
export const SURF = { concrete: 0, asphalt: 1, dirt: 2, grass: 3, paving: 4 } as const;

/**
 * World-space surface detail on top of MeshStandardMaterial with vertex colours:
 * asphalt grain, repair patches, cracks and dust toward the kerb; dusty soil; patchy, sun-dried grass;
 * weathered concrete. Vertex colour stays the base tint, so all existing palettes still apply.
 */
export function makeGroundMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.noiseTex = { value: noiseTexture() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vW;
varying vec3 vWN;
varying vec2 vSurf;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWN = normalize(mat3(modelMatrix) * objectNormal);
vSurf = uv;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D noiseTex;
varying vec3 vW;
varying vec3 vWN;
varying vec2 vSurf;
float gRough = 0.95;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  int surf = int(floor(vSurf.x + 0.5));
  float across = vSurf.y;
  vec2 p = abs(vWN.y) > 0.5 ? vW.xz : vec2(vW.x + vW.z, vW.y);
  vec4 n1 = texture2D(noiseTex, p / 6.0);
  vec4 n2 = texture2D(noiseTex, p / 47.0 + 0.37);
  vec4 n3 = texture2D(noiseTex, p / 1.1);
  vec3 col = diffuseColor.rgb;
  if (surf == 1) {                       // asphalt
    float grain = n3.r * 0.6 + n1.r * 0.4;
    col *= 0.8 + 0.4 * grain;
    col *= mix(0.82, 1.15, n2.g);                                   // older / newer laid sections
    col = mix(col, col * 0.75, smoothstep(0.74, 0.8, n1.b) * 0.6);  // tar repair patches
    col *= 1.0 - 0.45 * smoothstep(0.9, 0.97, n1.a);                // cracks
    float edge = smoothstep(0.72, 1.0, abs(across));
    col = mix(col, vec3(0.24, 0.20, 0.14), edge * (0.3 + 0.4 * n1.g));  // dust blown to the edges
    gRough = 0.82 + 0.14 * grain;
  } else if (surf == 2) {                // dusty soil
    col *= mix(0.75, 1.15, n2.b) * (0.82 + 0.36 * n3.r);
    col = mix(col, col * vec3(0.8, 0.82, 0.7), smoothstep(0.55, 0.8, n2.g) * 0.6);
    col = mix(col, vec3(0.15, 0.15, 0.05), smoothstep(0.7, 0.82, n1.g * 0.6 + n3.g * 0.4) * 0.55); // weeds
    col *= 1.0 - 0.25 * smoothstep(0.85, 0.95, n3.a);               // pebbles / footprints
  } else if (surf == 3) {                // grass
    col *= 0.78 + 0.44 * n3.r;
    col = mix(col, vec3(0.26, 0.22, 0.08), smoothstep(0.45, 0.78, n2.b) * 0.65); // sun-dried
    col = mix(col, vec3(0.20, 0.14, 0.08), smoothstep(0.74, 0.88, n1.g) * 0.75); // worn bare earth
    col *= 0.88 + 0.24 * n3.a;
  } else if (surf == 4) {                // paved footpath
    col *= (0.86 + 0.28 * n3.r) * mix(0.85, 1.1, n2.g);
    col = mix(col, col * 0.7, smoothstep(0.72, 0.85, n1.b) * 0.6);  // stains
    col *= 1.0 - 0.3 * smoothstep(0.92, 0.98, n1.a);
    gRough = 0.9;
  } else {                               // weathered concrete
    col *= (0.9 + 0.2 * n3.r) * mix(0.88, 1.08, n1.g);
    col = mix(col, col * 0.75, smoothstep(0.75, 0.9, n2.b) * 0.5);
  }
  diffuseColor.rgb = col;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = gRough;`);
  };
  return mat;
}
