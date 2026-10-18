/**
 * x-video-core.ts — 播放器纯逻辑（node 可测，无 DOM 依赖；对齐 scroll-spy.ts 的分层模式）。
 *
 * 由 x-video.ts（DOM 层）消费。X 播放器体验对齐的数值语义都在这里：
 * - 时间显示 X 格式 m:ss
 * - 触屏双击连击快进：次数 → 秒数累计 (n-1)×10
 * - 进度/音量拖拽的钳制与分数计算
 */

/** X 时间显示格式：m:ss（60s → "1:00"）。非法输入 → "0:00"。 */
export function fmt(sec: number): string {
	if (!Number.isFinite(sec) || sec < 0) return "0:00";
	const s = Math.floor(sec % 60);
	const m = Math.floor(sec / 60);
	return `${m}:${String(s).padStart(2, "0")}`;
}

/** 双击连击快进秒数：第 1 次点击不计（留给单击），第 n 次连击 = (n-1)×10s。 */
export function seekSeconds(taps: number): number {
	return taps > 1 ? (taps - 1) * 10 : 0;
}

/** 进度拖拽：基准时间 + 像素位移换算，钳制在 [0, duration]；无时长时原地不动。 */
export function clampSeek(baseTime: number, deltaSec: number, duration: number): number {
	if (!(duration > 0)) return baseTime;
	return Math.min(Math.max(baseTime + deltaSec, 0), duration);
}

/** 竖向拖拽音量：向上增、向下减，钳制 [0,1]。 */
export function volumeFromDrag(baseVolume: number, dyPx: number, heightPx: number): number {
	if (!(heightPx > 0)) return baseVolume;
	return Math.min(Math.max(baseVolume - dyPx / heightPx, 0), 1);
}

/** 进度条填充分数：无时长 → 0。 */
export function fraction(current: number, duration: number): number {
	if (!(duration > 0)) return 0;
	return Math.min(Math.max(current / duration, 0), 1);
}
