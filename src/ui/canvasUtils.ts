export function getCssWidth(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

export function sizeCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number): void {
  const dpr = window.devicePixelRatio || 1;
  const bufW = Math.round(cssW * dpr);
  const bufH = Math.round(cssH * dpr);
  canvas.width = bufW;
  canvas.height = bufH;
  canvas.style.width = `${bufW / dpr}px`;
  canvas.style.height = `${bufH / dpr}px`;
}

export function getCanvasContext(canvas: HTMLCanvasElement, cssW: number, cssH: number): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, cssW, cssH);
  return ctx;
}

export function drawBackground(ctx: CanvasRenderingContext2D, cssW: number, cssH: number): void {
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, cssW, cssH);
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  pad: { left: number; right: number; top: number; bottom: number },
  cssW: number,
  cssH: number,
  xMax: number,
  xStep: number,
  yMax: number,
  yStep: number,
  px: (v: number) => number,
  py: (v: number) => number,
): void {
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 0.5;
  for (let y = 0; y <= yMax; y += yStep) {
    const yp = py(y);
    ctx.beginPath();
    ctx.moveTo(pad.left, yp);
    ctx.lineTo(cssW - pad.right, yp);
    ctx.stroke();
  }
  for (let x = 0; x <= xMax; x += xStep) {
    const xp = px(x);
    ctx.beginPath();
    ctx.moveTo(xp, pad.top);
    ctx.lineTo(xp, cssH - pad.bottom);
    ctx.stroke();
  }
}

export function drawAxes(
  ctx: CanvasRenderingContext2D,
  pad: { left: number; right: number; top: number; bottom: number },
  cssW: number,
  cssH: number,
): void {
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, cssH - pad.bottom);
  ctx.lineTo(cssW - pad.right, cssH - pad.bottom);
  ctx.stroke();
}
