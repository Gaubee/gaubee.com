---
layout: layouts/article.njk
title: "CSS“文字”渐变，一种比background-clip通用性更好的方案，可以用于SVG中（CSS svg icon gradients, a more versatile solution than background-clip）"
date: 2021-07-30T10:27:26Z
updated: 2021-08-05T15:19:04Z
---

## 示例 Demo

<div id="demo">
  <div class="gradient-text">
   SOME
   <svg class="icon" style="width: 1em;height: 1em;vertical-align: middle;fill: currentColor;overflow: hidden;" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="8288"><path d="M512 0C230.4 0 0 230.4 0 512s230.4 512 512 512 512-230.4 512-512S793.6 0 512 0z m0 939.2c-235.2 0-427.2-192-427.2-427.2S276.8 84.8 512 84.8s427.2 192 427.2 427.2-192 427.2-427.2 427.2zM320 363.2m-64 0a64 64 0 1 0 128 0 64 64 0 1 0-128 0ZM704 363.2m-64 0a64 64 0 1 0 128 0 64 64 0 1 0-128 0ZM734.4 555.2H289.6c-17.6 0-33.6 8-46.4 20.8s-17.6 33.6-12.8 51.2C256 763.2 376 857.6 512 857.6s256-97.6 281.6-230.4c4.8-17.6 0-33.6-12.8-51.2-12.8-12.8-30.4-20.8-46.4-20.8zM512 772.8c-84.8 0-161.6-56-187.2-132.8H704c-30.4 81.6-107.2 132.8-192 132.8z" p-id="8289"></path></svg>
   TEXT
  </div>
</div>
<div class="controllers">
  <fieldset>
    <legend>背景色 Background Color</legend>
    <input id="bg-color" type="color" />
    <script>
      const bindInputColor = (selector, cssProperty, defaultValue) => {
        const ele = document.querySelector(selector);
        ele.oninput = () => demo.style.setProperty(cssProperty, ele.value);
        ele.value = defaultValue;
        ele.oninput();
      };
      bindInputColor("#bg-color", "--background-color", "#fff");
    </script>
  </fieldset>
  <fieldset>
    <legend>渐变色 Gradient Color</legend>
    <label for="start-color">开始色 Start Color</label>
    <input id="start-color" type="color" />
    <label for="end-color">结束色 End Color</label>
    <input id="end-color" type="color" />
    <script>
      bindInputColor("#start-color", "--gradient-color-start", "#1f00ff");
      bindInputColor("#end-color", "--gradient-color-end", "#ff0000");
    </script>
  </fieldset>
</div>
<style>
  #demo {
    --gradient-color: linear-gradient(
      45deg,
      var(--gradient-color-start),
      var(--gradient-color-end)
    );
    background-color: var(--background-color);
    font-size: 3em;
    font-weight: bold;
    display: inline-block;
  }
  #demo .gradient-text {
    display: flex;
    align-items: center;
  }
  #demo .gradient-text {
    background: var(--gradient-color);
    color: var(--background-color);
    position: relative;
    mix-blend-mode: difference;
  }
  #demo .gradient-text::before {
    content: " ";
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: inherit;
    mix-blend-mode: difference;
    pointer-events: none;
  }
  .controllers {
    display: flex;
  }
</style>

## 起因 The Story

探究这个问题的起因，是源于我打算把公司的图标从 font 逐步转化成 svg。

> My plan is convert the company's icon from font to svg gradually.

虽然绘制性能有所下降，但是整体的好处是比 font 多得多的：比如“按需引入”，“多色”，“动画”，“可访问性”等等。

> Although the drawing performance maybe reduced, the overall benefits are much more than font: "dynamic import", "multi-color", "animation", "accessibility", etc.

但之前使用`background-clip:text`的方案就不好用了，因为默认情况下，svg 的 path 使用的是`fill="currentColor"`这样的写法。诸多原因，我不得不思考较好的替代的方案。

> But the previous solution of using `background-clip:text` doesn't work well,
> because by default, svg's path use `fill="currentColor"`. For many reasons, I
> had to think of a better alternative. ## 做法 Usage
> 核心思路是使用`mix-blend-mode`。 > The core idea is to use `mix-blend-mode`.

```html
<body>
  <div class="gradient-text">SOME TEXT</div>
</body>
```

```css
body {
  background: var(--bg-color);
}
.gradient-text {
  background: var(--gradient-color);
  color: var(--bg-color);
  position: relative;
  mix-blend-mode: difference;
}
.gradient-text::before {
  content: " ";
  display: block;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: inherit;
  mix-blend-mode: difference;
  pointer-events: none;
}
```

## 原理 Principle

DEMO 中，一共有三层定义：

1. `body`：我们称之为 `TOP-LAYER-0` ；
1. `.gradient-text`：我们称之为 `CONTENT-LAYER-1` ，它由两部分组成：
   1. `CONTENT-BG-1` ：绘制着我们定义的`var(--gradient-color)`
   1. `CONTENT-INNER-2` ：绘制着我们的文本、svg 等内容
1. `.gradient-text::before`：我们称之为 `TOP-LAYER-3` ；

> In Demo, There are three layers defined:
>
> 1. `body`: we call it `TOP-LAYER-0`;
> 1. `.gradient-text`: we call it "`CONTENT-LAYER-1`" and it consists of two parts:
>    1. "`CONTENT-BG-1`": draws the `var(--gradient-color)` we defined
>    1. "`CONTENT-INNER-2`": drawing our text, svg, etc.
> 1. `.gradient-text::before`: we call it `TOP-LAYER-3`；

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

1. 因为使用混合模式，它需要小心元素所在的父级。如果父级是一个复杂的图层，比如有复杂的背景，那么这个方案就无法生效了。所以父级最好是白色或者黑色

> 1. Because using blend mode, it needs to be careful about the parent layer where the element is located. If the parent is a complex layer, for example with a complex background, then this scheme will not work. so the parent layer should preferably be white or black.

2. 渐变的颜色不可以是带有透明通道的颜色，但由于这个方案本身就对背景颜色有明确的要求，所以这点可以间接规避。

> 2. The color of the gradient cannot with alpha, but the good thing is that we explicitly require the background color, so this can be circumvented indirectly.

## 小提示 Tip

在复杂的图层中，你可以需要这个 css 属性：

> In complex layers, you can need this css property:

```css
.gradient-text-parent {
  isolation: isolate;
}
```
