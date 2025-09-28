/**
 * 来源：
 * 1. https://github.com/Kalabasa/leanrada.com/blob/src/main/scripts/update/lqip/lqip.mjs
 * 2. https://leanrada.com/notes/css-only-lqip/
 */
import sharp from "sharp";
import { rgbToOkLab } from "./convert";
import { getPalette } from "./thief";

export function getImageLQIP(info: ImageInfo) {
  if (info.opaque) {
    const { ll, aaa, bbb, values } = info;
    const ca = Math.round(values[0] * 0b11);
    const cb = Math.round(values[1] * 0b11);
    const cc = Math.round(values[2] * 0b11);
    const cd = Math.round(values[3] * 0b11);
    const ce = Math.round(values[4] * 0b11);
    const cf = Math.round(values[5] * 0b11);
    const lqip =
      -(2 ** 19) +
      ((ca & 0b11) << 18) +
      ((cb & 0b11) << 16) +
      ((cc & 0b11) << 14) +
      ((cd & 0b11) << 12) +
      ((ce & 0b11) << 10) +
      ((cf & 0b11) << 8) +
      ((ll & 0b11) << 6) +
      ((aaa & 0b111) << 3) +
      (bbb & 0b111);

    if (lqip < -999999 || lqip > 999999) {
      throw new Error(`Invalid lqip value: ${lqip}`);
    }

    return lqip.toFixed(0);
  }
}

export type ImageInfo =
  | {
      width: number;
      height: number;
      opaque: false;
    }
  | {
      width: number;
      height: number;
      opaque: true;
      ll: number;
      aaa: number;
      bbb: number;
      values: number[];
    };
export async function analyzeImage(imageData: Buffer): Promise<ImageInfo> {
  const theSharp = sharp(imageData);
  const [metadata, stats] = await Promise.all([
    theSharp.metadata(),
    theSharp.stats(),
  ]);

  const size = getNormalSize(metadata);
  const opaque = stats.isOpaque;

  if (!opaque) {
    return {
      ...size,
      opaque: false,
    };
  }

  const [previewBuffer, dominantColor] = await Promise.all([
    theSharp
      .gamma(2)
      .resize(3, 2, { fit: "fill" })
      .sharpen({ sigma: 0.5 })
      .removeAlpha()
      .toFormat("raw", { bitdepth: 8 })
      .toBuffer(),
    getPalette(imageData, 4, 10).then((palette) => palette[0]),
  ]);

  const {
    L: rawBaseL,
    a: rawBaseA,
    b: rawBaseB,
  } = rgbToOkLab({
    r: dominantColor[0],
    g: dominantColor[1],
    b: dominantColor[2],
  });
  const { ll, aaa, bbb } = findOklabBits(rawBaseL, rawBaseA, rawBaseB);
  const { L: baseL, a: baseA, b: baseB } = bitsToLab(ll, aaa, bbb);
  console.log(
    "dominant rgb",
    dominantColor,
    "lab",
    Number(rawBaseL.toFixed(4)),
    Number(rawBaseA.toFixed(4)),
    Number(rawBaseB.toFixed(4)),
    "compressed",
    Number(baseL.toFixed(4)),
    Number(baseA.toFixed(4)),
    Number(baseB.toFixed(4)),
  );

  const cells = Array.from({ length: 6 }, (_, index) => {
    const r = previewBuffer.readUint8(index * 3);
    const g = previewBuffer.readUint8(index * 3 + 1);
    const b = previewBuffer.readUint8(index * 3 + 2);
    return rgbToOkLab({ r, g, b });
  });

  const values = cells.map(({ L }) => clamp(0.5 + L - baseL, 0, 1));

  return {
    ...size,
    opaque: true,
    ll,
    aaa,
    bbb,
    values,
  };
}

function findOklabBits(
  targetL: number,
  targetA: number,
  targetB: number,
): { ll: number; aaa: number; bbb: number } {
  const targetChroma = Math.hypot(targetA, targetB);
  const scaledTargetA = scaleComponentForDiff(targetA, targetChroma);
  const scaledTargetB = scaleComponentForDiff(targetB, targetChroma);

  let bestBits = [0, 0, 0];
  let bestDifference = Infinity;

  for (let lli = 0; lli <= 0b11; lli++) {
    for (let aaai = 0; aaai <= 0b111; aaai++) {
      for (let bbbi = 0; bbbi <= 0b111; bbbi++) {
        const { L, a, b } = bitsToLab(lli, aaai, bbbi);

        const grayPenalty = aaai === 4 && bbbi === 3 ? 0.04 : 0;

        const chroma = Math.hypot(a, b);
        const scaledA = scaleComponentForDiff(a, chroma);
        const scaledB = scaleComponentForDiff(b, chroma);

        const difference =
          grayPenalty +
          Math.hypot(
            L - targetL,
            scaledA - scaledTargetA,
            scaledB - scaledTargetB,
          );

        if (difference < bestDifference) {
          bestDifference = difference;
          bestBits = [lli, aaai, bbbi];
        }
      }
    }
  }

  return { ll: bestBits[0], aaa: bestBits[1], bbb: bestBits[2] };
}

function scaleComponentForDiff(x: number, chroma: number): number {
  return x / (1e-6 + Math.pow(chroma, 0.5));
}

function bitsToLab(
  ll: number,
  aaa: number,
  bbb: number,
): {
  L: number;
  a: number;
  b: number;
} {
  const L = (ll / 0b11) * 0.6 + 0.2;
  const a = (aaa / 0b1000) * 0.7 - 0.35;
  const b = ((bbb + 1) / 0b1000) * 0.7 - 0.35;
  return { L, a, b };
}

function getNormalSize({
  width,
  height,
  orientation,
}: {
  width?: number;
  height?: number;
  orientation?: number;
}): { width: number; height: number } {
  return (orientation || 0) >= 5
    ? { width: height!, height: width! }
    : { width: width!, height: height! };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function truthy(thing: any): boolean {
  return !!thing;
}
