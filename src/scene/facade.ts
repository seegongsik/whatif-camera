/**
 * Facades for the walls the photo did not see: a wall colour, a window grid
 * on the storey height and a concrete roof, drawn in the shader from world
 * position, so the extruded footprints need no texture coordinates. The glass
 * catches the sun, and some windows light up in the evening. Where the photo
 * saw a wall, the projection paints over all of this.
 */
import { Color, Float32BufferAttribute, type BufferGeometry, type Material } from "three";

type Uniform<T> = { value: T };

export type FacadeUniforms = {
  /** 0 = day, 1 = evening with some windows lit. */
  facadeEvening: Uniform<number>;
  facadeRoof: Uniform<Color>;
  facadeGlass: Uniform<Color>;
};

/** Width of one window bay along a wall, metres. */
export const FACADE_BAY_M = 3.6;

/** Muted wall colours for neighbours, picked per building. */
const NEIGHBOUR_WALLS = ["#d9d6cf", "#cfcbc3", "#c6c1b8", "#e2dfd8", "#c9c4bb", "#d4d2cd", "#bfbab2", "#cdc5b8"].map((hex) => new Color(hex));

export function facadeUniforms(): FacadeUniforms {
  return {
    facadeEvening: { value: 0 },
    facadeRoof: { value: new Color("#a19d95") },
    facadeGlass: { value: new Color("#647689") },
  };
}

/** A stable wall colour for a building id. */
export function neighbourWall(id: string): Color {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return NEIGHBOUR_WALLS[(hash >>> 0) % NEIGHBOUR_WALLS.length];
}

/**
 * Stores one building's wall colour, roof height, storey height and lit-window
 * seed on its vertices. A storey height of 0 draws a plain wall.
 */
export function setFacade(geometry: BufferGeometry, wall: Color, topM: number, storeyM: number, seed: number): void {
  const count = geometry.getAttribute("position").count;
  const walls = new Float32Array(count * 3);
  const grid = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    walls.set([wall.r, wall.g, wall.b], i * 3);
    grid.set([topM, storeyM, seed], i * 3);
  }
  geometry.setAttribute("facadeWall", new Float32BufferAttribute(walls, 3));
  geometry.setAttribute("facadeGrid", new Float32BufferAttribute(grid, 3));
}

const VERTEX_HEAD = `
attribute vec3 facadeWall;
attribute vec3 facadeGrid;
varying vec3 vFacadeWorld;
varying vec3 vFacadeNormal;
varying vec3 vFacadeWall;
varying vec3 vFacadeGrid;
`;

const VERTEX_BODY = `
vFacadeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vFacadeNormal = normalize(mat3(modelMatrix) * normal);
vFacadeWall = facadeWall;
vFacadeGrid = facadeGrid;
`;

const FRAGMENT_HEAD = `
uniform float facadeEvening;
uniform vec3 facadeRoof;
uniform vec3 facadeGlass;
varying vec3 vFacadeWorld;
varying vec3 vFacadeNormal;
varying vec3 vFacadeWall;
varying vec3 vFacadeGrid;
// 1 inside [a, b] of every unit cell. Far away, where a cell shrinks to a
// pixel, it turns into the cell's average so the grid does not shimmer.
float facadeBand(float x, float a, float b) {
  float w = clamp(fwidth(x), 1e-4, 1.0);
  float f = fract(x);
  float band = smoothstep(a - w, a + w, f) - smoothstep(b - w, b + w, f);
  return mix(band, b - a, smoothstep(0.2, 0.5, w));
}
`;

// Walls run along the horizontal tangent of their normal; grid.x is the roof
// height (no windows in the parapet), grid.y the storey height, grid.z a seed.
const FRAGMENT_COLOR = `
vec3 facadeN = normalize(vFacadeNormal);
float facadeIsRoof = smoothstep(0.4, 0.6, abs(facadeN.y));
vec2 facadeAlong = normalize(vec2(-facadeN.z, facadeN.x) + vec2(1e-6, 0.0));
vec2 facadeCell = vec2(dot(vFacadeWorld.xz, facadeAlong) / ${FACADE_BAY_M.toFixed(2)}, vFacadeWorld.y / max(vFacadeGrid.y, 0.5));
float facadeWindow = facadeBand(facadeCell.x, 0.2, 0.8) * facadeBand(facadeCell.y, 0.3, 0.86)
  * step(vFacadeWorld.y, vFacadeGrid.x - 1.0) * (1.0 - facadeIsRoof) * step(0.5, vFacadeGrid.y);
float facadeLit = facadeWindow * step(0.55, fract(sin(dot(floor(facadeCell), vec2(127.1, 311.7)) + vFacadeGrid.z * 13.7) * 43758.5453));
diffuseColor.rgb = mix(mix(vFacadeWall, facadeGlass, facadeWindow), facadeRoof, facadeIsRoof);
`;

const FRAGMENT_ROUGHNESS = `
roughnessFactor = mix(roughnessFactor, 0.25, facadeWindow);
`;

const FRAGMENT_EMISSIVE = `
totalEmissiveRadiance += facadeLit * facadeEvening * vec3(1.0, 0.68, 0.38) * 1.5;
`;

/** Adds the facade to a MeshStandardMaterial, after whatever patch it already has. */
export function patchFacade(material: Material, uniforms: FacadeUniforms): void {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_HEAD}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_HEAD}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${FRAGMENT_COLOR}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${FRAGMENT_ROUGHNESS}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${FRAGMENT_EMISSIVE}`);
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}-facade`;
  material.needsUpdate = true;
}
