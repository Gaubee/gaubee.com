---
title: Cap'n Web
date: '2025-09-24T04:27:32.119Z'
tags:
  - event
---

看了一下 Cap'n Web 的源代码，相比Comlink它更专注于“网络协议”的优化。 

Comlink的特性是参考 MessageChannel 去做Endpoint设计，而这种设计非常原始纯粹， 也就导致很多东西是有心智负担的。
比如MessageChannel 是有对象所有权传输的能力，实际写代码的时候，你得用Comlink提供的接口来对U8A对象标记成“直接传输到另外一个线程”。
 但这种设计并不是所有适配器都会去实现（参考 [GitHub - kinglisky/comlink-adapters](https://github.com/kinglisky/comlink-adapters) ）所以用起来的时候，使用者得注意，自己现在在什么环境里面，要传输什么东西？传输的东西是一个代理对象？还是克隆对象？

而 Cap'n Web 的定位是 RPC，其实就是类似执行一次http-req，这意味着没有后续的副作用。这个概念很重要！比如说，Comlink默认返回的对象还是一个Comlink对象，可以继续链式调用，除非主动标记Comlink.clone(returnValue)让它强制走克隆的逻辑。因此这里可以看出它们的定位和策略上的偏差。Cap'n Web 更适合网络环境。

但是总的来说 Cap'n Web  为RPC这种网络场景做了定向优化。同时还补充了一些特别的功能，比如Promise流水线化。以及它的 RpcTransport 适配器设计实现起来非常简单。