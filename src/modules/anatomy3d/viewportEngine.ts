import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildAnatomyModel, createContactShadowTexture, type BuiltAnatomyModel } from './builders.ts';
import { getAnatomyModel, type AnatomyModelId } from './modelsData.ts';

// Pre-allocated math helpers (zero GC inside animation loop)
const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();
const _targetPos = new THREE.Vector3();
const _camGoalPos = new THREE.Vector3();
const _camGoalTarget = new THREE.Vector3();
const _emissiveSelected = new THREE.Color(0x3b82f6);
const _emissiveHover = new THREE.Color(0x64748b);
const _emissiveCorrect = new THREE.Color(0x10b981);
const _emissiveWrong = new THREE.Color(0xf43f5e);
const _emissiveZero = new THREE.Color(0x000000);

function detectSoftwareGl(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export interface AnatomyViewportCallbacks {
  onSelectPart: (partId: string | null) => void;
  onWebglError?: () => void;
}

export class AnatomyViewportEngine {
  private container: HTMLElement;
  private callbacks: AnatomyViewportCallbacks;
  private isSoftwareGl: boolean;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls | null = null;
  private envRenderTarget: THREE.WebGLRenderTarget | null = null;
  private shadowPlane: THREE.Mesh | null = null;
  private shadowTex: THREE.CanvasTexture | null = null;

  private currentModelId: AnatomyModelId = 'cell';
  private builtModel: BuiltAnatomyModel | null = null;
  private selectedPartId: string | null = null;
  private hoveredPartId: string | null = null;
  private flashPartId: string | null = null;
  private flashTone: 'correct' | 'wrong' | null = null;
  private flashTimer: number | null = null;

  private explodeTarget = 0;
  private explodeCurrent = 0;
  private xrayMode = false;
  private autoRotateEnabled = false;
  private isDarkTheme = true;

  private cameraAnimActive = false;
  private frameId = 0;
  private renderBusy = false;
  private renderDirty = false;
  private lastTickTime = 0;
  private disposed = false;

  private resizeObserver: ResizeObserver | null = null;
  private pointerDownX = 0;
  private pointerDownY = 0;
  private pointerMoved = false;
  private lastHoverCast = 0;

  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundContextLost: (e: Event) => void;
  private boundContextRestored: () => void;

  constructor(container: HTMLElement, callbacks: AnatomyViewportCallbacks, darkTheme: boolean) {
    this.container = container;
    this.callbacks = callbacks;
    this.isDarkTheme = darkTheme;
    this.isSoftwareGl = detectSoftwareGl();

    this.scene = new THREE.Scene();
    const w = Math.max(container.clientWidth, 320);
    const h = Math.max(container.clientHeight, 320);
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 60);
    this.camera.position.set(0.3, 1.5, 4.9);

    _raycaster.layers.set(1);

    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundContextLost = this.handleContextLost.bind(this);
    this.boundContextRestored = this.handleContextRestored.bind(this);

    this.initRenderer(w, h);
    this.setupLightingAndStage();
  }

  private initRenderer(width: number, height: number): void {
    try {
      const renderer = new THREE.WebGLRenderer({
        antialias: !this.isSoftwareGl,
        powerPreference: 'high-performance',
        alpha: false,
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      renderer.shadowMap.enabled = !this.isSoftwareGl;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.touchAction = 'none';

      this.container.innerHTML = '';
      this.container.appendChild(renderer.domElement);
      this.renderer = renderer;

      // Studio environment reflections (RoomEnvironment via PMREMGenerator on every device)
      const pmrem = new THREE.PMREMGenerator(renderer);
      const roomEnv = new RoomEnvironment();
      this.envRenderTarget = pmrem.fromScene(roomEnv, 0.04);
      this.scene.environment = this.envRenderTarget.texture;
      roomEnv.dispose();
      pmrem.dispose();

      // OrbitControls
      const controls = new OrbitControls(this.camera, renderer.domElement);
      controls.enableDamping = !this.isSoftwareGl;
      controls.dampingFactor = 0.07;
      controls.enablePan = false;
      controls.minDistance = 2.1;
      controls.maxDistance = 9.2;
      controls.rotateSpeed = 0.78;
      controls.zoomSpeed = 0.9;
      controls.autoRotate = false;
      controls.autoRotateSpeed = 1.4;
      controls.addEventListener('start', () => {
        this.cameraAnimActive = false;
      });
      controls.addEventListener('change', () => {
        this.requestRender();
      });
      this.controls = controls;

      // Events
      const canvas = renderer.domElement;
      canvas.addEventListener('pointerdown', this.boundPointerDown);
      canvas.addEventListener('pointermove', this.boundPointerMove);
      canvas.addEventListener('pointerup', this.boundPointerUp);
      canvas.addEventListener('webglcontextlost', this.boundContextLost, false);
      canvas.addEventListener('webglcontextrestored', this.boundContextRestored, false);

      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(this.container);
    } catch {
      this.callbacks.onWebglError?.();
    }
  }

  private setupLightingAndStage(): void {
    this.applyBackdropColor();

    // Warm key directional light with tight shadow frustum
    const keyLight = new THREE.DirectionalLight(0xfff6ea, 2.2);
    keyLight.position.set(4.5, 6.2, 5.4);
    keyLight.castShadow = !this.isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 18;
    keyLight.shadow.camera.left = -3.2;
    keyLight.shadow.camera.right = 3.2;
    keyLight.shadow.camera.top = 3.2;
    keyLight.shadow.camera.bottom = -3.2;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    this.scene.add(keyLight);

    // Cool sky / neutral ground hemisphere fill
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x334155, 0.95);
    this.scene.add(hemiLight);

    // Crisp rim light to separate anatomical silhouettes cleanly
    const rimLight = new THREE.DirectionalLight(0x93c5fd, 1.1);
    rimLight.position.set(-4.8, 3.0, -5.2);
    this.scene.add(rimLight);

    // Grounded studio contact shadow disc beneath the model
    this.shadowTex = createContactShadowTexture();
    const shadowMat = new THREE.MeshBasicMaterial({
      map: this.shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: this.isDarkTheme ? 0.55 : 0.34,
    });
    const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -2.28;
    this.scene.add(shadowPlane);
    this.shadowPlane = shadowPlane;
  }

  private applyBackdropColor(): void {
    const bgHex = this.isDarkTheme ? 0x0b1220 : 0xeef3f9;
    this.scene.background = new THREE.Color(bgHex);
    this.scene.fog = new THREE.FogExp2(bgHex, 0.042);
    if (this.shadowPlane) {
      const m = this.shadowPlane.material as THREE.MeshBasicMaterial;
      m.opacity = this.isDarkTheme ? 0.55 : 0.34;
    }
  }

  public setDarkTheme(dark: boolean): void {
    if (this.isDarkTheme === dark) return;
    this.isDarkTheme = dark;
    this.applyBackdropColor();
    this.requestRender();
  }

  public loadModel(modelId: AnatomyModelId, initialPartId?: string | null): void {
    this.clearCurrentModel();
    this.currentModelId = modelId;
    this.selectedPartId = initialPartId || null;
    this.hoveredPartId = null;
    this.explodeTarget = 0;
    this.explodeCurrent = 0;

    const maxAniso = this.renderer ? this.renderer.capabilities.getMaxAnisotropy() : 1;
    const built = buildAnatomyModel(modelId, maxAniso, this.isSoftwareGl);
    this.builtModel = built;
    this.scene.add(built.root);

    if (this.renderer && !this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    const spec = getAnatomyModel(modelId);
    this.camera.position.set(...spec.cameraPos);
    if (this.controls) {
      this.controls.target.set(...spec.cameraTarget);
      this.controls.update();
    }
    this.cameraAnimActive = false;

    if (initialPartId) {
      this.focusPart(initialPartId, false);
    } else {
      this.applyPartVisualStates();
    }
    this.requestRender();
  }

  private clearCurrentModel(): void {
    if (!this.builtModel) return;
    this.scene.remove(this.builtModel.root);
    this.builtModel.disposables.geometries.forEach((g) => g.dispose());
    this.builtModel.disposables.materials.forEach((m) => m.dispose());
    this.builtModel.disposables.textures.forEach((t) => t.dispose());
    this.builtModel = null;
  }

  public setExplode(amount: number): void {
    this.explodeTarget = THREE.MathUtils.clamp(amount, 0, 1);
    this.requestRender();
  }

  public setXray(enabled: boolean): void {
    this.xrayMode = enabled;
    this.applyPartVisualStates();
    this.requestRender();
  }

  public setAutoRotate(enabled: boolean): void {
    this.autoRotateEnabled = enabled && !this.isSoftwareGl;
    if (this.controls) {
      this.controls.autoRotate = this.autoRotateEnabled;
    }
    this.requestRender();
  }

  public resetCamera(): void {
    const spec = getAnatomyModel(this.currentModelId);
    _camGoalPos.set(...spec.cameraPos);
    _camGoalTarget.set(...spec.cameraTarget);
    this.cameraAnimActive = true;
    this.requestRender();
  }

  public selectPart(partId: string | null, flyCamera = true): void {
    this.selectedPartId = partId;
    this.applyPartVisualStates();
    if (partId && flyCamera) {
      this.focusPart(partId, true);
    }
    this.requestRender();
  }

  public flashQuizFeedback(partId: string, tone: 'correct' | 'wrong'): void {
    if (this.flashTimer) window.clearTimeout(this.flashTimer);
    this.flashPartId = partId;
    this.flashTone = tone;
    this.applyPartVisualStates();
    this.requestRender();
    this.flashTimer = window.setTimeout(() => {
      this.flashPartId = null;
      this.flashTone = null;
      this.applyPartVisualStates();
      this.requestRender();
    }, 900);
  }

  private focusPart(partId: string, animate: boolean): void {
    const spec = getAnatomyModel(this.currentModelId);
    const partInfo = spec.parts.find((p) => p.id === partId);
    const handle = this.builtModel?.parts.get(partId);
    if (!partInfo || !handle) return;

    // Compute world center of the selected part group
    const box = new THREE.Box3().setFromObject(handle.group);
    box.getCenter(_camGoalTarget);
    _camGoalPos.set(...partInfo.focusOffset);

    if (!animate || this.isSoftwareGl) {
      this.camera.position.copy(_camGoalPos);
      if (this.controls) {
        this.controls.target.copy(_camGoalTarget);
        this.controls.update();
      }
      this.cameraAnimActive = false;
    } else {
      this.cameraAnimActive = true;
    }
    this.applyPartVisualStates();
  }

  private applyPartVisualStates(): void {
    if (!this.builtModel) return;

    this.builtModel.parts.forEach((handle, partId) => {
      const isSelected = partId === this.selectedPartId;
      const isHovered = partId === this.hoveredPartId && !isSelected;
      const isFlashed = partId === this.flashPartId;
      const isMembraneShell = this.currentModelId === 'cell' && partId === 'membrane';
      const dimByXray = this.xrayMode && !isSelected && !isFlashed;

      handle.meshes.forEach((mesh) => {
        const mat = mesh.material as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
        if (!mat || !('color' in mat)) return;

        // Store pristine defaults once
        if (mesh.userData._origOpacity === undefined) {
          mesh.userData._origOpacity = mat.opacity;
          mesh.userData._origTransparent = mat.transparent;
          mesh.userData._origDepthWrite = mat.depthWrite;
        }

        if (isFlashed && this.flashTone) {
          mat.emissive.copy(this.flashTone === 'correct' ? _emissiveCorrect : _emissiveWrong);
          mat.emissiveIntensity = 0.62;
        } else if (isSelected) {
          mat.emissive.copy(_emissiveSelected);
          mat.emissiveIntensity = 0.38;
        } else if (isHovered) {
          mat.emissive.copy(_emissiveHover);
          mat.emissiveIntensity = 0.22;
        } else {
          mat.emissive.copy(_emissiveZero);
          mat.emissiveIntensity = 0;
        }

        if (dimByXray) {
          mat.transparent = true;
          mat.opacity = isMembraneShell ? 0.1 : 0.22;
          mat.depthWrite = false;
        } else {
          mat.transparent = Boolean(mesh.userData._origTransparent);
          mat.opacity = Number(mesh.userData._origOpacity);
          mat.depthWrite = Boolean(mesh.userData._origDepthWrite);
        }
        mat.needsUpdate = true;
      });
    });
  }

  private updatePointerNdc(e: PointerEvent): boolean {
    if (!this.renderer) return false;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    _pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    return true;
  }

  private pickPartAtPointer(): string | null {
    if (!this.builtModel) return null;
    _raycaster.setFromCamera(_pointer, this.camera);
    const hits = _raycaster.intersectObjects(this.builtModel.pickables, false);
    if (!hits.length) return null;

    // On Cell model, prefer clicking an internal organelle over the translucent outer plasma membrane
    if (this.currentModelId === 'cell' && hits.length > 1) {
      const innerHit = hits.find((h) => h.object.userData.partId !== 'membrane');
      if (innerHit) return String(innerHit.object.userData.partId || '');
    }
    return String(hits[0].object.userData.partId || '') || null;
  }

  private handlePointerDown(e: PointerEvent): void {
    this.pointerDownX = e.clientX;
    this.pointerDownY = e.clientY;
    this.pointerMoved = false;
  }

  private handlePointerMove(e: PointerEvent): void {
    const dx = e.clientX - this.pointerDownX;
    const dy = e.clientY - this.pointerDownY;
    if (dx * dx + dy * dy > 42) {
      this.pointerMoved = true;
    }

    if (e.pointerType !== 'mouse' || !this.renderer) return;
    const now = performance.now();
    if (now - this.lastHoverCast < 55) return;
    this.lastHoverCast = now;

    if (!this.updatePointerNdc(e)) return;
    const hitId = this.pickPartAtPointer();
    if (hitId !== this.hoveredPartId) {
      this.hoveredPartId = hitId;
      this.renderer.domElement.style.cursor = hitId ? 'pointer' : 'grab';
      this.applyPartVisualStates();
      this.requestRender();
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.pointerMoved) return;
    if (!this.updatePointerNdc(e)) return;
    const hitId = this.pickPartAtPointer();
    this.callbacks.onSelectPart(hitId);
  }

  private handleContextLost(e: Event): void {
    e.preventDefault();
    this.cancelPendingFrames();
  }

  private handleContextRestored(): void {
    this.loadModel(this.currentModelId, this.selectedPartId);
  }

  public handleResize(): void {
    if (!this.renderer || this.disposed) return;
    const w = Math.max(this.container.clientWidth, 240);
    const h = Math.max(this.container.clientHeight, 240);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.requestRender();
  }

  private afterDraw(cb: () => void): void {
    if (!this.renderer || this.disposed) return;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  public requestRender(): void {
    if (this.disposed || !this.renderer) return;
    if (this.renderBusy) {
      this.renderDirty = true;
      return;
    }
    this.renderBusy = true;
    this.frameId = requestAnimationFrame((now) => {
      if (this.disposed || !this.renderer) return;
      this.renderDirty = false;
      const dt = this.lastTickTime ? Math.min((now - this.lastTickTime) / 1000, 0.08) : 0.016;
      this.lastTickTime = now;

      let needsMoreFrames = false;

      // Smooth damped Exploded View separation
      if (Math.abs(this.explodeCurrent - this.explodeTarget) > 0.002) {
        this.explodeCurrent = this.isSoftwareGl
          ? this.explodeTarget
          : THREE.MathUtils.damp(this.explodeCurrent, this.explodeTarget, 8.5, dt);
        needsMoreFrames = Math.abs(this.explodeCurrent - this.explodeTarget) > 0.002;
      } else {
        this.explodeCurrent = this.explodeTarget;
      }

      if (this.builtModel) {
        this.builtModel.parts.forEach((handle) => {
          _targetPos.copy(handle.basePos).addScaledVector(handle.explodeVec, this.explodeCurrent);
          handle.group.position.copy(_targetPos);
        });
      }

      // Smooth damped camera fly-to transition
      if (this.cameraAnimActive && this.controls) {
        const lambda = 7.5;
        this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _camGoalPos.x, lambda, dt);
        this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _camGoalPos.y, lambda, dt);
        this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _camGoalPos.z, lambda, dt);
        this.controls.target.x = THREE.MathUtils.damp(this.controls.target.x, _camGoalTarget.x, lambda, dt);
        this.controls.target.y = THREE.MathUtils.damp(this.controls.target.y, _camGoalTarget.y, lambda, dt);
        this.controls.target.z = THREE.MathUtils.damp(this.controls.target.z, _camGoalTarget.z, lambda, dt);

        const posDist = this.camera.position.distanceTo(_camGoalPos);
        const tgtDist = this.controls.target.distanceTo(_camGoalTarget);
        if (posDist < 0.025 && tgtDist < 0.025) {
          this.camera.position.copy(_camGoalPos);
          this.controls.target.copy(_camGoalTarget);
          this.cameraAnimActive = false;
        } else {
          needsMoreFrames = true;
        }
      }

      if (this.controls) {
        const controlsChanged = this.controls.update();
        if (controlsChanged || this.autoRotateEnabled) {
          needsMoreFrames = true;
        }
      }

      this.renderer.render(this.scene, this.camera);

      const done = () => {
        this.renderBusy = false;
        if (this.disposed) return;
        if (this.renderDirty || needsMoreFrames) {
          this.requestRender();
        }
      };

      if (this.isSoftwareGl) {
        this.afterDraw(done);
      } else {
        done();
      }
    });
  }

  private cancelPendingFrames(): void {
    cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.frameId);
    if (this.flashTimer) window.clearTimeout(this.flashTimer);
    this.renderBusy = false;
    this.renderDirty = false;
  }

  public dispose(): void {
    this.disposed = true;
    this.cancelPendingFrames();
    this.resizeObserver?.disconnect();
    this.clearCurrentModel();

    if (this.shadowPlane) {
      this.shadowPlane.geometry.dispose();
      (this.shadowPlane.material as THREE.Material).dispose();
    }
    this.shadowTex?.dispose();
    this.envRenderTarget?.dispose();
    this.controls?.dispose();

    if (this.renderer) {
      const canvas = this.renderer.domElement;
      canvas.removeEventListener('pointerdown', this.boundPointerDown);
      canvas.removeEventListener('pointermove', this.boundPointerMove);
      canvas.removeEventListener('pointerup', this.boundPointerUp);
      canvas.removeEventListener('webglcontextlost', this.boundContextLost);
      canvas.removeEventListener('webglcontextrestored', this.boundContextRestored);
      this.renderer.dispose();
      canvas.remove();
      this.renderer = null;
    }
  }
}
