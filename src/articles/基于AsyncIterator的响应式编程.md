---
layout: layouts/article.njk
title: "基于AsyncIterator的响应式编程"
date: 2022-04-18T08:19:46.754Z
updated: 2022-04-18T08:19:46.754Z
tags:
  - javascript
  - async
  - reactive
---

最近在重新思考响应式编程的一些事情，其实我很少使用 RxJS，往往是直接手撸各种异步策略。
因为我自己是更加倾向于使用原生的 async-await/generaor 来实现。因为会有更好的调式支持，性能也会更好。但可维护性可能就不一定，如果没有好好封装，别人读代码的时候，就会比较晦涩。
虽然 RxJS 在开始的时候也是晦涩，但是至少他们的高级的概念能够很好的复用。
而像我这种直接手撸的就往往是按照需求来进行编程，阅读者如果对需求没有足够的理解，那这种代码的可维护性可以说是相对比较低的。

但最近有打算把 RxJS 的一些常见概念和我自己的经验结合起来，写一个基于异步迭代器的响应式编程的库。
这篇文章就简单的讲一下这个库里头涉及到的一些有趣的经验点。

首先就是我异步编程时最常使用的 PromiseOut，它是对 promise 的再封装

```ts
class PromiseOut<T> {
  resolve: Function;
  reject: Function;
  promise = new Promise<T>((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  });
}
```

> 这是一个缩略版的 PromiseOut 代码，完整版的代码过段时间会放出来。（我司开源的相关工作还是推进中，主要是在做一个 typescript 项目管理标准，替代 monorepo……）

它的用法自然也很简单，就是把 Promise 的控制器对外暴露：

```ts
const po = new PromiseOut<void>();
await po.promise;
```

接着我们正式来聊聊异步迭代器与响应式编程。
不知道大家记不记得，现在 nodejs/web，对于`socket.on("data")`这种有了一种新的写法：
`for await(const chunk of socket)`。
这里我们就实现一个简易版的，来看这段代码：

```ts
/**
 * 订阅器
 * 提供一个流式的变更触发
 * 等价于 EventEmitter
 * 这里提供基于流式编程的书写方法
 */
interface Sub {
  /**
   * 如果是 true，说明已经发生修改，只是这个改变还没有被拾取
   * 如果是 false，说明改变已经被拾取
   * 如果是 PromiseOut，说明有控制器在等待它
   */
  changed: boolean | PromiseOut<void>;
}
class Demo {
  private _subs = new Set<Sub>();
  /*触发修改*/
  emitChanged() {
    for (const sub of this._subs) {
      // 如果有等待中的控制器，那么唤醒它
      if (sub.changed instanceof PromiseOut) {
        sub.changed.resolve();
      }
      // 修改状态值：有改变
      sub.changed = true;
    }
  }
  /**
   * 执行订阅
   */
  async *subscription() {
    const sub: Sub = { changed: false };
    this._subs.add(sub);
    do {
      /// 如果是 true 那么就重置成 false
      if (sub.changed === true) {
        sub.changed = false;
        yield; /// 异步迭代器暂停，将控制权转交给外部迭代者
      }
      /// 暂停期间可能会被修改成 true（调用了emitChanged）
      /// 如果还是 false，说明期间没有发生任何修改
      if (sub.changed === false) {
        // 创建一个控制器并等待它被唤醒
        await (sub.changed = new PromiseOut<void>()).promise;
        sub.changed = true;
      }
    } while (true);
  }
}
```

现在代码的核心逻辑就是以上这些了，但那段代码是不完整的，因为很明显，`Demo._subs: Set<Sub>`这个对象只有`add`，没有`delete`，所以需要再加上内存释放的逻辑才够完整。

```ts
const sub = { changed: false };
this._subs.add(sub);
try {
  do {
    /* 核心代码 */
  } while (true);
} finally {
  this._subs.delete(sub);
}
```

不熟悉 AsyncGenerator 的人可能会觉得奇怪，那“核心代码”里头根本没有`break`、`return`等关键字，那`do-while(true)`能跑出来吗？
答案是：能，你可以将`yield`的关键字理解成是注入外部的代码，类似于函数调用。同时，外部还能有两个特殊的控制函数：`asyncGenerator.return`和`asyncGenerator.throw`。所以只要外部调用了`asyncGenerator.return`，那么`finally`块的代码就能被执行。
比如这段代码：

```ts
for await (const changed of demo.subscription()) {
    throw;
    break;
    return;
}
```

在我们最常用的`for-await`循环中，只要退出了循环，不论是用`break`、`throw`、`return`，都会触发`asyncGenerator.return`；

好了，至此你觉得上面这段代码完事了吗？
答案是：没有。
看这句代码：

```ts
// 创建一个控制器并等待它被唤醒
await((sub.changed = new PromiseOut<void>())).promise;
```

这个 promise 如果一直没有处于 pending 状态，那么`asyncGenerator.return`或者`asyncGenerator.throw`并不会无缘无故地将之释放掉。
也就是说`finally`的代码一定要等到下一次`emitChanged`触发的时候，`promiseOut`被`resolved`，之后还要再次进入循环，执行到`yield`字段这里跳出来。同时被`for-await`这时候才会真的跳出来
以下这段代码可以简单复现这个问题：

```ts
console.log("start");
// 一秒后执行 emitChanged
setTimeout(() => {
  demo.emitChanged();
}, 1000);
for await (const _ of demo.subscription()) {
  break; // 执行 asyncGenerator.return，但不会马上跳出循环
}
// 等待一秒后，这句日志才会被打印
console.log("demo._subs.size", demo._subs.size);
```

所以要怎么解决这个问题呢？很简单，我们需要重写`asyncGenerator.return`函数：

```ts
/**
 * 一个特殊的中断信号
 */
const ABORT_SIGNAL = Symbol("abort-signal");
class Demo {
  private async *_subscription(sub: Sub) {
    this._subs.add(sub);
    try {
      /* 核心代码 */
    } catch (err) {
      if (err !== ABORT_SIGNAL) {
        throw err;
      }
    } finally {
      this._subs.delete(sub);
    }
    /*将原有的subscription方法改成私有，且sub对象由外部传入*/
  }
  subscription() {
    const sub: Sub = { changed: false };
    const subject = this._subscription(sub);
    /// 重写 return 函数，确保能够直接地释放掉这个订阅
    const _return = subject.return;
    subject.return = (arg: any) => {
      if (sub.changed instanceof PromiseOut) {
        sub.changed.reject(ABORT_SIGNAL);
      }
      return _return.call(subject, arg);
    };
    /// 同样的，需要重写 throw 函数
    const _throw = subject.throw;
    subject.throw = (err: any) => {
      if (sub.changed instanceof PromiseOut) {
        sub.changed.reject(err);
      }
      return _throw.call(subject, err);
    };
    return subject;
  }
}
```

至此，基于`AsyncGenerator`的这个事件流就基本开发完成了。
如果你已经能理解以上的代码，那么接下来需要进阶的，其实就是`ReadableStream`，它同样提供了一个控制器，来用更加统一的方式易懂来实现以上代码中`PromiseOut`的作用。同时它还有背压的功能，这对于传统的基于事件驱动编程在程序的健壮性上是一个质变的存在，正如`try-catch`对于错误处理的重要性一样。这篇文章就不对此展开描述了。
