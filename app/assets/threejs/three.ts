import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export default class Sketch {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private mesh!: THREE.Mesh;
  private material!: THREE.ShaderMaterial;
  private clock!: THREE.Clock;
  private container: HTMLElement;
  private width: number;
  private height: number;
  private animationId: number = 0;
  private windForce: number = 0;

  private vertexShader = `
    uniform float uTime;
    uniform float uWindStrength;
    uniform float uFabricFreq;
    
    varying vec2 vUv;
    varying float vZ;

    void main() {
        vUv = uv;
        vec3 pos = position;

        float looseFactor = 1.0 - uv.y; 
        float pinInfluence = pow(looseFactor, 1.8);

        float wave1 = sin(uv.x * 5.0 + uTime * 2.0);
        float wave2 = sin(uv.x * 12.0 + uTime * 4.0 + uv.y * 5.0); 
        float wave3 = sin(uTime * 1.5); 
        
        float ripples = (wave1 * 0.5 + wave2 * 0.2 + wave3 * 0.3);
        float displacement = (uWindStrength * 2.0 + ripples * uFabricFreq) * pinInfluence;
        
        pos.y += (sin(displacement) * 0.1) * pinInfluence;
        pos.z += displacement;

        vZ = displacement;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;

  private fragmentShader = `
    uniform sampler2D uTexture;
    uniform float uRatio; 
    uniform float uEdgeScale;
    uniform float uEdgeAmp;
    uniform float uFrameSize;
    uniform float uPhotoInset;
    uniform vec3 uPaperColor;
    uniform float uScratchAmp;
    uniform float uGrainAmp;
    uniform float uVignette;
    uniform float uSeed;
    uniform float uShadowOpacity; 
    uniform vec3 uEdgeShadowColor; 
    uniform float uEdgeShadowOpacity; 
    
    varying vec2 vUv;
    varying float vZ;

    vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
    
    float snoise(vec2 v){
        const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy) );
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1;
        i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod(i, 289.0);
        vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m ;
        m = m*m ;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }
    
    float fbm(vec2 x) {
        float v = 0.0; 
        float a = 0.5; 
        vec2 shift = vec2(100.0);
        mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));
        for (int i = 0; i < 5; ++i) { 
            v += a * snoise(x + uSeed); 
            x = rot * x * 2.0 + shift; 
            a *= 0.5; 
        }
        return v;
    }

    void main() {
        vec2 uv = vUv - 0.5;
        vec2 aspectUV = uv;
        aspectUV.x *= uRatio; 

        float noise = fbm(aspectUV * uEdgeScale); 
        float dist = max(abs(uv.x), abs(uv.y));
        float raggedDist = dist + noise * uEdgeAmp;

        float borderLimit = 0.5 - uFrameSize; 
        float alpha = 1.0 - smoothstep(borderLimit, borderLimit + 0.01, raggedDist);
        if (alpha < 0.01) discard;

        float paperGrain = fbm(vUv * 60.0);
        vec3 paperCol = uPaperColor - paperGrain * 0.05;

        vec4 photoTex = texture2D(uTexture, vUv);
        float photoNoise = snoise(aspectUV * 30.0) * 0.005;
        float photoDist = max(abs(uv.x), abs(uv.y)) + photoNoise;
        float photoLimit = borderLimit - uPhotoInset;
        float photoMask = 1.0 - smoothstep(photoLimit, photoLimit + 0.02, photoDist);

        float scratches = snoise(vec2(vUv.x * 300.0, vUv.y * 3.0));
        float dust = fbm(vUv * 40.0 + uSeed);
        
        vec3 grungePhoto = photoTex.rgb;
        grungePhoto = mix(grungePhoto, vec3(0.6, 0.5, 0.4), dust * uGrainAmp); 
        grungePhoto -= scratches * uScratchAmp;
        float len = length(uv); 
        grungePhoto -= len * uVignette;

        vec3 finalRGB = mix(paperCol, grungePhoto, photoMask);
        finalRGB += vZ * uShadowOpacity;

        float edgeShadowFactor = smoothstep(borderLimit - 0.05, borderLimit, raggedDist);
        finalRGB = mix(finalRGB, uEdgeShadowColor, edgeShadowFactor * uEdgeShadowOpacity);

        gl_FragColor = vec4(finalRGB, 1.0);
    }
  `;

  constructor(options: { dom: HTMLElement; imageUrl?: string }) {
    if (typeof window === 'undefined') {
      throw new Error('Three.js can only be initialized on the client side.');
    }
    
    this.container = options.dom;
    this.width = this.container.offsetWidth || window.innerWidth;
    this.height = this.container.offsetHeight || window.innerHeight;
    
    if (this.width === 0) this.width = window.innerWidth;
    if (this.height === 0) this.height = window.innerHeight;

    try {
      this.setupScene();
      this.setupCamera();
      this.setupRenderer();
      this.addObjects();
      this.loadTexture(options.imageUrl || '/soon_to_be_portfolio.png');
      this.resize();
      this.render();
    } catch (error) {
      console.error('Error initializing Three.js scene:', error);
      throw error;
    }
  }

  private setupScene(): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f0f0f);
  }

  private setupCamera(): void {
    this.camera = new THREE.PerspectiveCamera(
      45,
      this.width / this.height,
      0.1,
      100
    );
    this.camera.position.set(0, 0, 2.5);
  }

  private isWebGLAvailable(): boolean {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      return !!gl;
    } catch (e) {
      return false;
    }
  }

  private setupRenderer(): void {
    if (!this.isWebGLAvailable()) {
      console.warn('WebGL is not available.');
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = 'padding: 20px; color: white; text-align: center;';
      errorDiv.innerHTML = '<p>WebGL is not available in your browser.</p><p>Please enable WebGL in your browser settings or try a different browser.</p>';
      this.container.appendChild(errorDiv);
      throw new Error('WebGL is not available.');
    }

    try {
      if (this.width <= 0 || this.height <= 0) {
        this.width = window.innerWidth || 800;
        this.height = window.innerHeight || 600;
      }

      while (this.container.firstChild) {
        this.container.removeChild(this.container.firstChild);
      }

      let rendererOptions: THREE.WebGLRendererParameters = {
        antialias: true,
        alpha: true,
        powerPreference: 'default',
        failIfMajorPerformanceCaveat: false,
      };

      try {
        this.renderer = new THREE.WebGLRenderer(rendererOptions);
      } catch (e) {
        console.warn('Failed with default options, trying minimal options...');
        rendererOptions = {
          alpha: true,
          failIfMajorPerformanceCaveat: false,
        };
        this.renderer = new THREE.WebGLRenderer(rendererOptions);
      }
      
      const gl = this.renderer.getContext();
      if (!gl) {
        throw new Error('Failed to create WebGL context.');
      }

      const canvas = this.renderer.domElement;
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        console.warn('WebGL context lost. Attempting to restore...');
      });

      canvas.addEventListener('webglcontextrestored', () => {
        console.log('WebGL context restored.');
      });
      
      this.renderer.setSize(this.width, this.height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      
      this.container.appendChild(this.renderer.domElement);
    } catch (error) {
      console.error('Error creating WebGL renderer:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = 'padding: 20px; color: white; text-align: center;';
      errorDiv.innerHTML = `
        <p><strong>WebGL Error</strong></p>
        <p>${errorMessage}</p>
        <p>Please check your browser settings and ensure WebGL is enabled.</p>
      `;
      this.container.appendChild(errorDiv);
      
      throw new Error(`Error creating WebGL context: ${errorMessage}`);
    }
  }


  private addObjects(): void {
    const geometry = new THREE.PlaneGeometry(1, 1, 64, 64);

    this.material = new THREE.ShaderMaterial({
      vertexShader: this.vertexShader,
      fragmentShader: this.fragmentShader,
      uniforms: {
        uTexture: { value: null },
        uRatio: { value: 1.0 },
        uTime: { value: 0 },
        uWindStrength: { value: 0.2 },
        uFabricFreq: { value: 0.238 },
        uShadowOpacity: { value: 0.215 },
        uEdgeScale: { value: 5.522 },
        uEdgeAmp: { value: 0.055 },
        uFrameSize: { value: 0.0 },
        uPhotoInset: { value: 0.0034 },
        uPaperColor: { value: new THREE.Color(0x8c91ab) },
        uScratchAmp: { value: 0.004276 },
        uGrainAmp: { value: 0.02145 },
        uVignette: { value: 0.398 },
        uSeed: { value: 0.0 },
        uEdgeShadowColor: { value: new THREE.Color(0x8c91ab) },
        uEdgeShadowOpacity: { value: 0.11 },
      },
      side: THREE.DoubleSide,
      transparent: true,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.y = 0.0;
    this.mesh.rotation.y = -0.5;
    this.scene.add(this.mesh);
  }

  private applyTexture(texture: THREE.Texture, width: number, height: number): void {
    if (!this.material || !this.mesh || !this.material.uniforms) return;
    
    const uniforms = this.material.uniforms;
    if (uniforms.uTexture && uniforms.uRatio) {
      uniforms.uTexture.value = texture;
      
      const aspect = width / height;
      uniforms.uRatio.value = aspect;
      
      const baseHeight = 1.3;
      this.mesh.scale.set(baseHeight * aspect, baseHeight, 1);
    }
  }

  private loadTexture(imageUrl: string): void {
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      imageUrl,
      (tex: THREE.Texture) => {
        const img = tex.image as HTMLImageElement;
        if (img) {
          this.applyTexture(tex, img.width, img.height);
        }
      },
      undefined,
      (error: unknown) => {
        console.error('Error loading texture:', error);
      }
    );
  }

  private handleResize = (): void => {
    this.width = this.container.offsetWidth || window.innerWidth;
    this.height = this.container.offsetHeight || window.innerHeight;
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  };

  private resize(): void {
    window.addEventListener('resize', this.handleResize);
  }

  private render = (): void => {
    this.animationId = requestAnimationFrame(this.render);
    
    if (!this.clock) {
      this.clock = new THREE.Clock();
    }
    
    if (!this.material || !this.material.uniforms) return;
    
    const uniforms = this.material.uniforms;
    if (!uniforms.uTime || !uniforms.uWindStrength) return;
    
    const time = this.clock.getElapsedTime();
    uniforms.uTime.value = time;
    
    let gust = (Math.sin(time * 0.7) + Math.sin(time * 2.3) * 0.5) + 0.5;
    gust = Math.max(0.0, gust);
    
    uniforms.uWindStrength.value = gust * this.windForce * 0.3;

    this.renderer.render(this.scene, this.camera);
  };

  public dispose(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }
    if (this.material) {
      this.material.dispose();
    }
    window.removeEventListener('resize', this.handleResize);
  }
}