import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createCanvas: createNodeCanvas } = require("canvas");
const createGL = require("gl");

class WebGLCanvas {
  width: number;
  height: number;
  private _gl: any;
  private _2dCanvas: any;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this._2dCanvas = createNodeCanvas(width, height);
  }

  getContext(type: string, attrs?: any) {
    if (type === "webgl" || type === "webgl2") {
      if (!this._gl) {
        this._gl = createGL(this.width, this.height, attrs);
        this._gl.canvas = this;
        // Fix getUniformLocation for array uniforms (headless-gl quirk)
        const _getUniformLocation = this._gl.getUniformLocation.bind(this._gl);
        this._gl.getUniformLocation = (program: any, name: string) => {
          return _getUniformLocation(program, name.replace(/\[0\]$/, ""));
        };
      }
      return this._gl;
    }
    return this._2dCanvas.getContext(type, attrs);
  }

  toBuffer(mimeType?: string) {
    this._syncGL();
    return this._2dCanvas.toBuffer(mimeType);
  }

  createJPEGStream(opts?: any) {
    this._syncGL();
    return this._2dCanvas.createJPEGStream(opts);
  }

  createPNGStream(opts?: any) {
    this._syncGL();
    return this._2dCanvas.createPNGStream(opts);
  }

  private _syncGL() {
    if (!this._gl) return;
    const pixels = new Uint8Array(this.width * this.height * 4);
    this._gl.readPixels(0, 0, this.width, this.height, this._gl.RGBA, this._gl.UNSIGNED_BYTE, pixels);

    const ctx = this._2dCanvas.getContext("2d");
    const imageData = ctx.createImageData(this.width, this.height);

    // GL framebuffer is bottom-up, canvas is top-down
    for (let y = 0; y < this.height; y++) {
      const src = (this.height - 1 - y) * this.width * 4;
      const dst = y * this.width * 4;
      imageData.data.set(pixels.subarray(src, src + this.width * 4), dst);
    }
    ctx.putImageData(imageData, 0, 0);
  }

  // Stubs for THREE.js compatibility
  get style() { return {}; }
  addEventListener() {}
  removeEventListener() {}
}

export function createCanvas(width: number, height: number) {
  return new WebGLCanvas(width, height);
}
