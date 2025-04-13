现在你是一个擅长于写技术文章的 AI。写一篇类似张鑫旭风格的博文，博文的内容是阐述 CSS Animation、CSS Transaction、CSS View Transaction 的区别。

> 因为文章中需要展示例子，所以建议使用 mdx 格式。

文章要提及一个注意事项，我们主要是聊 CSS，而不包含 Animation API，因为一旦混入 JS，就意味着非常自由的动画编程了。这里主要是聊声明式 CSS 的动画能力。

先从 CSS Animation 说起。这里给一个例子：

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Animation Reverse</title>
    <style>
      :root {
        font-family: sans-serif;
        margin: 0;
        padding: 0;
      }
      body {
        margin: 0;
        padding: 1em;
      }
      .controllers {
        margin: 1em 0;
        padding: 1em;
        display: flex;
        flex-direction: row;
        gap: 1em;
        flex-wrap: wrap;
        align-items: flex-start;
        border-radius: 1em;
        background-color: color-mix(in srgb, blue 10%, canvas);
      }
      .controllers * {
        font-size: 16px;
      }
      .controllers button {
        padding: 0.5em;
        background-color: color-mix(in srgb, accentColor 10%, canvas);
        border: 2px solid accentColor;
        border-radius: 0.5em;
      }
      #btnClass {
        display: flex;
        flex-direction: column;
      }
      #btnClass select {
        height: 160px;
      }

      #block {
        width: 200px;
        aspect-ratio: 1;
        background-color: blue;
        color: white;
      }
      :where(#block) {
        animation-fill-mode: forwards;
        animation-duration: 10s;
        animation-timing-function: linear;
      }

      .ani-name-move {
        animation-name: move;
      }
      .ani-reverse {
        animation-direction: reverse;
      }
      .ani-duration {
        animation-duration: 15s;
      }
      .ani-timing-function {
        animation-timing-function: ease-in-out;
      }
      .ani-name-normal {
        animation-name: move-normal;
      }
      .ani-name-reverse {
        animation-name: move-reverse;
      }
      .ani-pause {
        animation-play-state: paused;
      }
      @keyframes move-normal {
        100% {
          translate: 200px 0;
        }
      }
      @keyframes move-reverse {
        100% {
          translate: 0 0;
        }
      }
    </style>
    <style id="aniNormalStyle" type="text/css">
      @keyframes move {
        0% {
          translate: 0 0;
        }
        100% {
          translate: 200px 0;
        }
      }
    </style>
    <style id="aniReverseStyle" type="template/css">
      @keyframes move {
        0% {
          translate: 200px 0;
        }
        100% {
          translate: 0 0;
        }
      }
    </style>
  </head>
  <body>
    <div id="block"></div>
    <section class="controllers">
      <button id="btnPause">pause</button>
      <button id="btnClass" title="按住ctrl进行多选或者反选">
        change className
        <select id="aniOpts" multiple>
          <option value="ani-name-move">name-move</option>
          <option value="ani-name-normal">name-normal</option>
          <option value="ani-name-reverse">name-reverse</option>
          <option value="ani-reverse">reverse</option>
          <option value="ani-duration">duration</option>
          <option value="ani-timing-function">timing-function</option>
        </select>
      </button>
      <button id="btnKeyframes">change move keyframe</button>
    </section>
  </body>
  <script>
    btnPause.addEventListener("click", () => {
      block.classList.toggle("ani-pause");
    });
    btnClass.addEventListener("click", () => {
      for (let i = 0; i < aniOpts.length; i++) {
        block.classList.remove(aniOpts[i].value);
      }
      for (let i = 0; i < aniOpts.selectedOptions.length; i++) {
        block.classList.add(aniOpts.selectedOptions[i].value);
      }
    });
    btnKeyframes.addEventListener("click", () => {
      if (aniNormalStyle.type === "text/css") {
        aniNormalStyle.type = "template/css";
        aniReverseStyle.type = "text/css";
      } else {
        aniNormalStyle.type = "text/css";
        aniReverseStyle.type = "template/css";
      }
    });
    new MutationObserver(() => {
      block.innerHTML = block.className;
    }).observe(block, {
      attributes: true,
      attributeFilter: ["class"],
    });
  </script>
</html>
```

在这个例子中，我们首先 name-move，开始让动画开始播放（10s）。
在这个过程中，加入 ani-reverse，此时动画并不会原地返回。而是根据当前动画已进行的时间百分比，跳跃到反向动画在该时间百分比应该在的位置，然后继续反向播放。
也就是说，底层有一个计时器（10s）一直没有停过。
此时再移除了 ani-reverse，动画方向切换回 normal，元素会跳到 normal 方向下该时间点对应的位置。反复切换 reverse 和 normal，你会观察到时间是共享的。
包括去改变其它属性：ani-reverse、 ani-duration、 ani-timing-function，甚至是修改@keyframe 的定义，它们都是不会中断当前的动画，而是在时间轴的基础上去计算动画。
而如果改变 animation-name（切换 ani-name-normal，ani-name-reverse），那么动画会重新开始计时（时间轴重置到 0s）

以上，请 AI 总结一下，animation 的底层工作逻辑。
这里我假设你是浏览器引擎的开发人员，你的伪代码会如何实现（注意精简用词、逻辑准确，使用面向过程来进行表述，参考 W3C 的中文文档风格对标准进行描述）？

我这边给出一些我个人的经验总结出来的知识点，方便 AI 校验生成的内容：

1. 动画以 name 作为 key，其余的 duration timingFunction delay iterationCount direction fillMode keyframesRule 用于创建一个函数:`(time:number) => style|null` （这里假设用 null 表示动画结束，不需要再计算）
   > 这里要注意的是，浏览器通常不会把动画的 endTime 直接计算出来，而是在动画结束后，对动画进行标记：animation.finished = true，一旦被标记，那么这个动画就不会再进入到动画队列去计算了。
   >
   > 这是因为浏览器会在调试器中提供“动画慢放、动画暂停”的功能，因此计算 endTime 并不如直接用 finished 标记来得灵活
1. 动画基于 name 开始之后，这个过程中修改动画的其它属性，会重新创建动画函数，但是 startTime 不会重置。
   > 重新创建动画函数，那么 animation 会被重新加入当前帧的队列中，在当前帧中，finished 会被重新标记成 true 或者 false。如果 finished 为 true，那么动画就会继续播放下去，直到为 false
1. 如果修改了 animation-name，那么动画会重新开始计时（时间轴重置到 0s）

接下来。文章需要讨论 transaction 的不同之处。这里同样给一个例子：

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Transition 控制示例</title>
    <!-- Transition Control Example -->
    <style>
      :root {
        font-family: sans-serif;
        margin: 0;
        padding: 0;
        accent-color: purple; /* 更改强调色以示区别 */ /* Changed accent for visual distinction */
      }
      body {
        margin: 0;
        padding: 1em;
      }
      .controllers {
        margin: 1em 0;
        padding: 1em;
        display: flex;
        flex-direction: row;
        gap: 1em;
        flex-wrap: wrap;
        align-items: flex-start;
        border-radius: 1em;
        background-color: color-mix(
          in srgb,
          purple 10%,
          canvas
        ); /* 匹配强调色 */ /* Matched accent */
      }
      .controllers * {
        font-size: 16px;
      }
      .controllers button {
        padding: 0.5em;
        background-color: color-mix(in srgb, accentColor 10%, canvas);
        border: 2px solid accentColor;
        border-radius: 0.5em;
        cursor: pointer;
      }
      .controllers button.active {
        background-color: color-mix(in srgb, accentColor 30%, canvas);
        font-weight: bold;
      }
      .controllers div {
        /* 按钮的简单分组 */ /* Simple grouping for buttons */
        display: flex;
        flex-direction: column;
        gap: 0.5em;
        padding: 0.5em;
        border: 1px solid #ccc;
        border-radius: 0.5em;
      }

      :where(#block) {
        width: 200px;
        aspect-ratio: 1;
        background-color: purple; /* 匹配强调色 */ /* Matched accent */
        color: white;
        /* --- Transition 设置 --- */ /* --- Transition Setup --- */
        translate: 0 0; /* 初始位置 */ /* Initial position */
        transition-property: translate; /* 仅对 translate 属性应用过渡 */ /* Only transition the translate property */
        transition-duration: 1s; /* 默认持续时间 */ /* Default duration */
        transition-timing-function: linear; /* 默认时间函数 */ /* Default timing */
        /* 防止使用 transform 代替 translate 时发生布局抖动 */ /* Prevent layout shifts if transform is used instead of translate */
        will-change: translate;
        /* 显示当前类名 */ /* Display current class */
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        font-size: 12px;
        overflow-wrap: break-word;
        padding: 5px;
        box-sizing: border-box;
      }

      /* --- 目标状态类 --- */ /* --- Target State Classes --- */
      .target-200 {
        translate: 200px 0;
      }
      .target-0 {
        translate: 0 0;
      }

      /* --- 修饰符类 --- */ /* --- Modifier Classes --- */
      .slow-duration {
        transition-duration: 15s;
      }
      .ease-timing {
        transition-timing-function: ease-in-out;
      }

      /* --- 暂停状态 --- */ /* --- Pause State --- */
      /* 暂停时，我们通过内联样式设置 translate 并停止过渡 */ /* When paused, we set the translate via inline style and stop transitions */
      #block.paused {
        /* 通过在暂停时将 duration 设置为 0，或者直接操作覆盖类过渡的内联样式，可以有效地停止过渡 */ /* Transition is effectively stopped by setting duration to 0 while paused, or by directly manipulating the inline style which overrides class transitions */
        /* transition-property: none; */ /* 另一种暂停方法 */ /* Alternative pause method */
      }
    </style>
  </head>
  <body>
    <div id="block">初始状态</div>
    <!-- Initial state -->
    <section class="controllers">
      <div>
        <span>目标位置:</span>
        <!-- Target Position: -->
        <button id="btnTarget200">移动到 200px</button>
        <!-- Go to 200px -->
        <button id="btnTarget0">移动到 0px</button>
        <!-- Go to 0px -->
      </div>
      <div>
        <span>修饰符:</span>
        <!-- Modifiers: -->
        <button id="btnDuration">切换慢速 (15s)</button>
        <!-- Toggle Slow Duration (15s) -->
        <button id="btnTiming">切换 Ease-In-Out</button>
        <!-- Toggle Ease-In-Out -->
      </div>
      <div>
        <span>控制:</span>
        <!-- Control: -->
        <button id="btnPause">暂停 / 继续</button>
        <!-- Pause / Resume -->
      </div>
    </section>
  </body>
  <script>
    const block = document.getElementById("block");
    const btnTarget200 = document.getElementById("btnTarget200");
    const btnTarget0 = document.getElementById("btnTarget0");
    const btnDuration = document.getElementById("btnDuration");
    const btnTiming = document.getElementById("btnTiming");
    const btnPause = document.getElementById("btnPause");

    let isPaused = false; // 标记是否暂停
    let pausedTranslate = ""; // 存储暂停时的 translate 值

    // --- 目标控制 ---
    btnTarget200.addEventListener("click", () => {
      if (isPaused) return; // 暂停时不允许改变目标
      block.classList.remove("target-0");
      block.classList.add("target-200");
      updateButtonStates();
    });

    btnTarget0.addEventListener("click", () => {
      if (isPaused) return; // 暂停时不允许改变目标
      block.classList.remove("target-200");
      block.classList.add("target-0"); // 为清晰起见，显式添加 target-0，尽管移除 target-200 就足够了
      updateButtonStates();
    });

    // --- 修饰符控制 ---
    btnDuration.addEventListener("click", () => {
      block.classList.toggle("slow-duration");
      updateButtonStates();
    });

    btnTiming.addEventListener("click", () => {
      block.classList.toggle("ease-timing");
      updateButtonStates();
    });

    // --- 暂停/继续 控制 ---
    btnPause.addEventListener("click", () => {
      isPaused = !isPaused; // 切换暂停状态
      block.classList.toggle("paused", isPaused); // 同步 .paused 类

      if (isPaused) {
        // 暂停: 获取当前计算出的 translate 值并设置为内联样式
        // 这会在视觉上冻结元素，并覆盖基于类的过渡目标
        pausedTranslate = getComputedStyle(block).translate;
        block.style.translate = pausedTranslate;
        btnPause.textContent = "继续"; // Resume
        btnPause.classList.add("active");

        // 可选: 防止在暂停期间更改计时函数时出现闪烁
        // block.style.transitionProperty = 'none';
      } else {
        // 继续: 移除内联样式，让基于类的过渡接管
        block.style.translate = ""; // 移除内联覆盖
        btnPause.textContent = "暂停"; // Pause
        btnPause.classList.remove("active");
        pausedTranslate = "";

        // 可选: 如果之前禁用了 transition-property，则恢复它
        // block.style.transitionProperty = '';

        // 强制重排/重算以确保过渡正确恢复 (某些浏览器可能需要)
        // void block.offsetWidth;
      }
      updateButtonStates(); // 更新显示
    });

    // --- 显示当前状态 ---
    function updateBlockContent() {
      let text = `类名: ${block.className}<br>`; // Classes:
      text += `已暂停: ${isPaused}<br>`; // Paused:
      if (isPaused && pausedTranslate) {
        text += `暂停于: ${pausedTranslate}<br>`; // Paused At:
      }
      const computedStyle = getComputedStyle(block);
      text += `计算 Translate: ${computedStyle.translate}<br>`; // Computed Translate:
      text += `计算 Duration: ${computedStyle.transitionDuration}<br>`; // Computed Duration:
      text += `计算 Timing: ${computedStyle.transitionTimingFunction}`; // Computed Timing:

      block.innerHTML = text;
    }

    // 观察 class 和 style 的变化，并更新内容 + 按钮状态
    const observer = new MutationObserver(() => {
      updateBlockContent();
      updateButtonStates(); // 如果需要，当类在外部更改时也更新按钮状态
    });
    observer.observe(block, {
      attributes: true,
      attributeFilter: ["class", "style"], // 也观察 style 的变化以用于暂停/继续
    });

    // 用于在按钮上直观指示活动修饰符状态的辅助函数
    function updateButtonStates() {
      // 暂停时禁用目标按钮
      btnTarget200.disabled = isPaused;
      btnTarget0.disabled = isPaused;

      // 更新按钮的 .active 类
      btnTarget200.classList.toggle(
        "active",
        block.classList.contains("target-200")
      );
      btnTarget0.classList.toggle(
        "active",
        block.classList.contains("target-0") ||
          (!block.classList.contains("target-200") &&
            !block.classList.contains("target-0") &&
            block.style.translate === "")
      ); // 如果显式设置或处于默认状态，则为活动状态
      btnDuration.classList.toggle(
        "active",
        block.classList.contains("slow-duration")
      );
      btnTiming.classList.toggle(
        "active",
        block.classList.contains("ease-timing")
      );
      btnPause.classList.toggle("active", isPaused); // 确保暂停按钮反映状态

      // 初始更新或在没有突变时调用
      updateBlockContent();
    }

    // 初始状态更新
    updateButtonStates();
  </script>
</html>
```

在这个例子中，一旦动画开始。其中修改 transition-timing-function、transition-duration，都不会影响当前的正在播放的动画。

> 但是浏览器的 Animations 面板中，仍然可以对动画进行暂停、减慢。

想要让 transition-timing-function、transition-duration 配置生效，需要对目标样式值进行修改
