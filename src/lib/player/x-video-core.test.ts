import { describe, expect, it } from "vitest";

import { clampSeek, fmt, fraction, seekSeconds, volumeFromDrag } from "./x-video-core";

describe("fmt（X 时间格式 m:ss）", () => {
	it("基本分段", () => {
		expect(fmt(0)).toBe("0:00");
		expect(fmt(5.4)).toBe("0:05");
		expect(fmt(60)).toBe("1:00");
		expect(fmt(83.7)).toBe("1:23");
		expect(fmt(600)).toBe("10:00");
	});
	it("非法输入兜底 0:00", () => {
		expect(fmt(-1)).toBe("0:00");
		expect(fmt(NaN)).toBe("0:00");
		expect(fmt(Infinity)).toBe("0:00");
	});
});

describe("seekSeconds（双击连击累计，kzf 裁决语义）", () => {
	it("首次点击不计（留给单击播放/暂停）", () => {
		expect(seekSeconds(1)).toBe(0);
	});
	it("连击 (n-1)×10", () => {
		expect(seekSeconds(2)).toBe(10);
		expect(seekSeconds(3)).toBe(20);
		expect(seekSeconds(5)).toBe(40);
	});
});

describe("clampSeek", () => {
	const dur = 30;
	it("正常位移", () => {
		expect(clampSeek(10, 5, dur)).toBe(15);
		expect(clampSeek(10, -5, dur)).toBe(5);
	});
	it("钳制在 [0, duration]", () => {
		expect(clampSeek(28, 10, dur)).toBe(30);
		expect(clampSeek(2, -10, dur)).toBe(0);
	});
	it("无时长原地不动", () => {
		expect(clampSeek(7, 100, 0)).toBe(7);
		expect(clampSeek(7, 100, NaN)).toBe(7);
	});
});

describe("volumeFromDrag", () => {
	it("向上增向下减（dy 为屏幕坐标增量，向上为负）", () => {
		expect(volumeFromDrag(0.5, -100, 400)).toBeCloseTo(0.75);
		expect(volumeFromDrag(0.5, 100, 400)).toBeCloseTo(0.25);
	});
	it("钳制 [0,1]；高度非法原值返回", () => {
		expect(volumeFromDrag(0.8, -400, 400)).toBe(1);
		expect(volumeFromDrag(0.2, 400, 400)).toBe(0);
		expect(volumeFromDrag(0.5, -100, 0)).toBe(0.5);
	});
});

describe("fraction", () => {
	it("正常比例与钳制", () => {
		expect(fraction(5, 10)).toBe(0.5);
		expect(fraction(11, 10)).toBe(1);
		expect(fraction(-1, 10)).toBe(0);
	});
	it("无时长 → 0", () => {
		expect(fraction(5, 0)).toBe(0);
		expect(fraction(5, NaN)).toBe(0);
	});
});
