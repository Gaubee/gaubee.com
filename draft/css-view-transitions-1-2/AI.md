你是一个 AI 写作工具，我是一个软件工程师。
这次你的任务是生成一篇关于 CSS View Transitions 的进阶文章。
在此之前，我已经基于官方的草案文档生成过一篇入门的文章。
当那便入门的文章基本知识做了一个原理的介绍，并不能让人真正认知到这个 View Transitions 的能力边界与局限性。

因此这次我将提供一些比较复杂的实践，来帮助人们进一步认知它。
首先是代码：
在线链接是 https://appn.dwewb.com/examples/kitchen-sink/view-transition-demo-ios-navigation/

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script type="module" src="/components/button-group.ts"></script>
    <link rel="stylesheet" href="/css/demo-with-controller.css" />
    <title>View Transition Demo</title>
    <style>
      :root {
        --accent-color: rgb(0, 55, 255); /* 更改强调色以示区别 */
      }
      * {
        box-sizing: border-box;
      }
      #canvas {
        width: 300px;
        height: 400px;
        display: flex;
        flex-direction: row;
        position: relative;
        /* overflow: hidden; */
        margin-left: 200px;
        border: 1px solid color-mix(in srgb, var(--accent-color), currentColor);
      }
      .to-left {
        position: absolute;
        left: -100px;
        /* opacity: 0.5; */
        z-index: 0;
      }
      .from-right {
        position: absolute;
        left: 300px;
        /* opacity: 0.5; */
        z-index: 2;
      }
      .page {
        width: 100%;
        height: 100%;
        flex-shrink: 0;
        overflow: auto;
        scrollbar-width: none;
        z-index: 1;
        background: #ffffff;

        & header {
          width: 100%;
          height: 40px;
          box-sizing: border-box;
          display: flex;
          flex-direction: row;
          justify-content: space-between;
          position: sticky;
          top: 0;
          left: 0;
          backdrop-filter: blur(10px);
          z-index: 1;
          view-transition-class: header;

          & * {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
          }
          & .back-icon {
            color: var(--accent-color);
            view-transition-class: back-icon;
          }
          & .back-text {
            color: var(--accent-color);
            view-transition-class: back-text;
          }
          & > .title {
            /* flex: 1; */
            view-transition-class: title;
          }
          & > nav {
            flex-basis: 80px;
            view-transition-class: nav;
          }
        }
        & .body {
          background-image: repeating-linear-gradient(
            135deg,
            #f8bbd0,
            #f8bbd0 20px,
            #e1f5fe 20px,
            #e1f5fe 40px
          );
          height: 600px;
          margin-top: -40px;
        }
      }
      ::view-transition-group(*) {
        animation-duration: 1s;
        overflow: hidden;
      }
      :has(#canvas.slow)::view-transition-group(*) {
        animation-duration: 3s;
      }
      :has(#canvas.fast)::view-transition-group(*) {
        animation-duration: 0.5s;
      }

      ::view-transition-group(.nav) {
        z-index: 2;
      }
      ::view-transition-group(.title) {
        z-index: 2;
      }
      ::view-transition-group(.back-icon) {
        z-index: 2;
      }
      ::view-transition-group(.back-text) {
        z-index: 2;
      }
    </style>
  </head>
  <body>
    <div id="canvas"></div>
    <template id="tmp">
      <main class="page">
        <header>
          <nav>
            <span class="back-icon">◀</span>
            <span class="back-text">返回</span>
          </nav>
          <span class="title">标题</span>
          <nav></nav>
        </header>
        <section class="body"></section>
      </main>
    </template>
    <section class="controllers">
      <div class="class-names">
        <button-group>
          <button data-value="fast">fast (0.5s)</button>
          <button data-value="default" data-selected>default (1s)</button>
          <button data-value="slow">slow (3s)</button>
        </button-group>
      </div>
      <div>
        <span>全局控制:</span>
        <!-- Global Control -->
        <button id="btnPlay">前进</button>

        <button-group id="frameGroup">
          <button data-value="beforeStart">beforeStart</button>
          <button data-value="doStart">doStart</button>
          <button data-value="afterFinish" data-selected>afterFinish</button>
        </button-group>
      </div>
    </section>
  </body>
  <script>
    const allButtonGroup = [].slice.call(
      document.querySelectorAll(".class-names button-group")
    );
    allButtonGroup.forEach((btnGroup) => {
      btnGroup.addEventListener("change", (e) => {
        canvas.classList.remove(...btnGroup.options);
        canvas.classList.add(...btnGroup.values);
      });
    });
    /**
     * @type {HTMLButtonElement}
     */
    const btnPlay = document.getElementById("btnPlay");
    /**
     * @type {HTMLTemplateElement}
     */
    const tmp = document.getElementById("tmp");
    /**
     * @type {HTMLDivElement}
     */
    const canvas = document.getElementById("canvas");

    class ViewTransitionController {
      oldEles;
      newEles;
      constructor() {
        this.init();
      }
      init() {
        canvas.innerHTML = tmp.innerHTML;
      }
      /**
       * @param {Node} root
       */
      getEles = (root) => {
        /** @type {HTMLElement} */
        const page = root.querySelector(".page");
        /** @type {HTMLElement} */
        const header = root.querySelector("header");
        /** @type {HTMLElement} */
        const backIcon = root.querySelector(".back-icon");
        /** @type {HTMLSpanElement} */
        const backText = root.querySelector(".back-text");
        /** @type {HTMLSpanElement} */
        const title = root.querySelector(".title");
        /** @type {HTMLElement} */
        const body = root.querySelector(".body");
        return { page, header, backIcon, backText, title, body };
      };
      updateText = () => {
        const { oldEles, newEles } = this;
        newEles.backText.textContent = oldEles.title.textContent;
        newEles.title.textContent = `标题${
          1 + (parseInt(oldEles.title.textContent.match(/\d+/)) || 0)
        }`;
      };
      beforeStart = () => {
        this.oldEles = this.getEles(canvas);
        this.newEles = this.oldEles;
        const newHeader = tmp.content.cloneNode(true);
        this.newEles = this.getEles(newHeader);
        this.updateText();

        canvas.appendChild(newHeader);

        const { oldEles, newEles } = this;
        oldEles.page.style.viewTransitionName = "old-page";
        oldEles.header.style.viewTransitionName = "old-header";
        oldEles.backIcon.style.viewTransitionName = "old-backIcon";
        oldEles.backText.style.viewTransitionName = "old-backText";
        oldEles.title.style.viewTransitionName = "old-title";

        newEles.page.classList.add("from-right");
        newEles.page.style.viewTransitionName = "new-page";
        newEles.header.style.viewTransitionName = "new-header";
        newEles.backIcon.style.viewTransitionName = "new-backIcon";
        newEles.backIcon.style.opacity = "0";
        newEles.backText.style.opacity = "0";
        newEles.title.style.viewTransitionName = "new-title";
      };
      doStart = () => {
        const { oldEles, newEles } = this;
        oldEles.page.classList.add("to-left");
        oldEles.page.style.opacity = "0";
        oldEles.title.style.viewTransitionName = "";
        oldEles.title.style.opacity = "0";
        oldEles.backIcon.style.viewTransitionName = "";
        oldEles.backIcon.style.opacity = "0";
        oldEles.backText.style.opacity = "0";

        newEles.page.classList.remove("from-right");
        newEles.backIcon.style.viewTransitionName = "old-backIcon";
        newEles.backIcon.style.opacity = "1";
        newEles.backText.style.viewTransitionName = "old-title";
        newEles.backText.style.opacity = "1";
      };
      afterFinish = () => {
        const { oldEles } = this;
        oldEles.page.remove();
      };
    }
    const vtc = new ViewTransitionController();

    btnPlay.addEventListener("click", async () => {
      vtc.beforeStart();

      const vt = document.startViewTransition(vtc.doStart);
      await vt.finished;
      vtc.afterFinish();
    });

    frameGroup.addEventListener("change", () => {
      vtc.init();
      switch (frameGroup.value) {
        case "beforeStart":
          vtc.beforeStart();
          break;
        case "doStart":
          vtc.beforeStart();
          vtc.doStart();
          break;
        case "afterFinish":
          vtc.beforeStart();
          vtc.doStart();
          vtc.afterFinish();
          break;
      }
    });
  </script>
</html>
```

## 然后是我的一些论点：

### 讨论 1: 在 SPA 中使用 view-transitions 实现 MPA 的导航效果的复杂性

view-transitions 看着美好，网上那些教程都讲得很表面，真正用起来的时候可太恶心了。
这个实例中，我尝试模拟 IOS 的导航栏效果，这个效果的介绍如下：

1. 返回按钮的部分分成图标（backIcon）和文字（backText）。
1. 图标（backIcon）在两个页面切换的时候，是静态不动的。
1. 文字（backText）是由上一个页面的标题（title）转换而来的。
1. 新页面的标题（title）是跟着新页面从右边移动到中间。
1. 整个页面都是从右边移到中间，并盖在新页面上面。

相比 kotlin-compose 的那种声明式的 shared-element 写法，view-transitions 真的老费心了。
首先说一下 compose 的开发逻辑：

> page1 的元素标记了 name1，page2 的元素标记了 name1，然后框架就自己进行动画计算了。

然后我们看看 view-transitions 的开发逻辑，需要分三步走：

> 1. 开始之前 page1 的元素标记了 name1，page2 元素标记了 name2。（这里不能同时都标记成 name1，否则就意味着 startViewTransition 前后一共就出现了四个 name1。startViewTransition 就会报错失败）
> 2. 执行 startViewTransition，page1 的元素标记了 name0， page2 的元素标记了 name1
> 3. 执行完成后，还需要清理残留的状态值。

这里的根本原因是，我们尝试在一个 document 中模拟出多个 page，而 view-transitions-level-1 它并不耦合多个 page 的概念（这其实是 view-transitions-level-2 要解决的问题，但是 SPA 的开发模式就注定用不了 view-transitions-level-2）。
而 compose 相反，它的 navigation 和 shared-element 是有耦合的，所以它天然就可以用一个 Activity 实现多个 page。因此它可以在一个上下文中直接声明两个 page 之间的 shared-element。

这也就导致了一个 SPA 中，如果你尝试模拟多个 page，就会遇到我上面说的问题：你需要手动模拟在一个 document 中，如果有多个 page， view-transition-name 如何共享的问题。

### 讨论 2: view-transitions 的限制

首先是**渲染抑制 (Rendering Suppression)**的问题，在动画期间，整个 document 都不可见了。只有 `::view-transition` 渲染出来了。即便你通过 clip-path 去裁切 `::view-transition` ，你也只会发现底下的文档完全消失了，想交互也交互不了。
目前没有方法可以绕过这个限制。
也就意味着，你通常不能用它做长时间的动画，否则整个页面不可交互，一旦用户感知到，体验会很差。

接着就是它的快照机制，被声明了 view-transition-name 的元素，会导致元素脱离上下文。这意味着很多脱离预期的渲染能力，比如说，如果这个元素被 overflow:hidden 所裁切，脱离上下文后，它就完全显示出来了。这时候你需要动用 js，利用 clip-path 去裁剪元素。
然而，即便动用 clip-path，也可能无法解决问题，特别是如果你的元素在进行 x/y 的平移行为。

再有，如果你想在`::view-transtion`伪类元素中使用 css-custom-property，也没那么容易。因为它是层级非常高的元素（即便是用`document.documentElement.style.setProperty('--some','value')`也无法实现）。目前为止，我自己做过实验，只能通过创建 CSSStyleSheet 来动态写入 css 来实现（比如创建 style 元素，或者使用 document.adoptedStyleSheets 来添加）。

### 讨论 3: view-transitions 的使用场景

渲染抑制带来了一个很好的使用场景，就是用来做“启动屏幕”：

```ts
const vtc = new ViewTransitionController();
/// 应用启动后, 准备好启动屏
vtc.beforeStart();
/// 启动屏幕准备好了，通过 startViewTransition 禁止了整个文档的交互和渲染（我不知道渲染抑制后，这是否能让文档加载更快？也许浏览器会有优化）
const vt = document.startViewTransition(async () => {
  /// 然后我们在这里把 WebApp 的基本都东西都准备好，比如加载资源、执行渲染逻辑、准备DOM-Tree。
  await new Promise((r) => setTimeout(r, 2000));
  /// 准备好后，我们播放启动屏的关闭动画
  vtc.doStart();
});
/// 最后，清理启动屏幕
vtc.afterFinish();
```

但比如你想实现一个带有“加载进度条”的启动屏幕，可能会比较复杂，或者说实现可以，但是局限性相对较大。
比如说你的进度条可能会有纹理。而 ViewTransition 的动画机制是对 bounds 进行动画，而这种情况下，纹理会被拉伸。
如果要解决纹理的问题，那么就只能在`::view-transition-group(texture)`上去做纹理，同时隐藏 DOM 元素本身的纹理的渲染。
即便如此，以 VT 给的接口来说，根本做不到非常平滑的效果。

同时这个时候代码会变得很复杂，完全失去了使用 view-transitions 的意义。
感兴趣的小伙伴可以自己试着使用 view-transitions 实现页面加载动画。

> 这里我给一个我自己做实验的例子，你们可以自己感受一下:
> https://appn.dwewb.com/examples/kitchen-sink/view-transition-demo-splash-screen/
> 注意，我这个例子并没有完整实现所要的目标，但是读者如果感兴趣，可以在我这个例子的基础上去尝试其它方案。
> 比如使用 clip-path，或者手动在 `await transition.ready` 之后，去做动画：

```ts
document.documentElement.animate(
  {
    // ...keyframes
  },
  {
    duration: 500,
    easing: "ease-in",
    // Specify which pseudo-element to animate
    pseudoElement: "::view-transition-new(progressBarValue)",
  }
);
```

### 讨论 4: chrome-devtools 的 bug

目前 Chrome devtool 的动画面板对它暂停的支持还有 bug。在 Animations 暂停的情况下，但我如果切到浏览器的其它 tab 页面，再切回来，它(`::view-transition`)就不见了。
或者说，它背后的计时器好像也有点问题，我切到其它应用一会儿，再胡来，它(`::view-transition`)也不见了。
我搞不懂这个 BUG 具体的逻辑是什么，不好猜测，但总之调试体验并不友好，我的开发需要在浏览器和编辑器之来回切换，页需要在其它 tab 之间来回切换查找文档，这时候被暂停的`::view-transition`总会消失。

## 注意文章的结构格式是：

````
# 这是标题
## 一、这是段落
```ts
// 使用typescript作为示例代码
```
````

- 尽可能用`#`(h1/h2/h3/h4...)来做文章分段，而不是`**加粗**`来做段落。
- 对于步骤尽可能用`1. `来合理将内容分段。
- 对于观点，尽可能用`- `来合理将内容分段。
- 可以参考“张鑫旭”的文章幽默风格。但是用词和语句要足够的精简。情绪要中立，不要出现过于主观贬- 低或者否定的嫌疑。如果要描述缺点，务必说明白相对的故事背景、条件。
- 文章开始首先要总结出整个文章的论点背后的哲学。然后以此为中心展开内容。
- 文章的目的是引发读者的思考。因此涉及到的代码要足够的精简，目的只是用于辅助读者理解论点。
