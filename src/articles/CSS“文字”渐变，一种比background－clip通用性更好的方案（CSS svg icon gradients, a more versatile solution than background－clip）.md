---
layout: layouts/article.njk
title: "CSS“文字”渐变，一种比background-clip通用性更好的方案（CSS svg icon gradients, a more versatile solution than background-clip）"
date: 2021-07-30T10:27:26Z
updated: 2021-08-05T15:19:04Z
---

## 起因 The Story

探究这个问题的起因，是源于我打算把公司的图标从 font 逐步转化成 svg。

> My plan is convert the company's icon from font to svg gradually.

虽然绘制性能有所下降，但是整体的好处是比 font 多得多的：比如“按需引入”，“多色”，“动画”，“可访问性”等等。

> Although the drawing performance maybe reduced, the overall benefits are much more than font: "dynamic import", "multi-color", "animation", "accessibility", etc.

但之前使用`background-clip:text`的方案就不好用了，因为默认情况下，svg 的 path 使用的是`fill="currentColor"`这样的写法。诸多原因，我不得不思考较好的替代的方案。

> But the previous solution of using `background-clip:text` doesn't work well, because by default, svg's path use `fill="currentColor"`. For many reasons, I had to think of a better alternative.

## 做法 Usage

核心思路是使用`mix-blend-mode`。

> The core idea is to use `mix-blend-mode`.

```html
<body>
  <div class="gradient-text">SOME TEXT</div>
</body>
```

```css
.gradient-text {
  background: var(--gradient-color);
  color: #fff;
  position: relative;
  mix-blend-mode: difference;
}
.gradient-text::before {
  content: " ";
  display: block;
  position: absolute;
  width: 100%;
  height: 100%;
  background: inherit;
  mix-blend-mode: difference;
  pointer-event: none;
}
```

## 原理 Principle

DEMO 中，一共有三层定义：

1. `body`：我们称之为 `TOP-LAYER-0` ；
   > `body`: we call it `TOP-LAYER-0`;
1. `.gradient-text`：我们称之为 `CONTENT-LAYER-1` ，它由两部分组成：
   > `.gradient-text`: we call it "`CONTENT-LAYER-1`" and it consists of two parts:
   1. `CONTENT-BG-1` ：绘制着我们定义的`var(--gradient-color)`
      > "`CONTENT-BG-1`": draws the `var(--gradient-color)` we defined
   1. `CONTENT-INNER-2` ：绘制着我们的文本、svg 等内容
      > "`CONTENT-INNER-2`": drawing our text, svg, etc.
1. `.gradient-text::before`：我们称之为“`TOP-LAYER-3` ；
   > `.gradient-text::before`: we call it `TOP-LAYER-3`；

所以这里总共有四种景受到影响，我们可以逐一推理每一种景发生的混合：

> So there are a total of four layer affected here, and we can reason about the mix one by one.

1. `TOP-LAYER-0-RES` = `TOP-LAYER-0` ^ `CONTENT-BG-1` ^ `TOP-LAYER-3`；
   1. ∵ `CONTENT-BG-1` == `TOP-LAYER-3`
   1. ∴ `TOP-LAYER-0-RES` = `TOP-LAYER-0`
1. `CONTENT-BG-1-RES` = `TOP-LAYER-0` ^ `CONTENT-BG-1` ^ `TOP-LAYER-3`
   1. ∵ `CONTENT-BG-1` ^ `TOP-LAYER-3`
   1. ∴ `CONTENT-BG-1-RES` = `TOP-LAYER-0`
1. `CONTENT-INNER-2-RES` = `TOP-LAYER-0` ^ `CONTENT-INNER-2` ^ `TOP-LAYER-3`
   1. ∵ `TOP-LAYER-0` == `CONTENT-INNER-2`
   1. ∴ `CONTENT-INNER-2-RES` = `TOP-LAYER-3`
1. `TOP-LAYER-3-RES` = `TOP-LAYER-0` ^ `CONTENT-BG-1` ^ `TOP-LAYER-3`
   1. ∵ `CONTENT-BG-1` == `TOP-LAYER-3`
   1. ∴ `TOP-LAYER-3-RES` = `TOP-LAYER-0`

可以看到， `TOP-LAYER-0-RES` 、 `CONTENT-BG-1-RES` 、 `TOP-LAYER-3-RES` 最终都等于 `TOP-LAYER-0` ，所以它们看上去跟直接看到 `TOP-LAYER-0` 的效果一样。像是透明层一般。

> As you can see, `TOP-LAYER-0-RES`, `CONTENT-BG-1-RES`, and `TOP-LAYER-3-RES` end up being equal to `TOP-LAYER-0`, so they look the same as if you see `TOP-LAYER-0` directly. It looks like a transparent layer.

只剩下 `CONTENT-INNER-2-RES` 绘制的是 `TOP-LAYER-3` 的内容，也就是我们最终需要的渐变色。

> Only `CONTENT-INNER-2-RES` is left to draw the contents of `TOP-LAYER-3`, which is the gradient color we eventually need.

## 缺陷 Defects

因为使用混合模式，它需要小心元素所在的父级。如果父级是一个复杂的图层，比如有复杂的背景，那么这个方案就无法生效了。

> Because using blend mode, it needs to be careful about the parent level where the element is located. If the parent is a complex layer, for example with a complex background, then this scheme will not work.
