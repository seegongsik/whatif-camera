/**
 * Projects the photo back onto the 3D scene from the camera that took it,
 * like a slide projector. Seen from that camera the scene is the photo, pixel
 * for pixel; as the virtual camera moves away, the photo's building turns
 * into a solid one. A depth map rendered from the photo camera stops the
 * projection from painting surfaces the photo could not see.
 */
import {
  DepthTexture,
  DoubleSide,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  NearestFilter,
  PerspectiveCamera,
  SRGBColorSpace,
  Texture,
  UnsignedIntType,
  Vector3,
  WebGLRenderTarget,
  type Material,
  type Scene,
  type WebGLRenderer,
} from "three";

type Uniform<T> = { value: T };

export type ProjectorUniforms = {
  photoMap: Uniform<Texture | null>;
  photoDepth: Uniform<Texture | null>;
  photoViewProj: Uniform<Matrix4>;
  photoCamPos: Uniform<Vector3>;
  photoNear: Uniform<number>;
  photoFar: Uniform<number>;
  photoDepthOn: Uniform<number>;
};

const VERTEX_HEAD = `
varying vec3 vPhotoWorld;
varying vec3 vPhotoNormal;
`;

const VERTEX_BODY = `
vPhotoWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vPhotoNormal = normalize(mat3(modelMatrix) * normal);
`;

const FRAGMENT_HEAD = `
uniform sampler2D photoMap;
uniform sampler2D photoDepth;
uniform mat4 photoViewProj;
uniform vec3 photoCamPos;
uniform float photoMix;
uniform float photoNear;
uniform float photoFar;
uniform float photoDepthOn;
varying vec3 vPhotoWorld;
varying vec3 vPhotoNormal;
float photoLinearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * photoNear * photoFar) / (photoFar + photoNear - z * (photoFar - photoNear));
}
`;

const FRAGMENT_BODY = `
{
  vec4 photoClip = photoViewProj * vec4(vPhotoWorld, 1.0);
  float photoVis = 0.0;
  vec3 photoColor = vec3(0.0);
  if (photoClip.w > 0.0) {
    vec3 photoNdc = photoClip.xyz / photoClip.w;
    vec2 photoUv = photoNdc.xy * 0.5 + 0.5;
    photoVis = 1.0 - smoothstep(0.99, 1.0, max(abs(photoNdc.x), abs(photoNdc.y)));
    #ifdef PHOTO_FACING
      float photoFacing = dot(normalize(vPhotoNormal), normalize(photoCamPos - vPhotoWorld));
      photoVis *= smoothstep(0.0, 0.08, photoFacing);
    #endif
    if (photoDepthOn > 0.5) {
      float photoStored = photoLinearDepth(texture2D(photoDepth, photoUv).x);
      float photoMine = photoLinearDepth(photoNdc.z * 0.5 + 0.5);
      float photoSlack = 0.4 + photoMine * 0.012;
      photoVis *= 1.0 - smoothstep(photoSlack, photoSlack * 2.0, photoMine - photoStored);
    }
    photoColor = texture2D(photoMap, photoUv).rgb;
  }
  gl_FragColor.rgb = mix(gl_FragColor.rgb, photoColor, clamp(photoMix * photoVis, 0.0, 1.0));
}
`;

export class PhotoProjector {
  readonly camera: PerspectiveCamera;
  readonly uniforms: ProjectorUniforms;
  private readonly target: WebGLRenderTarget;
  private readonly depthMaterial = new MeshBasicMaterial({ side: DoubleSide, colorWrite: false });

  constructor(photo: Texture, camera: PerspectiveCamera) {
    photo.colorSpace = SRGBColorSpace;
    photo.generateMipmaps = false;
    photo.minFilter = LinearFilter;
    photo.magFilter = LinearFilter;
    photo.needsUpdate = true;
    this.camera = camera;
    const w = 1024;
    const h = Math.max(64, Math.round((1024 * 1) / camera.aspect));
    const depthTexture = new DepthTexture(w, h, UnsignedIntType);
    depthTexture.minFilter = NearestFilter;
    depthTexture.magFilter = NearestFilter;
    this.target = new WebGLRenderTarget(w, h, { depthTexture });
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    this.uniforms = {
      photoMap: { value: photo },
      photoDepth: { value: depthTexture },
      photoViewProj: { value: new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse) },
      photoCamPos: { value: camera.getWorldPosition(new Vector3()) },
      photoNear: { value: camera.near },
      photoFar: { value: camera.far },
      photoDepthOn: { value: 0 },
    };
  }

  /** Renders what the photo camera can see (layer 0 only) into the depth map. */
  renderDepth(renderer: WebGLRenderer, scene: Scene): void {
    const previousTarget = renderer.getRenderTarget();
    const previousOverride = scene.overrideMaterial;
    const previousShadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    scene.overrideMaterial = this.depthMaterial;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(previousTarget);
    scene.overrideMaterial = previousOverride;
    renderer.shadowMap.autoUpdate = previousShadows;
    this.uniforms.photoDepthOn.value = 1;
  }

  /** Adds the projection to a built-in material; `mix` fades it in and out. */
  patch(material: Material, mix: Uniform<number>, facingTest: boolean): void {
    const shared = this.uniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared, { photoMix: mix });
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${VERTEX_HEAD}`)
        .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${facingTest ? "#define PHOTO_FACING\n" : ""}${FRAGMENT_HEAD}`)
        .replace("#include <tonemapping_fragment>", `#include <tonemapping_fragment>\n${FRAGMENT_BODY}`);
    };
    material.customProgramCacheKey = () => `photo-projection-${facingTest ? 1 : 0}`;
    material.needsUpdate = true;
  }

  dispose(): void {
    this.target.dispose();
    this.depthMaterial.dispose();
  }
}
